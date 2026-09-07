import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { sendOutboundEmail } from '@/services/lead-ingestion/mailer';
import { jsonError, jsonOk } from '@/lib/api/response';
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

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

    // Process target batch items
    const batchToProcess = targetItems.slice(0, 5); // Max 5 emails per Vercel request batch
    let batchSuccess = 0;
    let batchFailure = 0;

    for (const item of batchToProcess) {
      item.status = 'sending';
      await campaign.save();

      try {
        const leadIdStr = item.leadId ? item.leadId.toString() : '';
        const trackingPixel = `<img src="${appUrl}/api/lead-ingestion/${leadIdStr}/track" width="1" height="1" style="display:none;" alt="" />`;
        const htmlBodyWithPixel = `${item.bodyHtml || ''}\n\n${trackingPixel}`;

        const sendResult = await sendOutboundEmail({
          to: item.recipientEmail,
          subject: item.subject || 'Cold Outreach',
          htmlBody: htmlBodyWithPixel,
        });

        if (sendResult.success) {
          item.status = 'delivered';
          item.sentAt = new Date();
          item.errorMessage = null;
          batchSuccess++;
        } else {
          item.status = 'failed';
          item.errorMessage = sendResult.error || 'SMTP delivery failure';
          batchFailure++;
        }
      } catch (err) {
        item.status = 'failed';
        item.errorMessage = err instanceof Error ? err.message : 'Send exception occurred';
        batchFailure++;
      }

      // Update lead document status
      if (item.leadId) {
        await LeadIngestion.updateOne(
          { _id: item.leadId },
          { $set: { emailStatus: item.status === 'delivered' ? 'delivered' : 'failed' } }
        ).catch(() => undefined);
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
