/**
 * @jest-environment node
 */
jest.mock('@langchain/groq', () => ({ ChatGroq: jest.fn().mockImplementation((opts) => ({ opts, provider: 'groq' })) }));
jest.mock('@langchain/openai', () => ({ ChatOpenAI: jest.fn().mockImplementation((opts) => ({ opts, provider: 'openai' })) }));
jest.mock('@langchain/ollama', () => ({ ChatOllama: jest.fn().mockImplementation((opts) => ({ opts, provider: 'ollama' })) }));

import { getAiProviderName, getChatModel } from '../provider';

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
