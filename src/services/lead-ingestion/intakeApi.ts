import type { AiExtractedData } from './aiExtractor';

/** Browser wrappers for the New Lead page: preview, then confirm. */

const BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export interface DuplicateLead {
  leadId: string;
  clientName: string | null;
  fullName: string | null;
  createdAt: string;
}

export interface PreviewSummary {
  fullName: string | null;
  companies: { companyName: string; jobTitle: string; websiteUrl: string | null }[];
  emails: string[];
  phones: string[];
  urls: string[];
}

export interface IngestionPreview {
  extraction: AiExtractedData;
  warnings: string[];
  summary: PreviewSummary;
  duplicate: DuplicateLead | null;
}

export interface CreatedLead {
  leadId: string;
  clientId: string;
  clientName: string;
  warnings: string[];
}

export class IngestionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly duplicate: DuplicateLead | null = null
  ) {
    super(message);
    this.name = 'IngestionApiError';
  }
}

/** Turns any failure into a sentence a person can act on. */
function friendlyNetworkMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Extraction cancelled.';
  if (error instanceof TypeError) return 'Could not reach the server. Check your connection and try again.';
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.';
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new IngestionApiError(friendlyNetworkMessage(error), 0);
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.success === false) {
    const message =
      typeof payload.error === 'string' && payload.error
        ? payload.error
        : `Request failed (HTTP ${response.status}).`;
    throw new IngestionApiError(message, response.status, (payload.duplicate as DuplicateLead) ?? null);
  }
  return payload as T;
}

export async function previewLeadApi(content: string, signal?: AbortSignal): Promise<IngestionPreview> {
  const data = await postJson<{ preview: IngestionPreview }>('/lead-ingestion/preview', { content }, signal);
  return data.preview;
}

export async function confirmLeadApi(
  input: { content: string; extraction: AiExtractedData | null; force?: boolean },
  signal?: AbortSignal
): Promise<CreatedLead> {
  const data = await postJson<{ result: CreatedLead }>('/lead-ingestion/confirm', input, signal);
  return data.result;
}

export async function resumeLeadPipelineApi(leadId: string): Promise<{ started: boolean; stage: string }> {
  return postJson<{ started: boolean; stage: string }>(`/lead-ingestion/${leadId}/resume`, {});
}
