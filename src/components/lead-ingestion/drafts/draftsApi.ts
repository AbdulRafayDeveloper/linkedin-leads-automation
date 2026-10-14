import type {
  DraftApprovalFilter,
  DraftCounts,
  DraftDetail,
  DraftItem,
  DraftSendStatusFilter,
  DraftSmtpFilter,
} from '@/services/lead-ingestion/draftItems';
import type { EmailValidationStatus } from '@/lib/db/models/LeadIngestion';

/**
 * Browser calls for the Drafts page. Same-origin `/api` paths, every call
 * cancellable through an AbortSignal so filter changes and fast typing can't
 * land out of order.
 */

const BASE = '/api';

async function handle<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export interface DraftListParams {
  page: number;
  limit?: number;
  search?: string;
  clientId?: string;
  approval?: DraftApprovalFilter;
  smtp?: DraftSmtpFilter;
  sendStatus?: DraftSendStatusFilter;
}

export interface DraftListResponse {
  items: DraftItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasMore: boolean;
  counts: DraftCounts;
  truncated: boolean;
}

export function fetchDrafts(params: DraftListParams, signal?: AbortSignal): Promise<DraftListResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit ?? 12),
    approval: params.approval ?? 'all',
    smtp: params.smtp ?? 'all',
    sendStatus: params.sendStatus ?? 'all',
    clientId: params.clientId || 'all',
    ...(params.search?.trim() ? { search: params.search.trim() } : {}),
  });
  return fetch(`${BASE}/lead-ingestion/drafts?${query.toString()}`, { cache: 'no-store', signal }).then(
    handle<DraftListResponse>
  );
}

export function fetchDraft(
  leadId: string,
  companyIndex: number,
  signal?: AbortSignal
): Promise<{ draft: DraftDetail }> {
  return fetch(`${BASE}/lead-ingestion/${leadId}/draft?companyIndex=${companyIndex}`, {
    cache: 'no-store',
    signal,
  }).then(handle<{ draft: DraftDetail }>);
}

export interface DraftPatchBody {
  subject?: string;
  bodyHtml?: string;
  approved?: boolean;
  websiteUrl?: string | null;
}

export function patchDraft(
  leadId: string,
  companyIndex: number,
  patch: DraftPatchBody,
  signal?: AbortSignal
): Promise<{ draft: DraftDetail }> {
  return fetch(`${BASE}/lead-ingestion/${leadId}/draft`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyIndex, ...patch }),
    signal,
  }).then(handle<{ draft: DraftDetail }>);
}

export function mutateDraftEmail(
  leadId: string,
  companyIndex: number,
  action: 'add' | 'remove' | 'replace' | 'verify',
  email: string,
  newEmail?: string,
  signal?: AbortSignal
): Promise<{ draft: DraftDetail; status: EmailValidationStatus | null }> {
  return fetch(`${BASE}/lead-ingestion/${leadId}/draft-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyIndex, action, email, newEmail }),
    signal,
  }).then(handle<{ draft: DraftDetail; status: EmailValidationStatus | null }>);
}

/** Crawls the box's website; the URL must already be saved on the draft. */
export function crawlDraftWebsite(
  leadId: string,
  companyIndex: number,
  signal?: AbortSignal
): Promise<unknown> {
  return fetch(`${BASE}/lead-ingestion/${leadId}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyIndex: companyIndex === -1 ? undefined : companyIndex }),
    signal,
  }).then(handle<unknown>);
}

export function refineDraft(
  leadId: string,
  companyIndex: number,
  prompt: string,
  signal?: AbortSignal
): Promise<unknown> {
  return fetch(`${BASE}/lead-ingestion/${leadId}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, companyIndex }),
    signal,
  }).then(handle<unknown>);
}

export interface DraftClientOption {
  _id: string;
  name: string;
}

export function fetchClients(
  search: string,
  page: number,
  signal?: AbortSignal
): Promise<{ clients: DraftClientOption[]; hasMore: boolean }> {
  const query = new URLSearchParams({
    page: String(page),
    limit: '10',
    ...(search.trim() ? { search: search.trim() } : {}),
  });
  return fetch(`${BASE}/clients?${query.toString()}`, { cache: 'no-store', signal }).then(
    handle<{ clients: DraftClientOption[]; hasMore: boolean }>
  );
}
