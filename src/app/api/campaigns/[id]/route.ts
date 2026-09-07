import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { jsonError, jsonOk } from '@/lib/api/response';
import mongoose from 'mongoose';

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
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return jsonError('Campaign not found', 404);
    }

    return jsonOk({ campaign: { ...campaign.toObject(), _id: campaign._id.toString() } });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to fetch campaign details',
      500
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid campaign ID', 400);
    }

    const body = (await request.json()) as {
      name?: string;
      status?: 'draft' | 'running' | 'completed' | 'paused';
      minDelaySeconds?: number;
      maxDelaySeconds?: number;
    };

    await connectToMongoDB();
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return jsonError('Campaign not found', 404);
    }

    if (body.name !== undefined && body.name.trim()) {
      campaign.name = body.name.trim();
    }
    if (body.status !== undefined) {
      campaign.status = body.status;
    }
    if (body.minDelaySeconds !== undefined) {
      campaign.minDelaySeconds = Math.max(1, body.minDelaySeconds);
    }
    if (body.maxDelaySeconds !== undefined) {
      campaign.maxDelaySeconds = Math.max(campaign.minDelaySeconds, body.maxDelaySeconds);
    }

    const saved = await campaign.save();
    return jsonOk({ campaign: { ...saved.toObject(), _id: saved._id.toString() } });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to update campaign',
      500
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid campaign ID', 400);
    }

    await connectToMongoDB();
    const result = await Campaign.findByIdAndDelete(id);
    if (!result) {
      return jsonError('Campaign not found', 404);
    }

    return jsonOk({ message: 'Campaign deleted successfully' });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to delete campaign',
      500
    );
  }
}
