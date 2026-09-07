import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { Campaign, type CampaignItem } from '@/lib/db/models/Campaign';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { jsonError, jsonOk } from '@/lib/api/response';
import mongoose from 'mongoose';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.max(1, Number(searchParams.get('limit')) || 10);
    const search = searchParams.get('search')?.trim();
    const status = searchParams.get('status');

    await connectToMongoDB();

    const andConditions: Record<string, unknown>[] = [];

    if (status && status !== 'all') {
      andConditions.push({ status });
    }

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      andConditions.push({ name: regex });
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};
    const skip = (page - 1) * limit;

    const [campaigns, total] = await Promise.all([
      Campaign.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Campaign.countDocuments(query),
    ]);

    const formatted = campaigns.map((c) => ({
      ...c,
      _id: c._id.toString(),
    }));

    return jsonOk({
      campaigns: formatted,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + campaigns.length < total,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to fetch campaigns',
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string;
      minDelaySeconds?: number;
      maxDelaySeconds?: number;
      status?: 'draft' | 'running';
      items?: Array<{
        leadId: string;
        companyIndex: number;
        candidateName: string;
        clientName: string;
        companyName: string;
        recipientEmail: string;
        subject: string;
        bodyHtml: string;
      }>;
    };

    if (!body.name || !body.name.trim()) {
      return jsonError('Campaign name is required', 422);
    }

    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return jsonError('At least one email draft must be selected for campaign creation', 422);
    }

    await connectToMongoDB();

    const campaignItems: CampaignItem[] = body.items.map((item) => ({
      leadId: new mongoose.Types.ObjectId(item.leadId),
      companyIndex: item.companyIndex,
      candidateName: item.candidateName,
      clientName: item.clientName,
      companyName: item.companyName,
      recipientEmail: item.recipientEmail,
      subject: item.subject,
      bodyHtml: item.bodyHtml,
      status: 'pending',
    }));

    const campaign = new Campaign({
      name: body.name.trim(),
      status: body.status || 'draft',
      totalEmails: campaignItems.length,
      sentCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      openedCount: 0,
      minDelaySeconds: body.minDelaySeconds ?? 15,
      maxDelaySeconds: body.maxDelaySeconds ?? 90,
      items: campaignItems,
    });

    const saved = await campaign.save();

    // Update corresponding lead documents to mark email status in_progress
    const leadIds = Array.from(new Set(body.items.map((i) => i.leadId)));
    await LeadIngestion.updateMany(
      { _id: { $in: leadIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { emailStatus: 'in_progress' } }
    );

    return jsonOk({ campaign: { ...saved.toObject(), _id: saved._id.toString() } });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to create campaign',
      500
    );
  }
}
