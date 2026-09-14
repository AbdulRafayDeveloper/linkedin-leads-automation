import { comparisonLabel, isRangePreset, parseDateInput, resolveRange } from '../dateRange';

// Local time, so these hold in any time zone the tests run in.
const now = new Date(2026, 8, 14, 15, 30);

describe('resolveRange', () => {
  it('starts today at local midnight', () => {
    expect(resolveRange('today', {}, now)).toEqual({ from: new Date(2026, 8, 14), to: now });
  });

  it('covers 7 and 30 calendar days including today', () => {
    expect(resolveRange('7d', {}, now)?.from).toEqual(new Date(2026, 8, 8));
    expect(resolveRange('30d', {}, now)?.from).toEqual(new Date(2026, 7, 16));
  });

  it('returns null for all time', () => {
    expect(resolveRange('all', {}, now)).toBeNull();
  });

  it('treats a custom range with one date as that whole day', () => {
    expect(resolveRange('custom', { from: '2026-09-01' }, now)).toEqual({
      from: new Date(2026, 8, 1),
      to: new Date(2026, 8, 1, 23, 59, 59, 999),
    });
  });

  it('orders a reversed custom range and caps it at now', () => {
    expect(resolveRange('custom', { from: '2026-09-14', to: '2026-09-10' }, now)).toEqual({
      from: new Date(2026, 8, 10),
      to: now,
    });
  });

  it('returns null for a custom range without a valid start', () => {
    expect(resolveRange('custom', { from: 'nope' }, now)).toBeNull();
  });
});

describe('helpers', () => {
  it('validates presets from the URL', () => {
    expect(isRangePreset('30d')).toBe(true);
    expect(isRangePreset('90d')).toBe(false);
    expect(isRangePreset(null)).toBe(false);
  });

  it('parses date inputs as local dates', () => {
    expect(parseDateInput('2026-02-03')).toEqual(new Date(2026, 1, 3));
    expect(parseDateInput('')).toBeNull();
  });

  it('names the comparison period', () => {
    expect(comparisonLabel('today')).toBe('vs yesterday');
    expect(comparisonLabel('custom')).toBe('vs previous period');
  });
});
