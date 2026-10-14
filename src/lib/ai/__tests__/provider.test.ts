/**
 * @jest-environment node
 */
jest.mock('@langchain/groq', () => ({ ChatGroq: jest.fn().mockImplementation((opts) => ({ opts, provider: 'groq' })) }));
jest.mock('@langchain/openai', () => ({ ChatOpenAI: jest.fn().mockImplementation((opts) => ({ opts, provider: 'openai' })) }));
jest.mock('@langchain/ollama', () => ({ ChatOllama: jest.fn().mockImplementation((opts) => ({ opts, provider: 'ollama' })) }));

import { getAiProviderName, getChatModel, getFallbackChatModels } from '../provider';

const ORIGINAL_ENV = { ...process.env };

describe('getAiProviderName', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to groq when AI_PROVIDER is unset', () => {
    delete process.env.AI_PROVIDER;
    expect(getAiProviderName()).toBe('groq');
  });

  it('respects a valid AI_PROVIDER value', () => {
    process.env.AI_PROVIDER = 'openai';
    expect(getAiProviderName()).toBe('openai');
  });

  it('falls back to groq for an unrecognized provider', () => {
    process.env.AI_PROVIDER = 'not-a-provider';
    expect(getAiProviderName()).toBe('groq');
  });
});

describe('getChatModel', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('constructs a Groq chat model by default', async () => {
    process.env.AI_PROVIDER = 'groq';
    const model = (await getChatModel()) as unknown as { provider: string };
    expect(model.provider).toBe('groq');
  });

  it('constructs an OpenAI chat model when configured', async () => {
    process.env.AI_PROVIDER = 'openai';
    const model = (await getChatModel()) as unknown as { provider: string };
    expect(model.provider).toBe('openai');
  });

  it('constructs an Ollama chat model when configured', async () => {
    process.env.AI_PROVIDER = 'ollama';
    const model = (await getChatModel()) as unknown as { provider: string };
    expect(model.provider).toBe('ollama');
  });
});

describe('getFallbackChatModels', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('tries Groq twice, then OpenAI, regardless of AI_PROVIDER', async () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';
    const models = (await getFallbackChatModels()) as unknown as Array<{ provider: string; opts: { model: string } }>;
    expect(models.map((m) => m.provider)).toEqual(['groq', 'groq', 'openai']);
    // The second Groq entry is the lighter, faster model.
    expect(models[1].opts.model).toBe('openai/gpt-oss-20b');
  });

  it('leaves OpenAI out of the chain when there is no API key', async () => {
    delete process.env.OPENAI_API_KEY;
    const models = (await getFallbackChatModels()) as unknown as Array<{ provider: string }>;
    expect(models.map((m) => m.provider)).toEqual(['groq', 'groq']);
  });
});
