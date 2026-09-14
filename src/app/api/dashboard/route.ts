import type { NextRequest } from 'next/server';
import { getDashboardStats } from '@/services/dashboard/dashboardStats';
import { jsonError, jsonOk } from '@/lib/api/response';

function parseDate(value: string | null): Date | null | 'invalid' {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

/**
 * GET /api/dashboard?from=<ISO>&to=<ISO>&tz=<IANA zone>
 * Omit `from` for all-time stats; `to` defaults to now. The browser sends the
 * range already resolved in its own time zone.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const from = parseDate(searchParams.get('from'));
    const to = parseDate(searchParams.get('to'));
    if (from === 'invalid' || to === 'invalid') {
      return jsonError('"from" and "to" must be valid ISO dates', 422);
    }
    if (from && to && from > to) {
      return jsonError('"from" must be before "to"', 422);
    }

    const stats = await getDashboardStats({ from, to, timeZone: searchParams.get('tz') });
    return jsonOk({ stats });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load dashboard stats', 500);
  }
}
