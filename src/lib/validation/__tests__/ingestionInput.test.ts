import {
  MAX_PROFILE_CHARS,
  MIN_PROFILE_CHARS,
  checkIngestionInput,
} from '../ingestionInput';

const PROFILE = 'Priya Nandakumar\nVP Engineering at Solstice Robotics\nMelbourne, Australia';

describe('checkIngestionInput', () => {
  it('accepts a real profile paste', () => {
    expect(checkIngestionInput(PROFILE)).toEqual({ ok: true });
  });

  it('rejects empty and whitespace-only text with a message', () => {
    for (const value of ['', '   ', '\n\n\t ']) {
      const result = checkIngestionInput(value);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('empty');
      expect(result.message).toMatch(/Paste the profile text/);
    }
  });

  it('rejects text that is too short to be a profile', () => {
    const result = checkIngestionInput('x');
    expect(result).toMatchObject({ ok: false, error: 'too_short' });
    expect(result.message).toContain(String(MIN_PROFILE_CHARS));
  });

  it('rejects long strings with no words, such as emoji or symbols', () => {
    const result = checkIngestionInput('🚀🚀🚀 '.repeat(20));
    expect(result).toMatchObject({ ok: false, error: 'no_words' });
  });

  it('rejects junk that is long enough but has too few words', () => {
    expect(checkIngestionInput(`${'1234567890'.repeat(5)} 42`)).toMatchObject({
      ok: false,
      error: 'no_words',
    });
  });

  it('rejects text over the character cap', () => {
    const result = checkIngestionInput('a b c d '.repeat(MAX_PROFILE_CHARS));
    expect(result).toMatchObject({ ok: false, error: 'too_long' });
  });

  it('counts non-Latin words, so a profile in Urdu is accepted', () => {
    expect(checkIngestionInput('عبدالرفیع سافٹ ویئر انجینئر ٹیک کمپنی کراچی پاکستان').ok).toBe(true);
  });
});
