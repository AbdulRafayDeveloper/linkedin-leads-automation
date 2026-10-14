import type { SampleProfileRecord } from './sampleProfiles';

/** Browser wrappers for the saved profile samples. */

const BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      cache: 'no-store',
      ...init,
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.success === false) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed (HTTP ${response.status}).`);
  }
  return payload as T;
}

export async function listSamplesApi(): Promise<SampleProfileRecord[]> {
  const data = await call<{ samples: SampleProfileRecord[] }>('/sample-profiles');
  return data.samples;
}

export async function createSampleApi(input: { title: string; content: string }): Promise<SampleProfileRecord> {
  const data = await call<{ sample: SampleProfileRecord }>('/sample-profiles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.sample;
}

export async function updateSampleApi(
  id: string,
  input: { title: string; content: string }
): Promise<SampleProfileRecord> {
  const data = await call<{ sample: SampleProfileRecord }>(`/sample-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return data.sample;
}

export async function deleteSampleApi(id: string): Promise<void> {
  await call(`/sample-profiles/${id}`, { method: 'DELETE' });
}

export type { SampleProfileRecord };
