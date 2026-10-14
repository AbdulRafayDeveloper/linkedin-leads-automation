import { type NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api/response';
import {
  DraftWriteError,
  draftDetail,
  loadLead,
  patchDraft,
  type DraftPatch,
} from '@/services/lead-ingestion/draftWrites';

export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseCompanyIndex(value: string | null | undefined): number {
  const index = Number(value);
  if (!Number.isInteger(index) || index < -1) {
    throw new DraftWriteError('companyIndex must be -1 (personal) or a company position', 400);
  }
  return index;
}

function fail(error: unknown) {
  if (error instanceof DraftWriteError) return jsonError(error.message, error.status);
  return jsonError(error instanceof Error ? error.message : 'Draft request failed', 500);
}

/** One draft, read fresh: what the editor loads when it opens. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const companyIndex = parseCompanyIndex(request.nextUrl.searchParams.get('companyIndex'));
    const doc = await loadLead(id);
    return jsonOk({ draft: await draftDetail(doc, companyIndex) });
  } catch (error) {
    return fail(error);
  }
}

/** Updates subject, body, approval or website URL of one draft box. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      companyIndex?: unknown;
      subject?: unknown;
      bodyHtml?: unknown;
      approved?: unknown;
      websiteUrl?: unknown;
    };

    const companyIndex = parseCompanyIndex(String(body.companyIndex ?? ''));
    const patch: DraftPatch = {};

    if (body.subject !== undefined) {
      if (typeof body.subject !== 'string') return jsonError('subject must be a string', 400);
      patch.subject = body.subject;
    }
    if (body.bodyHtml !== undefined) {
      if (typeof body.bodyHtml !== 'string') return jsonError('bodyHtml must be a string', 400);
      patch.bodyHtml = body.bodyHtml;
    }
    if (body.approved !== undefined) {
      if (typeof body.approved !== 'boolean') return jsonError('approved must be a boolean', 400);
      patch.approved = body.approved;
    }
    if (body.websiteUrl !== undefined) {
      if (body.websiteUrl !== null && typeof body.websiteUrl !== 'string') {
        return jsonError('websiteUrl must be a string or null', 400);
      }
      patch.websiteUrl = body.websiteUrl as string | null;
    }

    if (Object.keys(patch).length === 0) return jsonError('Nothing to update', 400);

    return jsonOk({ draft: await patchDraft(id, companyIndex, patch) });
  } catch (error) {
    return fail(error);
  }
}
