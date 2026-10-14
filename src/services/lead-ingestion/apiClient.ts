export interface ClientRecord {
  _id: string;
  name: string;
  linkedinUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerifiedEmailItem {
  email: string;
  status: 'pending' | 'valid' | 'invalid' | 'risky' | 'unknown';
}

export interface CurrentCompanyItem {
  companyName: string;
  jobTitle: string;
  workPeriod: string | null;
  websiteUrl: string | null;
  // Note: stored as 'summary' in DB but may also appear as 'roleSummary' from AI extractor
  summary?: string;
  roleSummary?: string;
  companyEmails?: string[];
  emailSubject?: string | null;
  emailBody?: string | null;
  approved?: boolean;
  inCampaign?: boolean;
  campaignSendStatus?: 'pending' | 'sending' | 'delivered' | 'opened' | 'failed' | 'in_progress';
}

export interface LeadIngestionRecord {
  _id: string;
  clientId: string;
  rawText: string;
  summary: string | null;
  fullName: string | null;
  companyName: string | null;
  jobTitle: string | null;
  workPeriod: string | null;
  email: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  portfolioUrl: string | null;
  siteType: 'company_website' | 'personal_portfolio' | 'unknown';
  additionalUrls: string[];
  currentCompanies: CurrentCompanyItem[];
  status: 'processing' | 'completed' | 'failed';
  discoveredEmails: string[];
  discoveredPhones: string[];
  verifiedEmails: VerifiedEmailItem[];
  emailValidationStatus: 'pending' | 'valid' | 'invalid' | 'risky' | 'unknown';
  emailValidationDetails: string | null;
  crawlStatus: 'not_started' | 'in_progress' | 'completed' | 'failed';
  emailSubject: string | null;
  emailBody: string | null;
  approved: boolean;
  inCampaign?: boolean;
  campaignSendStatus?: 'pending' | 'sending' | 'delivered' | 'opened' | 'failed' | 'in_progress';
  emailStatus: 'pending' | 'in_progress' | 'delivered' | 'opened' | 'failed';
  createdAt: string;
  updatedAt: string;
}

const BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { message?: string; error?: string };
    throw new ApiError(d.message ?? d.error ?? `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

/** Thrown by the API wrappers so callers can react to specific statuses (e.g. 409). */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function getClientsApi(): Promise<{ clients: ClientRecord[] }> {
  return handle(await fetch(`${BASE}/clients`, { cache: 'no-store' }));
}

export async function createClientApi(name: string): Promise<{ result: ClientRecord }> {
  return handle(await fetch(`${BASE}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }));
}

export async function getIngestedLeadsApi(clientId: string): Promise<{ results: LeadIngestionRecord[] }> {
  return handle(await fetch(`${BASE}/lead-ingestion?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' }));
}

export async function crawlLeadWebsiteApi(
  id: string,
  websiteUrl?: string,
  additionalUrls?: string[],
  companyIndex?: number
): Promise<{ result: LeadIngestionRecord }> {
  return handle(await fetch(`${BASE}/lead-ingestion/${id}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ websiteUrl, additionalUrls, companyIndex }),
  }));
}

export async function generateLeadEmailApi(
  id: string,
  userPrompt?: string,
  companyIndex?: number
): Promise<{ result: LeadIngestionRecord }> {
  return handle(await fetch(`${BASE}/lead-ingestion/${id}/generate-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userPrompt, companyIndex, forceRegenerate: true }),
  }));
}

export async function refineLeadEmailApi(
  id: string,
  prompt: string,
  companyIndex?: number
): Promise<{ result: LeadIngestionRecord }> {
  return handle(await fetch(`${BASE}/lead-ingestion/${id}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, companyIndex }),
  }));
}

export type CampaignItemStatus = 'pending' | 'sending' | 'delivered' | 'failed' | 'opened';
export type CampaignStatus = 'draft' | 'running' | 'completed' | 'paused';

export interface CampaignItemRecord {
  _id: string;
  leadId: string;
  companyIndex: number;
  candidateName: string;
  clientName: string;
  companyName: string;
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  status: CampaignItemStatus;
  errorMessage?: string | null;
  attempts?: number;
  sendingStartedAt?: string | null;
  sentAt?: string | null;
  openedAt?: string | null;
  failedAt?: string | null;
}

/** A campaign as the list endpoint returns it: counts only, no items. */
export interface CampaignSummaryRecord {
  _id: string;
  name: string;
  status: CampaignStatus;
  totalEmails: number;
  /** Delivered + opened. Failures are not counted. */
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  failedCount: number;
  pendingCount: number;
  sendingCount: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  /** True while a browser tab is actively driving this campaign. */
  isRunnerActive: boolean;
  activeRunnerId: string | null;
  lastDispatchAt: string | null;
  runnerHeartbeatAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CampaignRecord extends CampaignSummaryRecord {
  items: CampaignItemRecord[];
}

export type CampaignSortField =
  | 'createdAt'
  | 'updatedAt'
  | 'name'
  | 'totalEmails'
  | 'deliveredCount'
  | 'failedCount'
  | 'openedCount'
  | 'status';

export interface CampaignListResponse {
  campaigns: CampaignSummaryRecord[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasMore: boolean;
  sort: CampaignSortField;
  order: 'asc' | 'desc';
  openTrackingEnabled: boolean;
}

export interface DispatchBatchResponse {
  processedCount: number;
  successCount: number;
  failedCount: number;
  /** Items still eligible for the mode that was requested (pending, plus failed when retrying). */
  remainingCount: number;
  pendingCount: number;
  message?: string;
  item?: CampaignItemRecord;
  campaign: CampaignRecord;
}

export async function updateLeadDetailsApi(
  id: string,
  updates: Partial<LeadIngestionRecord> & {
    addManualEmail?: string;
    forceVerifyEmail?: string;
    /** SMTP-verify company emails without polluting the personal discoveredEmails pool */
    verifyCompanyEmails?: string[];
  }
): Promise<{ result: LeadIngestionRecord }> {
  return handle(await fetch(`${BASE}/lead-ingestion/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }));
}

export async function getCampaignsApi(
  params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    sort?: CampaignSortField;
    order?: 'asc' | 'desc';
  },
  init?: { signal?: AbortSignal }
): Promise<CampaignListResponse> {
  const q = new URLSearchParams();
  if (params?.page) q.set('page', params.page.toString());
  if (params?.limit) q.set('limit', params.limit.toString());
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  if (params?.sort) q.set('sort', params.sort);
  if (params?.order) q.set('order', params.order);
  return handle(await fetch(`${BASE}/campaigns?${q.toString()}`, { cache: 'no-store', signal: init?.signal }));
}

export async function createCampaignApi(data: {
  name: string;
  status?: 'draft' | 'running';
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  items: Array<{
    leadId: string;
    companyIndex: number;
    candidateName: string;
    clientName: string;
    companyName: string;
    recipientEmail: string;
    subject: string;
    bodyHtml: string;
  }>;
}): Promise<{ campaign: CampaignRecord }> {
  return handle(await fetch(`${BASE}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function getCampaignDetailsApi(
  id: string,
  init?: { signal?: AbortSignal }
): Promise<{ campaign: CampaignRecord; openTrackingEnabled: boolean }> {
  return handle(await fetch(`${BASE}/campaigns/${id}`, { cache: 'no-store', signal: init?.signal }));
}

export interface CampaignUpdate {
  name?: string;
  /** `running` is set by the dispatch route only. */
  status?: 'draft' | 'paused' | 'completed';
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  runnerId?: string;
}

export async function updateCampaignApi(id: string, updates: CampaignUpdate): Promise<{ campaign: CampaignRecord }> {
  return handle(await fetch(`${BASE}/campaigns/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }));
}

export async function deleteCampaignApi(
  id: string,
  options?: { force?: boolean }
): Promise<{ message: string; releasedDrafts: number }> {
  const q = options?.force ? '?force=true' : '';
  return handle(await fetch(`${BASE}/campaigns/${id}${q}`, { method: 'DELETE' }));
}

export async function dispatchCampaignBatchApi(
  id: string,
  data?: { itemIds?: string[]; rerunFailed?: boolean; runnerId?: string; takeover?: boolean }
): Promise<DispatchBatchResponse> {
  return handle(await fetch(`${BASE}/campaigns/${id}/dispatch-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data ?? {}),
  }));
}

export interface PromptRecord {
  key: string;
  title: string;
  description: string;
  stage: string;
  emptyBehavior: string;
  promptText: string;
  defaultText: string;
  isDefault: boolean;
  updatedAt: string | null;
}

export async function getPromptsApi(): Promise<{ prompts: PromptRecord[] }> {
  return handle(await fetch(`${BASE}/settings/prompts`, { cache: 'no-store' }));
}

export async function savePromptApi(key: string, promptText: string): Promise<{ prompt: PromptRecord }> {
  return handle(await fetch(`${BASE}/settings/prompts/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptText }),
  }));
}

