import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { keysToTry, noteKeyFailure, noteKeySuccess, type GroqKey } from './groqKeys';

export type AiProviderName = 'groq' | 'openai' | 'ollama';

export function getAiProviderName(): AiProviderName {
  const provider = (process.env.AI_PROVIDER || 'groq').toLowerCase();
  if (provider === 'openai' || provider === 'ollama' || provider === 'groq') {
    return provider;
  }
  return 'groq';
}

/**
 * Returns the Groq model to use, sanitising legacy / removed model strings.
 * Confirmed active on this account (as of 2026-09-10):
 *   openai/gpt-oss-120b  – large, best quality
 *   openai/gpt-oss-20b   – fast fallback
 *   qwen/qwen3.8-27b     – alternative
 */
export function getGroqModelName(): string {
  const model = (process.env.GROQ_MODEL || '').trim();
  // Sanitize legacy model IDs that are no longer available on this account
  if (!model || model === 'llama-3.3-70b-versatile' || model === 'llama3-70b-8192' || model === 'mixtral-8x7b-32768') {
    return 'openai/gpt-oss-120b';
  }
  return model;
}

/** The lighter Groq model every key falls back to. */
const GROQ_BACKUP_MODEL = 'openai/gpt-oss-20b';

/**
 * Reports which key answered, so the pool can park a rate-limited key and
 * start the next call on one that works. Callers still just see a chat model
 * and call `invoke`; they never learn there is more than one key.
 */
function trackKey(model: BaseChatModel, entry: GroqKey): BaseChatModel {
  return new Proxy(model, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'invoke' || typeof value !== 'function') return value;

      return async (...args: unknown[]) => {
        try {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          noteKeySuccess(entry.id);
          return result;
        } catch (error) {
          noteKeyFailure(entry.id, error);
          throw error;
        }
      };
    },
  });
}

export async function getChatModel(): Promise<BaseChatModel> {
  const provider = getAiProviderName();

  if (provider === 'openai') {
    const { ChatOpenAI } = await import('@langchain/openai');
    return new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      timeout: 8000,
    });
  }

  if (provider === 'ollama') {
    const { ChatOllama } = await import('@langchain/ollama');
    return new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'llama3.1',
      temperature: 0.4,
    });
  }

  const { ChatGroq } = await import('@langchain/groq');
  // The first key the pool is willing to use right now.
  const [entry] = keysToTry();
  const model = new ChatGroq({
    apiKey: entry?.key,
    model: getGroqModelName(),
    temperature: 0.4,
    timeout: 8000,
  });
  return entry ? trackKey(model, entry) : model;
}

/**
 * Returns chat models in a fallback chain, which callers walk until one
 * answers. The best Groq model is tried on every configured key first, then
 * the lighter Groq model on every key, then OpenAI if a key is set. Keys start
 * at whichever one last worked and wrap around, so one exhausted key costs a
 * single failed call rather than the whole request.
 */
export async function getFallbackChatModels(
  temperature = 0
): Promise<BaseChatModel[]> {
  const models: BaseChatModel[] = [];
  const keys = keysToTry();
  // With no key configured at all, still build the chain: ChatGroq then
  // reports the missing key itself, as it always has.
  const entries: Array<GroqKey | null> = keys.length > 0 ? keys : [null];

  const { ChatGroq } = await import('@langchain/groq');

  for (const groqModel of [getGroqModelName(), GROQ_BACKUP_MODEL]) {
    for (const entry of entries) {
      const model = new ChatGroq({
        apiKey: entry?.key,
        model: groqModel,
        temperature,
        timeout: 15000,
      });
      models.push(entry ? trackKey(model, entry) : model);
    }
  }

  // Last resort: OpenAI if a key is present.
  if (process.env.OPENAI_API_KEY) {
    const { ChatOpenAI } = await import('@langchain/openai');
    models.push(
      new ChatOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature,
        timeout: 15000,
      })
    );
  }

  return models;
}
