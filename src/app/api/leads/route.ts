import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { Client } from '@/lib/db/models/Client';
import { jsonError, jsonOk } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.max(1, Number(searchParams.get('limit')) || 12);
    const search = searchParams.get('search')?.trim();
    const clientId = searchParams.get('clientId');
    const approved = searchParams.get('approved');
    const emailStatus = searchParams.get('emailStatus');

    await connectToMongoDB();

    const andConditions: Record<string, unknown>[] = [];

    if (clientId && clientId !== 'all') {
      andConditions.push({ clientId });
    }

    if (approved === 'true') {
      andConditions.push({
        $or: [
          { approved: true },
          { 'currentCompanies.approved': true },
        ],
      });
    } else if (approved === 'false') {
      andConditions.push({
        $or: [
          { approved: false },
          { approved: { $exists: false } },
          { 'currentCompanies.approved': false },
          { 'currentCompanies.approved': { $exists: false } },
        ],
      });
    }

    if (emailStatus && emailStatus !== 'all') {
      if (emailStatus === 'no_contact_email') {
        andConditions.push({
          $or: [
            { email: null },
            { email: '' },
            { email: { $exists: false } },
            { emailStatus: 'no_contact_email' },
          ],
        });
      } else if (emailStatus === 'pending') {
        andConditions.push({
          $or: [
            { emailStatus: 'pending' },
            { emailStatus: 'draft' },
            { emailStatus: { $exists: false } },
            { emailStatus: null },
          ],
        });
      } else {
        andConditions.push({ emailStatus });
      }
    }

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      andConditions.push({
        $or: [
          { fullName: regex },
          { email: regex },
          { companyName: regex },
          { discoveredEmails: regex },
          { portfolioUrl: regex },
          { websiteUrl: regex },
          { rawText: regex },
          { 'currentCompanies.companyName': regex },
          { 'currentCompanies.companyEmails': regex },
        ],
      });
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    const skip = (page - 1) * limit;

    const [rawLeads, total] = await Promise.all([
      LeadIngestion.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LeadIngestion.countDocuments(query),
    ]);

    // Attach client names
    const clientIds = Array.from(new Set(rawLeads.map((l) => l.clientId?.toString()).filter(Boolean)));
    const clientDocs = await Client.find({ _id: { $in: clientIds } }).lean();
    const clientMap = new Map(clientDocs.map((c) => [c._id.toString(), c.name]));

    const leads = rawLeads.map((l) => ({
      ...l,
      _id: l._id.toString(),
      clientId: l.clientId?.toString(),
      clientName: clientMap.get(l.clientId?.toString() || '') || 'Client Profile',
    }));

    return jsonOk({
      leads,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + rawLeads.length < total,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to fetch leads', 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { ids?: string[] };
    if (!body?.ids?.length) {
      return jsonError('No lead IDs provided for bulk delete', 422);
    }
    await connectToMongoDB();
    const result = await LeadIngestion.deleteMany({ _id: { $in: body.ids } });
    return jsonOk({ deletedCount: result.deletedCount });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete leads', 500);
  }
}
