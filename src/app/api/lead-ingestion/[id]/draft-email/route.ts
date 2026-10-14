import { type NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api/response';
import { clientKey, rateLimit } from '@/lib/api/rateLimit';
import { DraftWriteError, mutateDraftEmail, type EmailAction } from '@/services/lead-ingestion/draftWrites';

// SMTP verification does DNS plus a socket handshake; give it room to finish.
export const maxDuration = 60;

const ACTIONS: EmailAction[] = ['add', 'remove', 'replace', 'verify'];

/** Verification is slow and talks to other mail servers: cap how often it runs. */
const VERIFY_LIMIT = 30;
const VERIFY_WINDOW_MS = 5 * 60 * 1000;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Adds, removes, replaces or re-verifies one contact address of a draft box. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      companyIndex?: unknown;
      action?: unknown;
      email?: unknown;
      newEmail?: unknown;
    };

    const companyIndex = Number(body.companyIndex);
    if (!Number.isInteger(companyIndex) || companyIndex < -1) {
      return jsonError('companyIndex must be -1 (personal) or a company position', 400);
    }
    if (!ACTIONS.includes(body.action as EmailAction)) {
      return jsonError(`action must be one of: ${ACTIONS.join(', ')}`, 400);
    }
    if (typeof body.email !== 'string' || !body.email.trim()) {
      return jsonError('email is required', 400);
    }

    const action = body.action as EmailAction;
    if (action !== 'remove') {
      const limit = rateLimit(clientKey(request, 'smtp-verify'), VERIFY_LIMIT, VERIFY_WINDOW_MS);
      if (!limit.ok) {
        return jsonError(
          `Too many SMTP verifications. Try again in ${limit.retryAfter} seconds.`,
          429
        );
      }
    }

    const { detail, status } = await mutateDraftEmail(
      id,
      companyIndex,
      action,
      body.email,
      typeof body.newEmail === 'string' ? body.newEmail : undefined
    );

    return jsonOk({ draft: detail, status });
  } catch (error) {
    if (error instanceof DraftWriteError) return jsonError(error.message, error.status);
    return jsonError(error instanceof Error ? error.message : 'Failed to update contact email', 500);
  }
}
