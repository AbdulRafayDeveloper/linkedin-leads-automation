import { ApiError, type LeadIngestionRecord } from './apiClient';

/**
 * Browser wrapper for the Ready to Send page. Kept apart from apiClient.ts so
 * the page's query contract lives next to its readiness rules.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

/** A lead as `GET /api/leads` returns it: the record plus its client's name. */
export type ReadyLeadRecord = LeadIngestionRecord & { clientName?: string | null };

export interface ReadyLeadsPage {
  leads: ReadyLeadRecord[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasMore: boolean;
}

export interface ReadyLeadsParams {
  /** Words that must all match a name, company, email or URL of the lead. */
  search?: string;
  /** ISO instants for the lead's import date, resolved in the browser's zone. */
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/**
 * Leads with at least one approved draft that is not in a campaign yet
 * (the `readyToSend` filter of `GET /api/leads`, see `readyToSend.ts`).
 */
export async function getReadyToSendLeadsApi(params: ReadyLeadsParams, signal?: AbortSignal): Promise<ReadyLeadsPage> {
  const q = new URLSearchParams({ readyToSend: 'true' });
  if (params.search) q.set('search', params.search);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));

  const res = await fetch(`${BASE}/leads?${q.toString()}`, { cache: 'no-store', signal });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(d.message ?? d.error ?? `HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as ReadyLeadsPage;
}
