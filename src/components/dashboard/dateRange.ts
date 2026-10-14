export type RangePreset = 'today' | '7d' | '30d' | 'all' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

export const DEFAULT_PRESET: RangePreset = '7d';

export function isRangePreset(value: string | null): value is RangePreset {
  return RANGE_PRESETS.some((p) => p.value === value);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar-safe: shifting across a DST change still lands on the same clock time. */
function shiftDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - days);
  return copy;
}

/** Parses an `<input type="date">` value ("2026-09-14") as a local date. */
export function parseDateInput(value: string | null | undefined): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface ResolvedRange {
  from: Date;
  to: Date;
  /** The equivalent window just before, for the deltas. */
  compare: { from: Date; to: Date };
}

export type RangeResolution =
  | { kind: 'all' }
  | { kind: 'range'; range: ResolvedRange }
  /** The custom range can't be used; the dashboard says so instead of guessing. */
  | { kind: 'invalid'; message: string };

/**
 * Resolves a preset to concrete instants in the browser's time zone, together
 * with the window the deltas compare against: the same calendar length shifted
 * straight back, so "Today" is measured against yesterday at the same time.
 */
export function resolveRange(
  preset: RangePreset,
  custom: { from?: string | null; to?: string | null } = {},
  now: Date = new Date()
): RangeResolution {
  const lastDays = (days: number): RangeResolution => {
    const from = shiftDays(startOfDay(now), days - 1);
    return {
      kind: 'range',
      range: {
        from,
        to: now,
        compare: { from: shiftDays(from, days), to: shiftDays(now, days) },
      },
    };
  };

  switch (preset) {
    case 'today':
      return lastDays(1);
    case '7d':
      return lastDays(7);
    case '30d':
      return lastDays(30);
    case 'all':
      return { kind: 'all' };
    case 'custom': {
      const from = parseDateInput(custom.from);
      if (!from) {
        return { kind: 'invalid', message: 'Pick a start date to use a custom range.' };
      }
      if (from > endOfDay(now)) {
        return { kind: 'invalid', message: 'The start date is in the future.' };
      }
      // An empty end date means "up to now", not a single day.
      const rawTo = custom.to ? parseDateInput(custom.to) : null;
      if (custom.to && !rawTo) {
        return { kind: 'invalid', message: 'The end date is not a real date.' };
      }
      if (rawTo && rawTo < from) {
        return { kind: 'invalid', message: 'The start date must be on or before the end date.' };
      }
      const to = rawTo ? endOfDay(rawTo) : now;
      const capped = to > now ? now : to;
      const days = Math.max(1, Math.round((startOfDay(capped).getTime() - from.getTime()) / DAY_MS) + 1);
      return {
        kind: 'range',
        range: {
          from,
          to: capped,
          compare: { from: shiftDays(from, days), to: shiftDays(capped, days) },
        },
      };
    }
  }
}

/** Wording for the delta line under each KPI. */
export function comparisonLabel(preset: RangePreset): string {
  if (preset === 'today') return 'vs yesterday, same time';
  if (preset === '7d') return 'vs previous 7 days';
  if (preset === '30d') return 'vs previous 30 days';
  return 'vs previous period';
}
