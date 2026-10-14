import {
  DEFAULT_MAX_DELAY_SECONDS,
  DEFAULT_MIN_DELAY_SECONDS,
  MAX_DELAY_SECONDS,
  MIN_DELAY_SECONDS,
  formatDateTime,
  formatDelayRange,
  formatDuration,
  isValidCampaignName,
  makeRunnerId,
  normalizeDelays,
  randomDelaySeconds,
} from '../campaignRunner';

describe('normalizeDelays', () => {
  it('keeps a valid range', () => {
    expect(normalizeDelays(30, 120)).toEqual({ minDelaySeconds: 30, maxDelaySeconds: 120 });
  });

  it('swaps min and max when the minimum is above the maximum', () => {
    expect(normalizeDelays(300, 60)).toEqual({ minDelaySeconds: 60, maxDelaySeconds: 300 });
  });

  it('clamps into the accepted range', () => {
    expect(normalizeDelays(-5, 999999)).toEqual({ minDelaySeconds: MIN_DELAY_SECONDS, maxDelaySeconds: MAX_DELAY_SECONDS });
  });

  it('falls back to defaults for missing or invalid values', () => {
    expect(normalizeDelays(undefined, undefined)).toEqual({
      minDelaySeconds: DEFAULT_MIN_DELAY_SECONDS,
      maxDelaySeconds: DEFAULT_MAX_DELAY_SECONDS,
    });
    expect(normalizeDelays('abc', NaN)).toEqual({
      minDelaySeconds: DEFAULT_MIN_DELAY_SECONDS,
      maxDelaySeconds: DEFAULT_MAX_DELAY_SECONDS,
    });
  });

  it('accepts numeric strings and rounds', () => {
    expect(normalizeDelays('15.4', '90.6')).toEqual({ minDelaySeconds: 15, maxDelaySeconds: 91 });
  });

  it('uses the given fallback range', () => {
    expect(normalizeDelays(undefined, 200, { minDelaySeconds: 20, maxDelaySeconds: 40 })).toEqual({
      minDelaySeconds: 20,
      maxDelaySeconds: 200,
    });
  });
});

describe('randomDelaySeconds', () => {
  it('never goes below the minimum, even with an inverted range', () => {
    for (const r of [0, 0.25, 0.5, 0.999, 1]) {
      const value = randomDelaySeconds(600, 60, () => r);
      expect(value).toBeGreaterThanOrEqual(60);
      expect(value).toBeLessThanOrEqual(600);
    }
  });

  it('covers both ends of the range', () => {
    expect(randomDelaySeconds(10, 20, () => 0)).toBe(10);
    expect(randomDelaySeconds(10, 20, () => 0.999999)).toBe(20);
  });

  it('returns the only value when min equals max', () => {
    expect(randomDelaySeconds(45, 45)).toBe(45);
  });

  it('never returns a negative or zero delay for garbage input', () => {
    expect(randomDelaySeconds(NaN, -10)).toBeGreaterThanOrEqual(MIN_DELAY_SECONDS);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [45, '45s'],
    [60, '1m'],
    [90, '1m 30s'],
    [600, '10m'],
    [3600, '1h'],
    [3900, '1h 5m'],
    [-3, '0s'],
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('formatDelayRange', () => {
  it('describes the range with real values, not a hardcoded label', () => {
    expect(formatDelayRange({ minDelaySeconds: 15, maxDelaySeconds: 90 })).toBe('15s to 1m 30s');
    expect(formatDelayRange({ minDelaySeconds: 60, maxDelaySeconds: 600 })).toBe('1m to 10m');
  });
});

describe('formatDateTime', () => {
  it('returns a dash for missing or invalid values', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('not a date')).toBe('—');
  });

  it('includes both date and time', () => {
    const out = formatDateTime('2026-10-14T09:05:00.000Z');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('isValidCampaignName', () => {
  it('rejects empty, blank and over-long names', () => {
    expect(isValidCampaignName('')).toBe(false);
    expect(isValidCampaignName('   ')).toBe(false);
    expect(isValidCampaignName('x'.repeat(121))).toBe(false);
    expect(isValidCampaignName(42)).toBe(false);
  });

  it('accepts a normal name', () => {
    expect(isValidCampaignName('October outreach')).toBe(true);
  });
});

describe('makeRunnerId', () => {
  it('returns distinct non-empty ids', () => {
    const a = makeRunnerId();
    const b = makeRunnerId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
