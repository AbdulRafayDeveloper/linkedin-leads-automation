import type { ApprovalStatus, LeadRecord, PaginatedResult, ProcessingResult, SentStatus, ValidationStatus } from '@/lib/types/lead';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

async function handle<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok || body.success === false) {
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }
  return body as T;
}

export interface LeadFilterParams {
  page?: number;
  limit?: number;
  approvalStatus?: ApprovalStatus;
  validationStatus?: ValidationStatus;
  sentStatus?: SentStatus;
  search?: string;
  startDate?: string;
  endDate?: string;
}

export async function fetchLeads(
  filters: LeadFilterParams = {}
): Promise<PaginatedResult<LeadRecord>> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const response = await fetch(`${API_BASE}/leads?${params.toString()}`);
  return handle<PaginatedResult<LeadRecord>>(response);
}

export async function fetchLead(id: string): Promise<{ lead: LeadRecord }> {
  const response = await fetch(`${API_BASE}/leads/${id}`);
  return handle(response);
}

export async function updateLeadApi(
  id: string,
  updates: Partial<LeadRecord>
): Promise<{ lead: LeadRecord }> {
  const response = await fetch(`${API_BASE}/leads/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return handle(response);
}

export async function deleteLeadApi(id: string): Promise<{ lead: LeadRecord }> {
  const response = await fetch(`${API_BASE}/leads/${id}`, { method: 'DELETE' });
  return handle(response);
}

export async function bulkDeleteLeadsApi(ids: string[]): Promise<{ deletedCount: number }> {
  const response = await fetch(`${API_BASE}/leads`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return handle(response);
}

export async function processLeadApi(
  content: string
): Promise<{ result: ProcessingResult; lead: LeadRecord }> {
  const response = await fetch(`${API_BASE}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return handle(response);
}

export async function enrichLeadApi(id: string): Promise<{ lead: LeadRecord }> {
  const response = await fetch(`${API_BASE}/leads/${id}/enrich`, { method: 'POST' });
  return handle(response);
}

export async function findCompanyWebsiteApi(
  id: string
): Promise<{ lead: LeadRecord; website: string | null }> {
  const response = await fetch(`${API_BASE}/leads/${id}/find-website`, { method: 'POST' });
  return handle(response);
}
