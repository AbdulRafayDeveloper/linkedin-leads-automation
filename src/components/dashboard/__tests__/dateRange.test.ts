import { comparisonLabel, isRangePreset, parseDateInput, resolveRange, toDateInput } from '../dateRange';

// Local time, so these hold in any time zone the tests run in.
const now = new Date(2026, 8, 14, 15, 30);

/** The resolved window, or a failure if the range was rejected. */
function range(...args: Parameters<typeof resolveRange>) {
  const result = resolveRange(...args);
  if (result.kind !== 'range') throw new Error(`expected a range, got ${result.kind}`);
  return result.range;
}

describe('resolveRange presets', () => {
  it('starts today at local midnight and compares with yesterday at the same time', () => {
    const today = range('today', {}, now);
    expect(today.from).toEqual(new Date(2026, 8, 14));
    expect(today.to).toEqual(now);
    expect(today.compare).toEqual({
      from: new Date(2026, 8, 13),
      to: new Date(2026, 8, 13, 15, 30),
    });
  });

  it('covers 7 and 30 calendar days including today', () => {
    expect(range('7d', {}, now).from).toEqual(new Date(2026, 8, 8));
    expect(range('30d', {}, now).from).toEqual(new Date(2026, 7, 16));
  });

  it('compares a preset against the same calendar length just before it', () => {
    const week = range('7d', {}, now);
    expect(week.compare.from).toEqual(new Date(2026, 8, 1));
    expect(week.compare.to).toEqual(new Date(2026, 8, 7, 15, 30));
  });

  it('reports all time as its own kind, not as a missing range', () => {
    expect(resolveRange('all', {}, now)).toEqual({ kind: 'all' });
  });
});

describe('resolveRange custom', () => {
  it('runs an open-ended custom range up to now', () => {
    const custom = range('custom', { from: '2026-09-01' }, now);
    expect(custom.from).toEqual(new Date(2026, 8, 1));
    expect(custom.to).toEqual(now);
  });

  it('covers whole days and compares with the period before', () => {
    const custom = range('custom', { from: '2026-09-01', to: '2026-09-07' }, now);
    expect(custom.from).toEqual(new Date(2026, 8, 1));
    expect(custom.to).toEqual(new Date(2026, 8, 7, 23, 59, 59, 999));
    expect(custom.compare.from).toEqual(new Date(2026, 7, 25));
  });

  it('caps an end date in the future at now', () => {
    expect(range('custom', { from: '2026-09-10', to: '2026-12-31' }, now).to).toEqual(now);
  });

  it('refuses a range it cannot use instead of falling back to all time', () => {
    expect(resolveRange('custom', {}, now)).toMatchObject({ kind: 'invalid' });
    expect(resolveRange('custom', { from: '' }, now)).toMatchObject({ kind: 'invalid' });
    expect(resolveRange('custom', { from: 'nope' }, now)).toMatchObject({ kind: 'invalid' });
    expect(resolveRange('custom', { from: '2026-09', to: '2026-09-10' }, now)).toMatchObject({
      kind: 'invalid',
    });
  });

  it('explains a backwards range rather than silently reordering it', () => {
    const result = resolveRange('custom', { from: '2026-09-14', to: '2026-09-10' }, now);
    expect(result).toMatchObject({ kind: 'invalid' });
    if (result.kind === 'invalid') expect(result.message).toMatch(/on or before/i);
  });

  it('rejects a start date in the future', () => {
    const result = resolveRange('custom', { from: '2027-01-01' }, now);
    expect(result).toMatchObject({ kind: 'invalid' });
    if (result.kind === 'invalid') expect(result.message).toMatch(/future/i);
  });
});

describe('helpers', () => {
  it('validates presets from the URL', () => {
    expect(isRangePreset('30d')).toBe(true);
    expect(isRangePreset('90d')).toBe(false);
    expect(isRangePreset(null)).toBe(false);
  });

  it('parses and formats date inputs as local dates', () => {
    expect(parseDateInput('2026-02-03')).toEqual(new Date(2026, 1, 3));
    expect(parseDateInput('')).toBeNull();
    expect(toDateInput(new Date(2026, 1, 3))).toBe('2026-02-03');
  });

  it('names the comparison period precisely', () => {
    expect(comparisonLabel('today')).toBe('vs yesterday, same time');
    expect(comparisonLabel('7d')).toBe('vs previous 7 days');
    expect(comparisonLabel('custom')).toBe('vs previous period');
  });
});
