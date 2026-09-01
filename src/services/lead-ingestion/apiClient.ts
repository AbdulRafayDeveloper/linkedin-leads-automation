export interface ClientRecord {
  _id: string;
  name: string;
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
  roleSummary: string;
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
  emailStatus: 'draft' | 'sending' | 'sent' | 'failed';
  createdAt: string;
  updatedAt: string;
}

const BASE = '/api';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(d.message ?? d.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
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
  additionalUrls?: string[]
): Promise<{ result: LeadIngestionRecord }> {
  return handle(await fetch(`${BASE}/lead-ingestion/${id}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ websiteUrl, additionalUrls }),
  }));
}

export async function generateLeadEmailApi(id: string, promptStyle?: string): Promise<{ result: LeadIngestionRecord }> {
  return handle(await fetch(`${BASE}/lead-ingestion/${id}/generate-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptStyle }),
  }));
}

export async function refineLeadEmailApi(id: string, prompt: string): Promise<{ result: LeadIngestionRecord }> {
  return handle(await fetch(`${BASE}/lead-ingestion/${id}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  }));
}

export async function updateLeadDetailsApi(id: string, updates: Partial<LeadIngestionRecord>): Promise<{ result: LeadIngestionRecord }> {
  return handle(await fetch(`${BASE}/lead-ingestion/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }));
}

export async function bulkSendEmailsApi(clientId: string): Promise<{ message: string; queuedCount: number }> {
  return handle(await fetch(`${BASE}/lead-ingestion/bulk-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId }),
  }));
}
