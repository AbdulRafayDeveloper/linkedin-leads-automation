import { type NextRequest } from 'next/server';
import {
  SampleProfileError,
  deleteSampleProfile,
  updateSampleProfile,
} from '@/services/sample-profiles/sampleProfiles';
import { clientKey, rateLimit } from '@/lib/api/rateLimit';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** PUT /api/sample-profiles/[id] — rename or rewrite a sample. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const limit = rateLimit(clientKey(request, 'sample-profiles-write'), 30, 5 * 60_000);
  if (!limit.ok) return jsonError(`Too many changes at once. Try again in ${limit.retryAfter}s.`, 429);

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { title?: string; content?: string };
    const sample = await updateSampleProfile(id, body);
    return jsonOk({ sample });
  } catch (error) {
    if (error instanceof SampleProfileError) return jsonError(error.message, error.status);
    console.error('[sample-profiles] update failed:', error instanceof Error ? error.message : error);
    return jsonError('Could not save that sample.', 500);
  }
}

/** DELETE /api/sample-profiles/[id] — remove a sample. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const limit = rateLimit(clientKey(request, 'sample-profiles-write'), 30, 5 * 60_000);
  if (!limit.ok) return jsonError(`Too many changes at once. Try again in ${limit.retryAfter}s.`, 429);

  try {
    const { id } = await params;
    await deleteSampleProfile(id);
    return jsonOk({ deleted: true });
  } catch (error) {
    if (error instanceof SampleProfileError) return jsonError(error.message, error.status);
    console.error('[sample-profiles] delete failed:', error instanceof Error ? error.message : error);
    return jsonError('Could not delete that sample.', 500);
  }
}
