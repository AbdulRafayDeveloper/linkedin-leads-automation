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

/**
 * Resolves a preset to concrete instants in the browser's time zone. Returns
 * null for all time, or for a custom range that has no valid start date.
 * A custom range with only a start date covers that single day.
 */
export function resolveRange(
  preset: RangePreset,
  custom: { from?: string | null; to?: string | null } = {},
  now: Date = new Date()
): { from: Date; to: Date } | null {
  const daysBack = (days: number) => {
    const start = startOfDay(now);
    start.setDate(start.getDate() - (days - 1));
    return start;
  };

  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: now };
    case '7d':
      return { from: daysBack(7), to: now };
    case '30d':
      return { from: daysBack(30), to: now };
    case 'custom': {
      const from = parseDateInput(custom.from);
      if (!from) return null;
      const toDay = parseDateInput(custom.to) ?? from;
      const [start, end] = toDay < from ? [toDay, from] : [from, toDay];
      const to = endOfDay(end);
      return { from: startOfDay(start), to: to > now ? now : to };
    }
    default:
      return null;
  }
}

/** Wording for the delta line under each KPI. */
export function comparisonLabel(preset: RangePreset): string {
  if (preset === 'today') return 'vs yesterday';
  if (preset === '7d') return 'vs previous 7 days';
  if (preset === '30d') return 'vs previous 30 days';
  return 'vs previous period';
}
