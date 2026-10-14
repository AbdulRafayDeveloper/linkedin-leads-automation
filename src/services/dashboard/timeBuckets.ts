import type { Granularity } from './types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Keeps the chart readable: a range is bucketed coarsely enough to stay under this. */
export const MAX_BUCKETS = 130;

/** Longest range the dashboard will chart; anything longer is rejected. */
export const MAX_RANGE_DAYS = 3660;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Falls back to UTC for a missing or unknown IANA time zone. */
export function resolveTimeZone(timeZone?: string | null): string {
  if (!timeZone) return 'UTC';
  return isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

/**
 * Buckets are picked so a range never draws more bars than it can show: hours
 * for a day or two, days up to a quarter, weeks up to two years, months beyond.
 */
export function pickGranularity(from: Date, to: Date): Granularity {
  const span = to.getTime() - from.getTime();
  if (span <= 2 * DAY_MS) return 'hour';
  if (span <= 92 * DAY_MS) return 'day';
  if (span <= 730 * DAY_MS) return 'week';
  return 'month';
}

const pad = (n: number) => String(n).padStart(2, '0');

function partsOf(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/** The Monday (in `timeZone`) of the week this date falls in, as yyyy-mm-dd. */
function weekStartKey(parts: Record<string, string>): string {
  // Midday UTC, so the weekday is the local one on either side of a DST shift.
  const noon = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12);
  const daysSinceMonday = (new Date(noon).getUTCDay() + 6) % 7;
  const monday = new Date(noon - daysSinceMonday * DAY_MS);
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/**
 * Returns a function that maps a date to its bucket key in the given time
 * zone, so "today" means the viewer's today rather than the server's. The keys
 * match what the database produces in `mongoBucketKey`.
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
    const parts = partsOf(formatter, date);
    if (granularity === 'month') return `${parts.year}-${parts.month}`;
    if (granularity === 'week') return weekStartKey(parts);
    if (granularity === 'day') return `${parts.year}-${parts.month}-${parts.day}`;
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}`;
  };
}

/**
 * The same bucket key, built by MongoDB, so grouping can happen in the database
 * instead of pulling every document into the app.
 */
export function mongoBucketKey(
  granularity: Granularity,
  timeZone: string,
  field: string
): Record<string, unknown> {
  if (granularity === 'week') {
    return {
      $dateToString: {
        date: { $dateTrunc: { date: field, unit: 'week', startOfWeek: 'monday', timezone: timeZone } },
        format: '%Y-%m-%d',
        timezone: timeZone,
      },
    };
  }
  const format =
    granularity === 'month' ? '%Y-%m' : granularity === 'day' ? '%Y-%m-%d' : '%Y-%m-%d %H';
  return { $dateToString: { date: field, format, timezone: timeZone } };
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
  if (granularity === 'week' || granularity === 'day') {
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
 * range in hour steps (day steps for weeks and months) and keeps each new key,
 * which stays correct across DST changes.
 */
export function buildBuckets(from: Date, to: Date, granularity: Granularity, timeZone: string): Bucket[] {
  const keyOf = createBucketKey(granularity, timeZone);
  const startKey = keyOf(from);
  const endKey = keyOf(to);
  const multiDay = startKey.slice(0, 10) !== endKey.slice(0, 10);
  const { short, full } = labelFormatters(granularity, timeZone, multiDay);
  const step = granularity === 'hour' ? HOUR_MS : DAY_MS;

  const buckets: Bucket[] = [];
  const seen = new Set<string>();
  const push = (date: Date) => {
    const key = keyOf(date);
    if (seen.has(key)) return;
    seen.add(key);
    // A week bucket is labelled by its Monday, not by the date that produced it.
    const labelDate = granularity === 'week' ? new Date(`${key}T12:00:00Z`) : date;
    buckets.push({
      key,
      label: short.format(labelDate),
      fullLabel: granularity === 'week' ? `Week of ${full.format(labelDate)}` : full.format(date),
    });
  };

  for (let t = from.getTime(); t <= to.getTime(); t += step) push(new Date(t));
  push(to);
  return buckets;
}
