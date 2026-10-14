import { after, type NextRequest } from 'next/server';
import {
  DuplicateLeadError,
  IngestionInputError,
  createLeadFromPreview,
} from '@/services/lead-ingestion/intake';
import { runIngestionPipeline } from '@/services/lead-ingestion/pipeline';
import { MAX_PROFILE_CHARS } from '@/lib/validation/ingestionInput';
import type { AiExtractedData } from '@/services/lead-ingestion/aiExtractor';
import { clientKey, rateLimit } from '@/lib/api/rateLimit';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 60;

const MAX_BODY_BYTES = MAX_PROFILE_CHARS * 8;

/**
 * POST /api/lead-ingestion/confirm — saves the previewed lead and starts the
 * enrichment pipeline on the server, so closing the tab no longer leaves the
 * lead half-finished.
 */
export async function POST(request: NextRequest) {
  const limit = rateLimit(clientKey(request, 'ingestion-confirm'), 20, 5 * 60_000);
  if (!limit.ok) {
    return jsonError(`Too many leads created in a row. Try again in ${limit.retryAfter}s.`, 429);
  }

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return jsonError(
      `That text is too long. Keep it under ${MAX_PROFILE_CHARS.toLocaleString('en-US')} characters.`,
      413
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      content?: string;
      extraction?: AiExtractedData | null;
      force?: boolean;
    };

    const result = await createLeadFromPreview({
      rawText: body.content ?? '',
      extraction: body.extraction ?? null,
      force: !!body.force,
    });

    // Runs after the response is sent; the lead page only watches it.
    after(() => runIngestionPipeline(result.leadId));

    return jsonOk({ result }, 201);
  } catch (error) {
    if (error instanceof DuplicateLeadError) {
      return jsonError(error.message, error.status, { duplicate: error.duplicate });
    }
    if (error instanceof IngestionInputError) return jsonError(error.message, error.status);
    console.error('[ingestion] confirm failed:', error instanceof Error ? error.message : error);
    return jsonError('The lead could not be saved. Please try again.', 500);
  }
}
