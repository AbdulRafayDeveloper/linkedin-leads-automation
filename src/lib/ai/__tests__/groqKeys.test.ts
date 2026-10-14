/**
 * @jest-environment node
 */
import {
  classifyFailure,
  describeGroqKeys,
  getGroqKeys,
  keysToTry,
  maskKey,
  noteKeyFailure,
  noteKeySuccess,
  parseRetryAfterMs,
  resetGroqKeyState,
} from '../groqKeys';

const SEVEN = {
  GROQ_API_KEY_1: 'gsk_one',
  GROQ_API_KEY_2: 'gsk_two',
  GROQ_API_KEY_3: 'gsk_three',
} as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  resetGroqKeyState();
});

describe('getGroqKeys', () => {
  it('reads the numbered keys in order', () => {
    expect(getGroqKeys(SEVEN).map((k) => k.key)).toEqual(['gsk_one', 'gsk_two', 'gsk_three']);
  });

  it('sorts by number, not by string, so key 10 comes after key 9', () => {
    const env = {
      GROQ_API_KEY_10: 'ten',
      GROQ_API_KEY_2: 'two',
      GROQ_API_KEY_9: 'nine',
    } as unknown as NodeJS.ProcessEnv;
    expect(getGroqKeys(env).map((k) => k.key)).toEqual(['two', 'nine', 'ten']);
  });

  it('still accepts a single GROQ_API_KEY, and puts it first', () => {
    const env = { GROQ_API_KEY: 'solo', GROQ_API_KEY_1: 'first' } as unknown as NodeJS.ProcessEnv;
    expect(getGroqKeys(env).map((k) => k.key)).toEqual(['solo', 'first']);
  });

  it('accepts a comma or newline separated list', () => {
    const env = { GROQ_API_KEYS: 'a, b\nc' } as unknown as NodeJS.ProcessEnv;
    expect(getGroqKeys(env).map((k) => k.key)).toEqual(['a', 'b', 'c']);
  });

  it('ignores blanks and repeats', () => {
    const env = {
      GROQ_API_KEY: '  a  ',
      GROQ_API_KEY_1: 'a',
      GROQ_API_KEY_2: '   ',
      GROQ_API_KEY_3: 'b',
    } as unknown as NodeJS.ProcessEnv;
    expect(getGroqKeys(env).map((k) => k.key)).toEqual(['a', 'b']);
  });

  it('returns nothing when no key is configured', () => {
    expect(getGroqKeys({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('never exposes the secret in an id or a mask', () => {
    const [first] = getGroqKeys(SEVEN);
    expect(first.id).toBe('groq#1');
    expect(maskKey('gsk_abcdefgh')).toBe('…efgh');
    expect(maskKey('ab')).toBe('…');
  });
});

describe('walking through the keys', () => {
  it('starts at the first key', () => {
    expect(keysToTry(SEVEN).map((k) => k.id)).toEqual(['groq#1', 'groq#2', 'groq#3']);
  });

  it('moves to the next key after a failure and skips the failed one', () => {
    noteKeyFailure('groq#1', new Error('429 rate limit reached'));
    expect(keysToTry(SEVEN).map((k) => k.id)).toEqual(['groq#2', 'groq#3']);
  });

  it('wraps from the last key back to the first', () => {
    noteKeyFailure('groq#3', new Error('boom'));
    // Key 3 was last, so the walk starts again at key 1.
    expect(keysToTry(SEVEN).map((k) => k.id)).toEqual(['groq#1', 'groq#2']);
  });

  it('keeps using the key that worked until it stops working', () => {
    noteKeySuccess('groq#2', SEVEN);
    expect(keysToTry(SEVEN).map((k) => k.id)).toEqual(['groq#2', 'groq#3', 'groq#1']);
  });

  it('tries every key again rather than giving up when all are cooling down', () => {
    for (const id of ['groq#1', 'groq#2', 'groq#3']) {
      noteKeyFailure(id, new Error('429 rate limit reached'));
    }
    expect(keysToTry(SEVEN).map((k) => k.id)).toEqual(['groq#1', 'groq#2', 'groq#3']);
  });

  it('brings a key back once its cooldown has passed', () => {
    const now = Date.now();
    noteKeyFailure('groq#1', new Error('429 Please try again in 1m0s'), now);
    expect(keysToTry(SEVEN, now + 30_000).map((k) => k.id)).not.toContain('groq#1');
    expect(keysToTry(SEVEN, now + 61_000).map((k) => k.id)).toContain('groq#1');
  });

  it('picks up a key added to the environment later, with no code change', () => {
    const grown = { ...SEVEN, GROQ_API_KEY_4: 'gsk_four' } as unknown as NodeJS.ProcessEnv;
    expect(keysToTry(grown).map((k) => k.id)).toEqual(['groq#1', 'groq#2', 'groq#3', 'groq#4']);
  });

  it('has nothing to try when no key is configured', () => {
    expect(keysToTry({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe('reading the failure', () => {
  it('tells rate limits, bad keys and everything else apart', () => {
    expect(classifyFailure('429 Rate limit reached for model')).toBe('rate_limit');
    expect(classifyFailure('Too Many Requests')).toBe('rate_limit');
    expect(classifyFailure('401 Invalid API Key')).toBe('auth');
    expect(classifyFailure('fetch failed')).toBe('other');
  });

  it('waits exactly as long as Groq asks', () => {
    expect(parseRetryAfterMs('Please try again in 45m41.04s')).toBe(2_741_040);
    expect(parseRetryAfterMs('Please try again in 7.66s')).toBe(7_660);
    expect(parseRetryAfterMs('Please try again in 2m')).toBe(120_000);
    expect(parseRetryAfterMs('no hint here')).toBeNull();
  });

  it('parks a rate-limited key for the time Groq named', () => {
    const now = Date.now();
    noteKeyFailure('groq#1', new Error('429 Rate limit. Please try again in 2m0s'), now);
    const status = describeGroqKeys(SEVEN, now)[0];
    expect(status).toMatchObject({ id: 'groq#1', masked: '…_one', reason: 'rate_limit' });
    expect(status.coolingDownFor).toBe(120);
  });

  it('parks a rejected key for much longer than a flaky one', () => {
    const now = Date.now();
    noteKeyFailure('groq#1', new Error('401 Invalid API Key'), now);
    noteKeyFailure('groq#2', new Error('socket hang up'), now);
    const [auth, other] = describeGroqKeys(SEVEN, now);
    expect(auth.coolingDownFor).toBe(30 * 60);
    expect(other.coolingDownFor).toBe(15);
  });

  it('handles a thrown value that is not an Error', () => {
    expect(() => noteKeyFailure('groq#1', { status: 429 })).not.toThrow();
    expect(describeGroqKeys(SEVEN)[0].reason).toBe('rate_limit');
  });

  it('clears the cooldown when the key works again', () => {
    noteKeyFailure('groq#1', new Error('429 rate limit'));
    noteKeySuccess('groq#1', SEVEN);
    expect(describeGroqKeys(SEVEN)[0].coolingDownFor).toBe(0);
  });
});

describe('a prompt that is too large', () => {
  const TOO_LARGE =
    '413 {"error":{"message":"Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 15000","code":"rate_limit_exceeded"}}';

  it('is not blamed on the key', () => {
    expect(classifyFailure(TOO_LARGE)).toBe('too_large');
  });

  it('leaves every key ready, because a smaller prompt would still work', () => {
    noteKeyFailure('groq#1', new Error(TOO_LARGE));
    expect(describeGroqKeys(SEVEN).every((k) => k.coolingDownFor === 0)).toBe(true);
    expect(keysToTry(SEVEN).map((k) => k.id)).toEqual(['groq#1', 'groq#2', 'groq#3']);
  });
});
