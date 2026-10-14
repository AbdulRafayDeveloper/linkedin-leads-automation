import type { ResolvedRange } from '@/components/dashboard/dateRange';
import type { DashboardStats } from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

/**
 * Loads the stats for one range. The range and its comparison window are
 * resolved in the browser, so every day boundary is the viewer's.
 */
export async function getDashboardStatsApi(
  range: ResolvedRange | null,
  signal?: AbortSignal
): Promise<DashboardStats> {
  const params = new URLSearchParams({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (range) {
    params.set('from', range.from.toISOString());
    params.set('to', range.to.toISOString());
    params.set('compareFrom', range.compare.from.toISOString());
    params.set('compareTo', range.compare.to.toISOString());
  }

  const res = await fetch(`${BASE}/dashboard?${params.toString()}`, { cache: 'no-store', signal });
  const body = (await res.json().catch(() => ({}))) as { stats?: DashboardStats; error?: string };
  if (!res.ok || !body.stats) throw new Error(body.error ?? `Could not load the dashboard (HTTP ${res.status})`);
  return body.stats;
}
