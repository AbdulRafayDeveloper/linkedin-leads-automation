import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

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
  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: getGroqModelName(),
    temperature: 0.4,
    timeout: 8000,
  });
}

/**
 * Returns chat models in a fallback chain: primary Groq model first,
 * then a lighter Groq backup, so failures on any single call are transparent.
 */
export async function getFallbackChatModels(
  temperature = 0
): Promise<BaseChatModel[]> {
  const models: BaseChatModel[] = [];

  const { ChatGroq } = await import('@langchain/groq');

  // Primary: best available model on this account
  models.push(
    new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: getGroqModelName(),
      temperature,
      timeout: 15000,
    })
  );

  // Secondary fallback: lighter/faster model
  models.push(
    new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: 'openai/gpt-oss-20b',
      temperature,
      timeout: 15000,
    })
  );

  // Tertiary: OpenAI if key present
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
