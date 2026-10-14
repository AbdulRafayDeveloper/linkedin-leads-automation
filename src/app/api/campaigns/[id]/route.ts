import { type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connectToMongoDB } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { jsonError, jsonOk } from '@/lib/api/response';
import {
  isRunnerActive,
  openTrackingEnabled,
  recomputeCounters,
  releaseUndeliveredLeadBoxes,
  repairStaleCampaigns,
  serializeCampaign,
} from '@/services/lead-ingestion/campaignService';
import { CAMPAIGN_NAME_MAX_LENGTH, normalizeDelays } from '@/services/lead-ingestion/campaignRunner';

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid campaign ID', 400);
    }

    await connectToMongoDB();
    await repairStaleCampaigns();

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return jsonError('Campaign not found', 404);
    }

    return jsonOk({ campaign: serializeCampaign(campaign), openTrackingEnabled: openTrackingEnabled() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to fetch campaign details', 500);
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Campaign name is required').max(CAMPAIGN_NAME_MAX_LENGTH, `Campaign name must be ${CAMPAIGN_NAME_MAX_LENGTH} characters or fewer`).optional(),
  // `running` is only ever set by the dispatch route, when an email really goes out.
  status: z.enum(['draft', 'paused', 'completed']).optional(),
  minDelaySeconds: z.number().optional(),
  maxDelaySeconds: z.number().optional(),
  /** The tab asking for the change; a pause from the active tab releases the runner lock. */
  runnerId: z.string().max(100).optional(),
});

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid campaign ID', 400);
    }

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? 'Invalid request', 422);
    }
    const body = parsed.data;

    await connectToMongoDB();
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return jsonError('Campaign not found', 404);
    }

    if (body.name !== undefined) {
      campaign.name = body.name;
    }

    if (body.minDelaySeconds !== undefined || body.maxDelaySeconds !== undefined) {
      const delays = normalizeDelays(
        body.minDelaySeconds ?? campaign.minDelaySeconds,
        body.maxDelaySeconds ?? campaign.maxDelaySeconds,
        { minDelaySeconds: campaign.minDelaySeconds, maxDelaySeconds: campaign.maxDelaySeconds }
      );
      campaign.minDelaySeconds = delays.minDelaySeconds;
      campaign.maxDelaySeconds = delays.maxDelaySeconds;
    }

    if (body.status !== undefined) {
      const otherTabRunning =
        isRunnerActive(campaign) && campaign.activeRunnerId && body.runnerId && campaign.activeRunnerId !== body.runnerId;
      if (otherTabRunning && body.status !== 'paused') {
        return jsonError('This campaign is being run in another tab. Pause it there first.', 409);
      }
      const counts = recomputeCounters(campaign);
      // A pause on a campaign with nothing left to send is really a completion:
      // happens when the last email went out while the user pressed Pause.
      campaign.status =
        body.status === 'paused' && counts.pending + counts.sending === 0 && counts.total > 0 ? 'completed' : body.status;
      campaign.activeRunnerId = null;
    }

    recomputeCounters(campaign);
    const saved = await campaign.save();
    return jsonOk({ campaign: serializeCampaign(saved) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to update campaign', 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid campaign ID', 400);
    }
    const force = request.nextUrl.searchParams.get('force') === 'true';

    await connectToMongoDB();
    await repairStaleCampaigns();

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return jsonError('Campaign not found', 404);
    }

    if (isRunnerActive(campaign) && !force) {
      return jsonError('This campaign is still sending. Pause it before deleting it.', 409);
    }

    const releasedDrafts = await releaseUndeliveredLeadBoxes(campaign.items);
    await Campaign.deleteOne({ _id: campaign._id });

    return jsonOk({
      message: 'Campaign deleted successfully',
      releasedDrafts,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete campaign', 500);
  }
}
