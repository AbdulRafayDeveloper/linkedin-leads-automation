import type { NextRequest } from 'next/server';
import { getDashboardStats } from '@/services/dashboard/dashboardStats';
import { MAX_RANGE_DAYS, isValidTimeZone } from '@/services/dashboard/timeBuckets';
import type { DashboardStats } from '@/services/dashboard/types';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Repeat views of the same range (double click, refresh, two tabs) reuse this. */
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; stats: DashboardStats }>();

// Date only, or a full ISO instant. Anything looser ("2026", "last tuesday")
// used to be accepted and silently turned into a range nobody asked for.
const ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

class BadRequest extends Error {}

function parseDate(value: string | null, label: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!ISO_PATTERN.test(trimmed)) {
    throw new BadRequest(`"${label}" must be an ISO date, for example 2026-10-14T00:00:00.000Z`);
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new BadRequest(`"${label}" is not a real date`);
  return date;
}

/**
 * GET /api/dashboard?from=<ISO>&to=<ISO>&tz=<IANA zone>
 *   &compareFrom=<ISO>&compareTo=<ISO>
 *
 * Omit `from` for all-time stats. The browser resolves the range in its own
 * time zone and may send the comparison window explicitly, so "vs yesterday"
 * really means yesterday rather than the last N hours.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const now = new Date();

  let from: Date | null;
  let to: Date | null;
  let compareFrom: Date | null;
  let compareTo: Date | null;
  try {
    from = parseDate(searchParams.get('from'), 'from');
    to = parseDate(searchParams.get('to'), 'to');
    compareFrom = parseDate(searchParams.get('compareFrom'), 'compareFrom');
    compareTo = parseDate(searchParams.get('compareTo'), 'compareTo');
  } catch (error) {
    if (error instanceof BadRequest) return jsonError(error.message, 422);
    throw error;
  }

  const timeZone = searchParams.get('tz');
  if (timeZone && !isValidTimeZone(timeZone)) {
    return jsonError(`"${timeZone}" is not a known time zone`, 422);
  }

  // `to` alone used to be dropped on the floor and answered with all-time data.
  if (to && !from) {
    return jsonError('Set "from" as well as "to", or neither for all time', 422);
  }

  const rangeEnd = to ?? now;
  if (from && from > rangeEnd) {
    return jsonError('The start of the range is after its end', 422);
  }
  if (from && rangeEnd.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    return jsonError(`Choose a range of ${Math.round(MAX_RANGE_DAYS / 365)} years or less`, 422);
  }

  if ((compareFrom && !compareTo) || (compareTo && !compareFrom)) {
    return jsonError('Send both "compareFrom" and "compareTo", or neither', 422);
  }
  if (compareFrom && compareTo && compareFrom > compareTo) {
    return jsonError('The comparison window starts after it ends', 422);
  }

  const key = [from?.toISOString(), to?.toISOString(), compareFrom?.toISOString(), compareTo?.toISOString(), timeZone].join('|');
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) {
    return jsonOk({ stats: hit.stats });
  }

  try {
    const stats = await getDashboardStats({
      from,
      to,
      compare: compareFrom && compareTo ? { from: compareFrom, to: compareTo } : null,
      timeZone,
      now,
    });

    cache.set(key, { at: now.getTime(), stats });
    if (cache.size > 32) {
      for (const [entry, value] of cache) {
        if (now.getTime() - value.at > CACHE_TTL_MS) cache.delete(entry);
      }
    }

    return jsonOk({ stats });
  } catch (error) {
    // The driver message can name hosts and internals, so it stays in the logs.
    console.error('GET /api/dashboard failed:', error);
    return jsonError('Failed to load dashboard stats', 500);
  }
}
