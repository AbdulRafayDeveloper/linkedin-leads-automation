import { after, type NextRequest } from 'next/server';
import { getLeadById } from '@/lib/db/operations/read';
import { updateLead } from '@/lib/db/operations/update';
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

    const updated = await updateLead(id, { enrichmentStatus: 'QUEUED', enrichmentError: null });
    after(() => enrichLead(id));

    return jsonOk({ lead: updated });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to queue enrichment',
      500
    );
  }
}
