import { type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connectToMongoDB } from '@/lib/db/connection';
import { Campaign, type CampaignItem } from '@/lib/db/models/Campaign';
import { sendOutboundEmail } from '@/services/lead-ingestion/mailer';
import { withParagraphSpacing } from '@/services/lead-ingestion/emailHtml';
import { jsonError, jsonOk } from '@/lib/api/response';
import { getSiteUrl } from '@/lib/config/site';
import {
  eligibleStatuses,
  isRunnerActive,
  mirrorItemOutcome,
  openTrackingEnabled,
  recomputeCounters,
  repairStaleCampaigns,
  serializeCampaign,
  serializeItem,
} from '@/services/lead-ingestion/campaignService';

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  /** Send only these items (pending or failed). Used for "send now" / "retry" on one row. */
  itemIds: z.array(z.string()).max(500).optional(),
  /** Also pick up failed items, not just pending ones. */
  rerunFailed: z.boolean().optional(),
  /** The browser tab driving the campaign. Only one tab may run a campaign at a time. */
  runnerId: z.string().max(100).optional(),
  /** Take the runner lock from another tab that is still active. */
  takeover: z.boolean().optional(),
});

type DispatchMode = 'pending' | 'rerunFailed' | 'explicit';

function remainingFor(items: CampaignItem[], mode: DispatchMode, explicitIds: Set<string>): number {
  const statuses = new Set<string>(eligibleStatuses(mode));
  statuses.add('sending');
  return items.filter((item) => {
    if (!statuses.has(item.status)) return false;
    if (mode === 'explicit') return item._id ? explicitIds.has(item._id.toString()) : false;
    return true;
  }).length;
}

/**
 * Sends exactly one email of the campaign. The item is claimed with an atomic
 * update, so two tabs or two overlapping requests can never send the same
 * email twice, and a campaign never has more than one item in `sending`.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid campaign ID', 400);
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? 'Invalid request', 422);
    }
    const body = parsed.data;
    const explicitIds = new Set(body.itemIds ?? []);
    const mode: DispatchMode = explicitIds.size > 0 ? 'explicit' : body.rerunFailed ? 'rerunFailed' : 'pending';

    await connectToMongoDB();
    await repairStaleCampaigns();

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return jsonError('Campaign not found', 404);
    }

    const otherTabRunning =
      isRunnerActive(campaign) &&
      Boolean(campaign.activeRunnerId) &&
      Boolean(body.runnerId) &&
      campaign.activeRunnerId !== body.runnerId;
    if (otherTabRunning && !body.takeover) {
      return jsonError('This campaign is being run in another tab. Pause it there, or take over the runner here.', 409);
    }

    if (campaign.items.some((item) => item.status === 'sending')) {
      return jsonError('An email from this campaign is being sent right now. Try again in a moment.', 409);
    }

    const eligible = new Set<string>(eligibleStatuses(mode));
    const candidates = campaign.items.filter((item) => {
      if (!eligible.has(item.status)) return false;
      if (mode === 'explicit') return item._id ? explicitIds.has(item._id.toString()) : false;
      return true;
    });

    if (candidates.length === 0) {
      const counts = recomputeCounters(campaign);
      if (counts.pending === 0 && counts.sending === 0) {
        campaign.status = 'completed';
        campaign.activeRunnerId = null;
      } else if (campaign.status === 'running' && !isRunnerActive(campaign)) {
        campaign.status = 'paused';
        campaign.activeRunnerId = null;
      }
      await campaign.save();
      return jsonOk({
        processedCount: 0,
        successCount: 0,
        failedCount: 0,
        remainingCount: 0,
        pendingCount: counts.pending,
        message:
          mode === 'pending'
            ? counts.failed > 0
              ? 'No pending emails left. Use "Retry failed" to resend the failed ones.'
              : 'Nothing left to send.'
            : 'No pending or failed emails match this request.',
        campaign: serializeCampaign(campaign),
      });
    }

    // Atomically claim the first candidate that is still eligible and make sure
    // no other item of the campaign is mid-send.
    const now = new Date();
    let claimedId: mongoose.Types.ObjectId | null = null;
    for (const candidate of candidates) {
      if (!candidate._id) continue;
      const candidateId = new mongoose.Types.ObjectId(candidate._id.toString());
      const result = await Campaign.updateOne(
        {
          _id: campaign._id,
          'items.status': { $ne: 'sending' },
          items: { $elemMatch: { _id: candidateId, status: { $in: Array.from(eligible) } } },
        },
        {
          $set: {
            'items.$[it].status': 'sending',
            'items.$[it].sendingStartedAt': now,
            status: 'running',
            lastDispatchAt: now,
            runnerHeartbeatAt: now,
            activeRunnerId: body.runnerId ?? campaign.activeRunnerId ?? null,
          },
          $inc: { 'items.$[it].attempts': 1 },
        },
        { arrayFilters: [{ 'it._id': candidateId }] }
      );
      if (result.modifiedCount === 1) {
        claimedId = candidateId;
        break;
      }
    }

    if (!claimedId) {
      return jsonError('Another request claimed the next email first. Try again in a moment.', 409);
    }

    const fresh = await Campaign.findById(id);
    const item = fresh?.items.find((i) => i._id && i._id.toString() === claimedId!.toString());
    if (!fresh || !item) {
      return jsonError('Campaign changed while sending. Reload and try again.', 409);
    }

    let batchSuccess = 0;
    let batchFailure = 0;

    try {
      const leadIdStr = item.leadId ? item.leadId.toString() : '';
      const campaignIdStr = fresh._id.toString();
      const trackingPixel = openTrackingEnabled()
        ? `<img src="${getSiteUrl()}/api/lead-ingestion/${leadIdStr}/track?campaignId=${campaignIdStr}&itemId=${claimedId.toString()}" width="1" height="1" style="display:none;" alt="" />`
        : '';
      const bodyHtml = withParagraphSpacing(item.bodyHtml || '');
      const htmlBodyToSend = trackingPixel ? `${bodyHtml}\n\n${trackingPixel}` : bodyHtml;

      const sendResult = await sendOutboundEmail({
        to: item.recipientEmail,
        subject: item.subject || 'Cold Outreach',
        htmlBody: htmlBodyToSend,
      });

      if (sendResult.success) {
        item.status = 'delivered';
        item.sentAt = new Date();
        item.errorMessage = null;
        item.failedAt = null;
        batchSuccess++;
      } else {
        item.status = 'failed';
        item.errorMessage = sendResult.error || 'SMTP delivery failure';
        item.failedAt = new Date();
        batchFailure++;
      }
    } catch (err) {
      item.status = 'failed';
      item.errorMessage = err instanceof Error ? err.message : 'Send exception occurred';
      item.failedAt = new Date();
      batchFailure++;
    }
    item.sendingStartedAt = null;

    await mirrorItemOutcome(item);

    const counts = recomputeCounters(fresh);
    const remainingPending = counts.pending + counts.sending;
    if (remainingPending === 0) {
      fresh.status = 'completed';
      fresh.activeRunnerId = null;
    } else {
      fresh.status = 'running';
    }
    fresh.runnerHeartbeatAt = new Date();
    fresh.markModified('items');
    const updated = await fresh.save();

    return jsonOk({
      processedCount: 1,
      successCount: batchSuccess,
      failedCount: batchFailure,
      remainingCount: remainingFor(updated.items, mode, explicitIds),
      pendingCount: counts.pending,
      item: serializeItem(item),
      campaign: serializeCampaign(updated),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to dispatch batch', 500);
  }
}
