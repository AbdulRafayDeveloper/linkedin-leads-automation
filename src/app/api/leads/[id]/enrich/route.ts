import { after, type NextRequest } from 'next/server';
import { getLeadById } from '@/lib/db/operations/read';
import { enrichLead } from '@/lib/enrichment/enrichLead';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const lead = await getLeadById(id);
    if (!lead) return jsonError('Lead not found', 404);

    // Do not force-reset enrichmentStatus here: enrichLead() atomically
    // claims the lead itself (only proceeding from an idle/terminal status).
    // Resetting it unconditionally would let this request race an
    // already-running automatic enrichment and produce duplicate emails.
    after(() => enrichLead(id));

    return jsonOk({ lead });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to queue enrichment',
      500
    );
  }
}
