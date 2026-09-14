import type { Granularity } from './types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Falls back to UTC for a missing or unknown IANA time zone. */
export function resolveTimeZone(timeZone?: string | null): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function pickGranularity(from: Date, to: Date): Granularity {
  const span = to.getTime() - from.getTime();
  if (span <= 2 * DAY_MS) return 'hour';
  if (span <= 120 * DAY_MS) return 'day';
  return 'month';
}

/**
 * Returns a function that maps a date to its bucket key in the given time
 * zone, so "today" means the viewer's today rather than the server's.
 */
export function createBucketKey(granularity: Granularity, timeZone: string): (date: Date) => string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });

  return (date: Date) => {
    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
    if (granularity === 'month') return `${parts.year}-${parts.month}`;
    if (granularity === 'day') return `${parts.year}-${parts.month}-${parts.day}`;
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}`;
  };
}

export interface Bucket {
  key: string;
  label: string;
  fullLabel: string;
}

function labelFormatters(granularity: Granularity, timeZone: string, multiDay: boolean) {
  const opts = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone, ...o });
  if (granularity === 'month') {
    return { short: opts({ month: 'short', year: 'numeric' }), full: opts({ month: 'long', year: 'numeric' }) };
  }
  if (granularity === 'day') {
    return {
      short: opts({ month: 'short', day: 'numeric' }),
      full: opts({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
    };
  }
  return {
    short: multiDay ? opts({ month: 'short', day: 'numeric', hour: 'numeric' }) : opts({ hour: 'numeric' }),
    full: opts({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }),
  };
}

/**
 * Lists every bucket between `from` and `to` (inclusive) in order. Walks the
 * range in hour steps (day steps for months) and keeps each new key, which
 * stays correct across DST changes.
 */
export function buildBuckets(from: Date, to: Date, granularity: Granularity, timeZone: string): Bucket[] {
  const keyOf = createBucketKey(granularity, timeZone);
  const startKey = keyOf(from);
  const endKey = keyOf(to);
  const multiDay = startKey.slice(0, 10) !== endKey.slice(0, 10);
  const { short, full } = labelFormatters(granularity, timeZone, multiDay);
  const step = granularity === 'month' ? DAY_MS : HOUR_MS;

  const buckets: Bucket[] = [];
  const seen = new Set<string>();
  const push = (date: Date) => {
    const key = keyOf(date);
    if (seen.has(key)) return;
    seen.add(key);
    buckets.push({ key, label: short.format(date), fullLabel: full.format(date) });
  };

  for (let t = from.getTime(); t <= to.getTime(); t += step) push(new Date(t));
  push(to);
  return buckets;
}
