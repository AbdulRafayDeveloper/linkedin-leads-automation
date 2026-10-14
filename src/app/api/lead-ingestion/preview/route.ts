import { type NextRequest } from 'next/server';
import { IngestionInputError, previewIngestion } from '@/services/lead-ingestion/intake';
import { MAX_PROFILE_CHARS } from '@/lib/validation/ingestionInput';
import { clientKey, rateLimit } from '@/lib/api/rateLimit';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 60;

/** Bytes we are willing to read before rejecting: the char cap plus JSON overhead. */
const MAX_BODY_BYTES = MAX_PROFILE_CHARS * 4;

/**
 * POST /api/lead-ingestion/preview — reads the pasted text with the AI and
 * reports what it found. Writes nothing, so a bad paste costs one model call
 * and no records.
 */
export async function POST(request: NextRequest) {
  const limit = rateLimit(clientKey(request, 'ingestion-preview'), 15, 5 * 60_000);
  if (!limit.ok) {
    return jsonError(`Too many extractions in a row. Try again in ${limit.retryAfter}s.`, 429);
  }

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return jsonError(
      `That text is too long. Keep it under ${MAX_PROFILE_CHARS.toLocaleString('en-US')} characters.`,
      413
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { content?: string };
    const preview = await previewIngestion(body.content ?? '');
    return jsonOk({ preview });
  } catch (error) {
    if (error instanceof IngestionInputError) return jsonError(error.message, error.status);
    console.error('[ingestion] preview failed:', error instanceof Error ? error.message : error);
    return jsonError(
      'The AI could not read this profile right now. Please try again in a moment.',
      502
    );
  }
}
