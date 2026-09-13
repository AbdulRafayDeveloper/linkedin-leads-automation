import type { NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import mongoose from 'mongoose';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const TRANSPARENT_GIF_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');
    const itemId = searchParams.get('itemId');

    if (mongoose.Types.ObjectId.isValid(id)) {
      await connectToMongoDB();
      const doc = await LeadIngestion.findById(id);
      if (doc) {
        let reasons: string[] = [];
        try {
          const parsed = JSON.parse(doc.emailValidationDetails || '{}');
          reasons = parsed.reasons || [];
        } catch {
          // ignore
        }

        const openLog = `Email opened by recipient at ${new Date().toISOString()}`;
        if (!reasons.some((r) => r.startsWith('Email opened'))) {
          reasons.push(openLog);
          doc.emailValidationDetails = JSON.stringify({ reasons });
          doc.emailValidationStatus = 'valid';
          doc.emailStatus = 'opened';
          await doc.save();
        }
      }

      // Update Campaign Item status if campaignId and itemId provided
      if (campaignId && itemId && mongoose.Types.ObjectId.isValid(campaignId)) {
        const { Campaign } = await import('@/lib/db/models/Campaign');
        const campaign = await Campaign.findById(campaignId);
        if (campaign) {
          const targetItem = campaign.items.find(
            (i) => i._id && i._id.toString() === itemId
          );
          if (targetItem) {
            targetItem.status = 'opened';
            if (!targetItem.openedAt) targetItem.openedAt = new Date();
            campaign.deliveredCount = campaign.items.filter((i) => i.status === 'delivered' || i.status === 'opened').length;
            campaign.openedCount = campaign.items.filter((i) => i.status === 'opened').length;
            await campaign.save();
          }
        }
      }
    }
  } catch (error) {
    // Fail silently to always return tracking pixel successfully
  }

  return new Response(TRANSPARENT_GIF_BUFFER, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
