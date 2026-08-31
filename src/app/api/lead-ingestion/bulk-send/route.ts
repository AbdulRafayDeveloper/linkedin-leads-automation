import type { NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { sendOutboundEmail } from '@/services/lead-ingestion/mailer';
import { jsonError, jsonOk } from '@/lib/api/response';
import mongoose from 'mongoose';

export const maxDuration = 60;

async function runBackgroundSender(leadsToDeliver: any[]) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  for (const lead of leadsToDeliver) {
    try {
      const trackingPixel = `<img src="${appUrl}/api/lead-ingestion/${lead._id.toString()}/track" width="1" height="1" style="display:none;" alt="" />`;
      const htmlBodyWithPixel = `${lead.emailBody || ''}\n\n${trackingPixel}`;

      const sendResult = await sendOutboundEmail({
        to: lead.email,
        subject: lead.emailSubject || 'Cold Outreach',
        htmlBody: htmlBodyWithPixel,
      });

      if (sendResult.success) {
        lead.emailStatus = 'sent';
      } else {
        lead.emailStatus = 'failed';
        try {
          const parsed = JSON.parse(lead.emailValidationDetails || '{}');
          parsed.reasons = parsed.reasons || [];
          parsed.reasons.push(`SMTP delivery failure: ${sendResult.error || 'unknown'}`);
          lead.emailValidationDetails = JSON.stringify(parsed);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      lead.emailStatus = 'failed';
    } finally {
      await lead.save().catch(() => undefined);
    }

    // Delay randomly between 4 to 8 seconds
    const delayMs = Math.floor(Math.random() * (8000 - 4000 + 1) + 4000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectToMongoDB();
    const body = (await request.json()) as { clientId?: string };

    if (!body.clientId || !mongoose.Types.ObjectId.isValid(body.clientId)) {
      return jsonError('Invalid or missing clientId', 400);
    }

    const approvedLeads = await LeadIngestion.find({
      clientId: new mongoose.Types.ObjectId(body.clientId),
      approved: true,
      emailStatus: { $in: ['draft', 'failed'] },
      email: { $ne: null },
    });

    if (approvedLeads.length === 0) {
      return jsonOk({ count: 0, message: 'No approved email drafts in queue to send.' });
    }

    // Set all matched to 'sending' state
    for (const lead of approvedLeads) {
      lead.emailStatus = 'sending';
      await lead.save();
    }

    // Trigger sending loop in background asynchronously
    runBackgroundSender(approvedLeads).catch(() => undefined);

    return jsonOk({
      count: approvedLeads.length,
      message: `Bulk sending process started in the background for ${approvedLeads.length} lead(s).`,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to trigger bulk email dispatch',
      500
    );
  }
}
