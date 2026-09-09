import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { Client } from '@/lib/db/models/Client';
import { jsonError, jsonOk } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.max(1, Number(searchParams.get('limit')) || 100);
    const search = searchParams.get('search')?.trim();
    const clientId = searchParams.get('clientId');
    const approved = searchParams.get('approved');
    const emailStatus = searchParams.get('emailStatus');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const dateRange = searchParams.get('dateRange'); // 'today' | '7days' | '30days' | 'custom' | 'all'

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
      if (emailStatus === 'valid' || emailStatus === 'verified_smtp') {
        andConditions.push({
          $or: [
            { emailValidationStatus: 'valid' },
            { emailValidationStatus: 'risky' },
            { 'verifiedEmails.status': 'valid' },
            { 'verifiedEmails.status': 'risky' },
          ],
        });
      } else if (emailStatus === 'unapproved_verified_smtp') {
        andConditions.push({
          $and: [
            { approved: { $ne: true } },
            { 'currentCompanies.approved': { $ne: true } },
            {
              $or: [
                { emailValidationStatus: 'valid' },
                { emailValidationStatus: 'risky' },
                { 'verifiedEmails.status': 'valid' },
                { 'verifiedEmails.status': 'risky' },
              ],
            },
          ],
        });
      } else if (emailStatus === 'missing_or_unverified') {
        andConditions.push({
          $or: [
            { email: null },
            { email: '' },
            { email: { $exists: false } },
            { emailValidationStatus: { $nin: ['valid', 'risky'] } },
            { 'currentCompanies.companyEmails': null },
            { 'currentCompanies.companyEmails': [] },
          ],
        });
      } else if (emailStatus === 'no_contact_email') {
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

    // Date Range Filtering
    if (dateRange && dateRange !== 'all') {
      const now = new Date();
      if (dateRange === 'today') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        andConditions.push({ createdAt: { $gte: startOfToday } });
      } else if (dateRange === '7days') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        andConditions.push({ createdAt: { $gte: sevenDaysAgo } });
      } else if (dateRange === '30days') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        andConditions.push({ createdAt: { $gte: thirtyDaysAgo } });
      } else if (dateRange === 'custom') {
        const dateFilter: Record<string, Date> = {};
        if (startDate) {
          const s = new Date(startDate);
          if (!isNaN(s.getTime())) {
            s.setHours(0, 0, 0, 0);
            dateFilter['$gte'] = s;
          }
        }
        if (endDate) {
          const e = new Date(endDate);
          if (!isNaN(e.getTime())) {
            e.setHours(23, 59, 59, 999);
            dateFilter['$lte'] = e;
          }
        }
        if (Object.keys(dateFilter).length > 0) {
          andConditions.push({ createdAt: dateFilter });
        }
      }
    } else if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) {
        const s = new Date(startDate);
        if (!isNaN(s.getTime())) {
          s.setHours(0, 0, 0, 0);
          dateFilter['$gte'] = s;
        }
      }
      if (endDate) {
        const e = new Date(endDate);
        if (!isNaN(e.getTime())) {
          e.setHours(23, 59, 59, 999);
          dateFilter['$lte'] = e;
        }
      }
      if (Object.keys(dateFilter).length > 0) {
        andConditions.push({ createdAt: dateFilter });
      }
    }

    // Fast multi-field Regex search
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
          { additionalUrls: regex },
          { 'currentCompanies.companyName': regex },
          { 'currentCompanies.companyEmails': regex },
        ],
      });
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};
    const skip = (page - 1) * limit;

    const [rawLeads, total, allClients] = await Promise.all([
      LeadIngestion.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LeadIngestion.countDocuments(query),
      Client.find({}).select('_id name').lean(),
    ]);

    const clientMap = new Map(allClients.map((c) => [c._id.toString(), c.name]));

    const leads = rawLeads.map((l) => ({
      ...l,
      _id: l._id.toString(),
      clientId: l.clientId?.toString(),
      clientName: clientMap.get(l.clientId?.toString() || '') || 'Client Profile',
    }));

    const clientsList = allClients.map((c) => ({ id: c._id.toString(), name: c.name }));

    return jsonOk({
      leads,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + rawLeads.length < total,
      clients: clientsList,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to fetch leads', 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const singleId = searchParams.get('id');

    await connectToMongoDB();

    if (singleId) {
      const result = await LeadIngestion.deleteOne({ _id: singleId });
      return jsonOk({ deletedCount: result.deletedCount });
    }

    const body = (await request.json()) as { ids?: string[] };
    if (!body?.ids?.length) {
      return jsonError('No lead IDs provided for delete', 422);
    }
    const result = await LeadIngestion.deleteMany({ _id: { $in: body.ids } });
    return jsonOk({ deletedCount: result.deletedCount });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete leads', 500);
  }
}
