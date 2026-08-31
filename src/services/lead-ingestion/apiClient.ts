export interface ClientRecord {
  _id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadIngestionRecord {
  _id: string;
  clientId: string;
  rawText: string;
  summary: string | null;
  fullName: string | null;
  email: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  status: 'processing' | 'completed' | 'failed';
  discoveredEmails: string[];
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

const API_BASE = '/api';

async function handle<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok || body.success === false) {
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }
  return body as T;
}

export async function createClientApi(name: string): Promise<{ client: ClientRecord }> {
  const response = await fetch(`${API_BASE}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handle<{ client: ClientRecord }>(response);
}

export async function getClientsApi(): Promise<{ clients: ClientRecord[] }> {
  const response = await fetch(`${API_BASE}/clients`);
  return handle<{ clients: ClientRecord[] }>(response);
}

export async function processRawLeadApi(
  clientId: string,
  content: string
): Promise<{ result: LeadIngestionRecord }> {
  const response = await fetch(`${API_BASE}/lead-ingestion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, content }),
  });
  return handle<{ result: LeadIngestionRecord }>(response);
}

export async function updateLeadWebsiteApi(
  id: string,
  websiteUrl: string
): Promise<{ result: LeadIngestionRecord }> {
  const response = await fetch(`${API_BASE}/lead-ingestion/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ websiteUrl }),
  });
  return handle<{ result: LeadIngestionRecord }>(response);
}

export async function getIngestedLeadsApi(
  clientId: string
): Promise<{ results: LeadIngestionRecord[] }> {
  const response = await fetch(`${API_BASE}/lead-ingestion?clientId=${clientId}`);
  return handle<{ results: LeadIngestionRecord[] }>(response);
}

export async function triggerLeadCrawlApi(
  id: string
): Promise<{ result: LeadIngestionRecord }> {
  const response = await fetch(`${API_BASE}/lead-ingestion/${id}/crawl`, {
    method: 'POST',
  });
  return handle<{ result: LeadIngestionRecord }>(response);
}

export async function generateLeadEmailApi(
  id: string,
  userPrompt?: string
): Promise<{ result: LeadIngestionRecord }> {
  const response = await fetch(`${API_BASE}/lead-ingestion/${id}/generate-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userPrompt }),
  });
  return handle<{ result: LeadIngestionRecord }>(response);
}

export async function updateLeadDetailsApi(
  id: string,
  updates: Partial<LeadIngestionRecord>
): Promise<{ result: LeadIngestionRecord }> {
  const response = await fetch(`${API_BASE}/lead-ingestion/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return handle<{ result: LeadIngestionRecord }>(response);
}

export async function refineLeadEmailApi(
  id: string,
  refinementPrompt: string
): Promise<{ result: LeadIngestionRecord }> {
  const response = await fetch(`${API_BASE}/lead-ingestion/${id}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refinementPrompt }),
  });
  return handle<{ result: LeadIngestionRecord }>(response);
}

export async function bulkSendEmailsApi(
  clientId: string
): Promise<{ count: number; message: string }> {
  const response = await fetch(`${API_BASE}/lead-ingestion/bulk-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId }),
  });
  return handle<{ count: number; message: string }>(response);
}
