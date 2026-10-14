const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat(undefined);

/** 1,284 below ten thousand, then 12.9K / 4.2M, in the viewer's locale. */
export function formatNumber(value: number): string {
  return Math.abs(value) >= 10_000 ? compact.format(value) : whole.format(value);
}

export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '–';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/**
 * A change against the previous period. Growth from nothing has no percentage,
 * and a huge jump reads as "12×" rather than "1,200%".
 */
export function formatChange(value: number, previous: number): { text: string; hint?: string } {
  const diff = value - previous;
  if (diff === 0) return { text: 'No change' };
  if (previous === 0) return { text: `+${formatNumber(Math.abs(diff))}`, hint: 'none before' };
  const ratio = Math.abs(diff) / previous;
  if (ratio >= 10) return { text: `${formatNumber(Math.round(ratio))}×` };
  return { text: `${Math.round(ratio * 100)}%` };
}

export function share(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

/** A short date in the viewer's locale, e.g. "14 Oct 2026". */
export function formatDay(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '–';
  const seconds = Math.max(0, Math.round((now.getTime() - target.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDay(target);
}
