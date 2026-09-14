import type { DashboardStats } from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export async function getDashboardStatsApi(
  range: { from: Date; to: Date } | null,
  signal?: AbortSignal
): Promise<DashboardStats> {
  const params = new URLSearchParams({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (range) {
    params.set('from', range.from.toISOString());
    params.set('to', range.to.toISOString());
  }
  const res = await fetch(`${BASE}/dashboard?${params.toString()}`, { cache: 'no-store', signal });
  const body = (await res.json().catch(() => ({}))) as { stats?: DashboardStats; error?: string };
  if (!res.ok || !body.stats) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.stats;
}
