import { type NextRequest } from 'next/server';
import {
  SampleProfileError,
  createSampleProfile,
  listSampleProfiles,
} from '@/services/sample-profiles/sampleProfiles';
import { clientKey, rateLimit } from '@/lib/api/rateLimit';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 30;

/** GET /api/sample-profiles — the saved profile samples, seeded on first use. */
export async function GET() {
  try {
    return jsonOk({ samples: await listSampleProfiles() });
  } catch (error) {
    console.error('[sample-profiles] list failed:', error instanceof Error ? error.message : error);
    return jsonError('Could not load the saved samples.', 500);
  }
}

/** POST /api/sample-profiles — save a new sample. */
export async function POST(request: NextRequest) {
  const limit = rateLimit(clientKey(request, 'sample-profiles-write'), 30, 5 * 60_000);
  if (!limit.ok) return jsonError(`Too many changes at once. Try again in ${limit.retryAfter}s.`, 429);

  try {
    const body = (await request.json().catch(() => ({}))) as { title?: string; content?: string };
    const sample = await createSampleProfile(body);
    return jsonOk({ sample }, 201);
  } catch (error) {
    if (error instanceof SampleProfileError) return jsonError(error.message, error.status);
    console.error('[sample-profiles] create failed:', error instanceof Error ? error.message : error);
    return jsonError('Could not save that sample.', 500);
  }
}
