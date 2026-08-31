import type { NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { jsonError, jsonOk } from '@/lib/api/response';
import mongoose from 'mongoose';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid lead ingestion ID', 400);
    }

    const body = (await request.json()) as {
      websiteUrl?: string;
      emailSubject?: string;
      emailBody?: string;
      approved?: boolean;
    };

    await connectToMongoDB();
    const doc = await LeadIngestion.findById(id);
    if (!doc) {
      return jsonError('Lead ingestion record not found', 404);
    }

    if (body.websiteUrl !== undefined) {
      doc.websiteUrl = body.websiteUrl.trim();
    }
    if (body.emailSubject !== undefined) {
      doc.emailSubject = body.emailSubject;
    }
    if (body.emailBody !== undefined) {
      doc.emailBody = body.emailBody;
    }
    if (body.approved !== undefined) {
      doc.approved = body.approved;
    }

    const result = await doc.save();
    return jsonOk({ result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to update lead ingestion record',
      500
    );
  }
}
