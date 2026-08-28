import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export type AiProviderName = 'groq' | 'openai' | 'ollama';

export function getAiProviderName(): AiProviderName {
  const provider = (process.env.AI_PROVIDER || 'groq').toLowerCase();
  if (provider === 'openai' || provider === 'ollama' || provider === 'groq') {
    return provider;
  }
  return 'groq';
}

export async function getChatModel(): Promise<BaseChatModel> {
  const provider = getAiProviderName();

  if (provider === 'openai') {
    const { ChatOpenAI } = await import('@langchain/openai');
    return new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
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
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    temperature: 0.4,
  });
}
