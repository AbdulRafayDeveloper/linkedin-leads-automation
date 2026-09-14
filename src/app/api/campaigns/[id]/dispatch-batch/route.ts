import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { sendOutboundEmail } from '@/services/lead-ingestion/mailer';
import { withParagraphSpacing } from '@/services/lead-ingestion/emailHtml';
import { jsonError, jsonOk } from '@/lib/api/response';
import { getSiteUrl } from '@/lib/config/site';
import mongoose from 'mongoose';

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid campaign ID', 400);
    }

    const body = (await request.json()) as {
      itemIds?: string[];
      rerunFailed?: boolean;
    };

    await connectToMongoDB();
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return jsonError('Campaign not found', 404);
    }

    campaign.status = 'running';
    await campaign.save();

    const appUrl = getSiteUrl();

    // Identify target items to process
    let targetItems = campaign.items;
    if (body.itemIds && Array.isArray(body.itemIds) && body.itemIds.length > 0) {
      const itemSet = new Set(body.itemIds);
      targetItems = campaign.items.filter((item) => item._id && itemSet.has(item._id.toString()));
    } else if (body.rerunFailed) {
      targetItems = campaign.items.filter((item) => item.status === 'failed' || item.status === 'pending');
    } else {
      targetItems = campaign.items.filter((item) => item.status === 'pending');
    }

    if (targetItems.length === 0) {
      // Check if all items in campaign are finished
      const pendingOrFailed = campaign.items.filter((i) => i.status === 'pending' || i.status === 'sending').length;
      if (pendingOrFailed === 0) {
        campaign.status = 'completed';
        await campaign.save();
      }
      return jsonOk({
        processedCount: 0,
        message: 'No pending or failed items in batch queue.',
        campaign: { ...campaign.toObject(), _id: campaign._id.toString() },
      });
    }

    // Process single email per step sequentially (no parallel sending)
    const batchToProcess = targetItems.slice(0, 1);
    let batchSuccess = 0;
    let batchFailure = 0;

    for (const item of batchToProcess) {
      item.status = 'sending';
      await campaign.save();

      try {
        const leadIdStr = item.leadId ? item.leadId.toString() : '';
        const itemIdStr = item._id ? item._id.toString() : '';
        const campaignIdStr = campaign._id.toString();
        const enableTracking = process.env.ENABLE_OPEN_TRACKING === 'true';
        const trackingPixel = enableTracking
          ? `<img src="${appUrl}/api/lead-ingestion/${leadIdStr}/track?campaignId=${campaignIdStr}&itemId=${itemIdStr}" width="1" height="1" style="display:none;" alt="" />`
          : '';
        const bodyHtml = withParagraphSpacing(item.bodyHtml || '');
        const htmlBodyToSend = enableTracking ? `${bodyHtml}\n\n${trackingPixel}` : bodyHtml;

        const sendResult = await sendOutboundEmail({
          to: item.recipientEmail,
          subject: item.subject || 'Cold Outreach',
          htmlBody: htmlBodyToSend,
        });

        if (sendResult.success) {
          item.status = 'delivered';
          item.sentAt = new Date();
          item.errorMessage = null;
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

      // Update lead document box status
      if (item.leadId) {
        const leadDoc = await LeadIngestion.findById(item.leadId);
        if (leadDoc) {
          const itemIdx = item.companyIndex ?? 0;
          if (itemIdx === -1) {
            leadDoc.inCampaign = true;
            leadDoc.campaignSendStatus = item.status;
            leadDoc.emailStatus = item.status === 'delivered' ? 'delivered' : 'failed';
          } else if (itemIdx >= 0 && leadDoc.currentCompanies[itemIdx]) {
            leadDoc.currentCompanies[itemIdx].inCampaign = true;
            leadDoc.currentCompanies[itemIdx].campaignSendStatus = item.status;
            leadDoc.markModified('currentCompanies');
          }
          await leadDoc.save().catch(() => undefined);
        }
      }

      await campaign.save();
    }

    // Re-calculate totals
    campaign.sentCount = campaign.items.filter((i) => i.status !== 'pending' && i.status !== 'sending').length;
    campaign.deliveredCount = campaign.items.filter((i) => i.status === 'delivered' || i.status === 'opened').length;
    campaign.failedCount = campaign.items.filter((i) => i.status === 'failed').length;
    campaign.openedCount = campaign.items.filter((i) => i.status === 'opened').length;

    const remainingPending = campaign.items.filter((i) => i.status === 'pending' || i.status === 'sending').length;
    if (remainingPending === 0) {
      campaign.status = 'completed';
    }

    const updated = await campaign.save();

    return jsonOk({
      processedCount: batchToProcess.length,
      successCount: batchSuccess,
      failedCount: batchFailure,
      remainingCount: remainingPending,
      campaign: { ...updated.toObject(), _id: updated._id.toString() },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to dispatch batch',
      500
    );
  }
}
