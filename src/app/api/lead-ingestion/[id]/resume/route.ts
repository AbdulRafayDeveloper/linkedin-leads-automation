import { after, type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion, type PipelineStage } from '@/lib/db/models/LeadIngestion';
import { isPipelineRunning, runIngestionPipeline } from '@/services/lead-ingestion/pipeline';
import { clientKey, rateLimit } from '@/lib/api/rateLimit';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/lead-ingestion/[id]/resume — restarts the enrichment pipeline for a
 * lead that stalled (a serverless timeout, a crash, a closed tab mid-run). Does
 * nothing while a run is still alive, so it is safe to call from the UI.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError('Invalid lead ID', 400);

    const limit = rateLimit(clientKey(request, `ingestion-resume:${id}`), 6, 60_000);
    if (!limit.ok) return jsonError(`Already retrying. Try again in ${limit.retryAfter}s.`, 429);

    await connectToMongoDB();
    const lead = await LeadIngestion.findById(id)
      .select('pipelineStage pipelineStartedAt')
      .lean<{ pipelineStage: PipelineStage; pipelineStartedAt: Date | null } | null>();
    if (!lead) return jsonError('Lead not found', 404);

    if (lead.pipelineStage === 'done') return jsonOk({ started: false, stage: 'done' });
    if (isPipelineRunning(lead)) return jsonOk({ started: false, stage: lead.pipelineStage });

    after(() => runIngestionPipeline(id));
    return jsonOk({ started: true, stage: lead.pipelineStage });
  } catch (error) {
    console.error('[ingestion] resume failed:', error instanceof Error ? error.message : error);
    return jsonError('Could not restart processing for this lead.', 500);
  }
}
