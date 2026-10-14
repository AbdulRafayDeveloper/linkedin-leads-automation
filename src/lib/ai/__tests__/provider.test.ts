/**
 * @jest-environment node
 */
jest.mock('@langchain/groq', () => ({ ChatGroq: jest.fn().mockImplementation((opts) => ({ opts, provider: 'groq' })) }));
jest.mock('@langchain/openai', () => ({ ChatOpenAI: jest.fn().mockImplementation((opts) => ({ opts, provider: 'openai' })) }));
jest.mock('@langchain/ollama', () => ({ ChatOllama: jest.fn().mockImplementation((opts) => ({ opts, provider: 'ollama' })) }));

import { ChatGroq } from '@langchain/groq';
import { getAiProviderName, getChatModel, getFallbackChatModels } from '../provider';
import { resetGroqKeyState } from '../groqKeys';

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

describe('getFallbackChatModels with several Groq keys', () => {
  beforeEach(() => {
    resetGroqKeyState();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
    process.env.GROQ_API_KEY_1 = 'key-one';
    process.env.GROQ_API_KEY_2 = 'key-two';
    process.env.GROQ_API_KEY_3 = 'key-three';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('tries the best model on every key, then the lighter model on every key', async () => {
    const models = (await getFallbackChatModels()) as unknown as Array<{ opts: { model: string; apiKey: string } }>;
    expect(models.map((m) => [m.opts.model, m.opts.apiKey])).toEqual([
      ['openai/gpt-oss-120b', 'key-one'],
      ['openai/gpt-oss-120b', 'key-two'],
      ['openai/gpt-oss-120b', 'key-three'],
      ['openai/gpt-oss-20b', 'key-one'],
      ['openai/gpt-oss-20b', 'key-two'],
      ['openai/gpt-oss-20b', 'key-three'],
    ]);
  });

  it('grows the chain when another key is added, with no code change', async () => {
    process.env.GROQ_API_KEY_4 = 'key-four';
    const models = await getFallbackChatModels();
    expect(models).toHaveLength(8);
  });

  it('starts the next chain after the key that just failed', async () => {
    const failing = new Error('429 Rate limit reached. Please try again in 5m0s');
    (ChatGroq as unknown as jest.Mock).mockImplementationOnce((opts) => ({
      opts,
      provider: 'groq',
      invoke: jest.fn().mockRejectedValue(failing),
    }));

    const [first] = (await getFallbackChatModels()) as unknown as Array<{ invoke: () => Promise<unknown> }>;
    await expect(first.invoke()).rejects.toThrow(/rate limit/i);

    // Key one is parked for the five minutes Groq asked for, so the next
    // request opens on key two and never pays for key one again.
    const next = (await getFallbackChatModels()) as unknown as Array<{ opts: { apiKey: string } }>;
    expect(next.map((m) => m.opts.apiKey)).toEqual([
      'key-two',
      'key-three',
      'key-two',
      'key-three',
    ]);
  });

  it('keeps the key that answered at the front of the next chain', async () => {
    (ChatGroq as unknown as jest.Mock)
      .mockImplementationOnce((opts) => ({ opts, provider: 'groq', invoke: jest.fn().mockRejectedValue(new Error('500 upstream')) }))
      .mockImplementationOnce((opts) => ({ opts, provider: 'groq', invoke: jest.fn().mockResolvedValue('ok') }));

    const models = (await getFallbackChatModels()) as unknown as Array<{ invoke: () => Promise<unknown> }>;
    await expect(models[0].invoke()).rejects.toThrow();
    await expect(models[1].invoke()).resolves.toBe('ok');

    const next = (await getFallbackChatModels()) as unknown as Array<{ opts: { apiKey: string } }>;
    expect(next[0].opts.apiKey).toBe('key-two');
  });

  it('passes a working chain through unchanged, including the OpenAI tail', async () => {
    process.env.OPENAI_API_KEY = 'openai-key';
    const models = (await getFallbackChatModels()) as unknown as Array<{ provider: string }>;
    expect(models).toHaveLength(7);
    expect(models[6].provider).toBe('openai');
  });

  it('uses a key from the pool for the single-model path too', async () => {
    const model = (await getChatModel()) as unknown as { opts: { apiKey: string } };
    expect(model.opts.apiKey).toBe('key-one');
  });
});
