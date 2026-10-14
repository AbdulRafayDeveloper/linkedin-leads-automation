import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { Client } from '@/lib/db/models/Client';
import { jsonError, jsonOk } from '@/lib/api/response';
import {
  buildDraftItems,
  countDraftItems,
  filterDraftItems,
  parseApprovalFilter,
  parseSendStatusFilter,
  parseSmtpFilter,
  type DraftSourceLead,
} from '@/services/lead-ingestion/draftItems';

export const maxDuration = 30;

/** Most leads scanned for one request; keeps a huge database from blowing up memory. */
const LEAD_SCAN_LIMIT = 1000;
const MAX_PAGE_SIZE = 60;

/**
 * The Drafts page list: one row per outreach draft (personal box + one per
 * company), filtered and paginated per draft rather than per lead.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get('limit')) || 12));
    const search = searchParams.get('search')?.trim() ?? '';
    const clientId = searchParams.get('clientId');
    const filters = {
      approval: parseApprovalFilter(searchParams.get('approval')),
      smtp: parseSmtpFilter(searchParams.get('smtp')),
      sendStatus: parseSendStatusFilter(searchParams.get('sendStatus')),
    };

    await connectToMongoDB();

    const conditions: Record<string, unknown>[] = [
      // Only leads that actually have at least one written draft.
      {
        $or: [
          { $and: [{ emailSubject: { $nin: [null, ''] } }, { emailBody: { $nin: [null, ''] } }] },
          { 'currentCompanies.emailSubject': { $nin: [null, ''] } },
        ],
      },
    ];

    if (clientId && clientId !== 'all') {
      conditions.push({ clientId });
    }

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({
        $or: [
          { fullName: regex },
          { email: regex },
          { companyName: regex },
          { discoveredEmails: regex },
          { portfolioUrl: regex },
          { websiteUrl: regex },
          { emailSubject: regex },
          { emailBody: regex },
          { 'currentCompanies.companyName': regex },
          { 'currentCompanies.companyEmails': regex },
          { 'currentCompanies.emailSubject': regex },
          { 'currentCompanies.emailBody': regex },
        ],
      });
    }

    const query = { $and: conditions };

    // rawText and other heavy fields are never needed to render a draft row.
    const [leads, matchedLeads, clients] = await Promise.all([
      LeadIngestion.find(query)
        .select('-rawText -discoveredPhones -emailValidationDetails -additionalUrls')
        .sort({ createdAt: -1 })
        .limit(LEAD_SCAN_LIMIT)
        .lean(),
      LeadIngestion.countDocuments(query),
      Client.find({}).select('_id name').lean(),
    ]);

    const clientNameById = new Map(clients.map((client) => [client._id.toString(), client.name]));
    const allItems = buildDraftItems(leads as unknown as DraftSourceLead[], clientNameById);
    const items = filterDraftItems(allItems, filters);

    const start = (page - 1) * limit;
    const pageItems = items.slice(start, start + limit);

    return jsonOk({
      items: pageItems,
      total: items.length,
      page,
      limit,
      pages: Math.max(1, Math.ceil(items.length / limit)),
      hasMore: start + pageItems.length < items.length,
      /** Counts across every draft matching the search and client, before the other filters. */
      counts: countDraftItems(allItems),
      /** True when more leads match than were scanned; narrow the search to see the rest. */
      truncated: matchedLeads > leads.length,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load drafts', 500);
  }
}
