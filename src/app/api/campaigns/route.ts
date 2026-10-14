import { type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connectToMongoDB } from '@/lib/db/connection';
import { Campaign, type CampaignItem } from '@/lib/db/models/Campaign';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { Client } from '@/lib/db/models/Client';
import { jsonError, jsonOk } from '@/lib/api/response';
import {
  findAlreadyQueued,
  markLeadBoxesQueued,
  openTrackingEnabled,
  repairStaleCampaigns,
  serializeCampaign,
} from '@/services/lead-ingestion/campaignService';
import { CAMPAIGN_NAME_MAX_LENGTH, normalizeDelays } from '@/services/lead-ingestion/campaignRunner';

export const maxDuration = 60;

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

const SORT_FIELDS = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  name: 'name',
  totalEmails: 'totalEmails',
  deliveredCount: 'deliveredCount',
  failedCount: 'failedCount',
  openedCount: 'openedCount',
  status: 'status',
} as const;

export type CampaignSortField = keyof typeof SORT_FIELDS;

const STATUSES = ['draft', 'running', 'completed', 'paused'] as const;

/** Lists campaigns without their items: the list page only needs the counts. */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1));
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(searchParams.get('limit')) || DEFAULT_PAGE_SIZE)));
    const search = searchParams.get('search')?.trim();
    const status = searchParams.get('status');
    const sortParam = searchParams.get('sort') ?? 'createdAt';
    const sortField: CampaignSortField = sortParam in SORT_FIELDS ? (sortParam as CampaignSortField) : 'createdAt';
    const order = searchParams.get('order') === 'asc' ? 1 : -1;

    if (status && status !== 'all' && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return jsonError('Unknown status filter', 422);
    }

    await connectToMongoDB();
    await repairStaleCampaigns();

    const match: Record<string, unknown> = {};
    if (status && status !== 'all') match.status = status;
    if (search) {
      match.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const skip = (page - 1) * limit;
    const sort: Record<string, 1 | -1> = { [SORT_FIELDS[sortField]]: order };
    if (sortField !== 'createdAt') sort.createdAt = -1;

    const [campaigns, total] = await Promise.all([
      Campaign.find(match)
        .collation({ locale: 'en', strength: 2 })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select('-items.bodyHtml -items.subject -items.candidateName -items.clientName -items.companyName -items.recipientEmail')
        .lean(),
      Campaign.countDocuments(match),
    ]);

    return jsonOk({
      campaigns: campaigns.map((c) => serializeCampaign(c, { includeItems: false })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + campaigns.length < total,
      sort: sortField,
      order: order === 1 ? 'asc' : 'desc',
      openTrackingEnabled: openTrackingEnabled(),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to fetch campaigns', 500);
  }
}

const objectId = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), 'Invalid lead id');

/**
 * An item needs at least the lead, the box and the recipient. Names, subject
 * and body are optional: when missing they are copied from the lead's saved
 * draft, so a campaign always sends what the lead page shows.
 */
const createItemSchema = z.object({
  leadId: objectId,
  companyIndex: z.number().int().min(-1),
  candidateName: z.string().trim().min(1).optional(),
  clientName: z.string().trim().min(1).optional(),
  companyName: z.string().trim().min(1).optional(),
  recipientEmail: z.string().trim().toLowerCase().email('Recipient email is not valid'),
  subject: z.string().trim().min(1).optional(),
  bodyHtml: z.string().trim().min(1).optional(),
});

const PLACEHOLDER_NAMES = new Set(['Unspecified Company', 'Unknown Company']);

function realName(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && !PLACEHOLDER_NAMES.has(trimmed) ? trimmed : fallback;
}

/** Fills missing item fields from the lead documents. Returns an error message for the first item that has no draft. */
async function hydrateItems(
  items: z.infer<typeof createItemSchema>[]
): Promise<{ items: CampaignItem[] } | { error: string }> {
  const leadIds = Array.from(new Set(items.map((i) => i.leadId)));
  const leads = await LeadIngestion.find({ _id: { $in: leadIds } })
    .select('fullName companyName emailSubject emailBody clientId currentCompanies.companyName currentCompanies.emailSubject currentCompanies.emailBody')
    .lean();
  const leadById = new Map(leads.map((lead) => [String(lead._id), lead]));

  const clientIds = Array.from(new Set(leads.map((lead) => String(lead.clientId)).filter(Boolean)));
  const clients = clientIds.length ? await Client.find({ _id: { $in: clientIds } }).select('name').lean() : [];
  const clientById = new Map(clients.map((client) => [String(client._id), client.name]));

  const result: CampaignItem[] = [];
  for (const item of items) {
    const lead = leadById.get(item.leadId);
    if (!lead) return { error: `Lead not found for ${item.recipientEmail}` };

    const box = item.companyIndex >= 0 ? lead.currentCompanies?.[item.companyIndex] : undefined;
    if (item.companyIndex >= 0 && !box) {
      return { error: `Company #${item.companyIndex + 1} does not exist for ${item.recipientEmail}` };
    }

    const subject = item.subject ?? (box ? box.emailSubject : lead.emailSubject)?.trim();
    const bodyHtml = item.bodyHtml ?? (box ? box.emailBody : lead.emailBody)?.trim();
    if (!subject || !bodyHtml) {
      return { error: `No email draft saved for ${item.recipientEmail}. Generate the email first.` };
    }

    const candidateName = item.candidateName ?? realName(lead.fullName, 'Unknown');
    const companyName =
      item.companyName ?? realName(box ? box.companyName : lead.companyName, box ? 'Company' : 'Personal');
    const clientName = item.clientName ?? clientById.get(String(lead.clientId)) ?? candidateName;

    result.push({
      leadId: new mongoose.Types.ObjectId(item.leadId),
      companyIndex: item.companyIndex,
      candidateName,
      clientName,
      companyName,
      recipientEmail: item.recipientEmail,
      subject,
      bodyHtml,
      status: 'pending',
      attempts: 0,
    });
  }
  return { items: result };
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'Campaign name is required').max(CAMPAIGN_NAME_MAX_LENGTH, `Campaign name must be ${CAMPAIGN_NAME_MAX_LENGTH} characters or fewer`),
  minDelaySeconds: z.number().optional(),
  maxDelaySeconds: z.number().optional(),
  // Accepted for backwards compatibility; a campaign always starts as a draft
  // and is started from its own page.
  status: z.enum(['draft', 'running']).optional(),
  items: z.array(createItemSchema).min(1, 'At least one email draft must be selected for campaign creation'),
});

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const path = issue.path.length ? ` (${issue.path.join('.')})` : '';
  return `${issue.message}${path}`;
}

export async function POST(request: NextRequest) {
  try {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(firstIssue(parsed.error), 422);
    }
    const body = parsed.data;

    // The same recipient twice in one campaign would be sent twice.
    const seen = new Set<string>();
    for (const item of body.items) {
      const key = `${item.leadId}:${item.companyIndex}`;
      if (seen.has(key)) {
        return jsonError(`The draft for ${item.recipientEmail} was selected twice`, 422);
      }
      seen.add(key);
    }

    await connectToMongoDB();

    const hydrated = await hydrateItems(body.items);
    if ('error' in hydrated) {
      return jsonError(hydrated.error, 422);
    }
    const campaignItems = hydrated.items;

    const alreadyQueued = await findAlreadyQueued(campaignItems);
    if (alreadyQueued.length > 0) {
      const shown = alreadyQueued.slice(0, 3).join(', ');
      const more = alreadyQueued.length > 3 ? ` and ${alreadyQueued.length - 3} more` : '';
      return jsonError(`Already in another campaign: ${shown}${more}`, 409);
    }

    const delays = normalizeDelays(body.minDelaySeconds, body.maxDelaySeconds);

    const campaign = new Campaign({
      name: body.name,
      status: 'draft',
      totalEmails: campaignItems.length,
      sentCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      openedCount: 0,
      ...delays,
      items: campaignItems,
    });

    const saved = await campaign.save();

    try {
      await markLeadBoxesQueued(saved.items);
    } catch (error) {
      // Keep the data consistent: no campaign without its drafts flagged.
      await Campaign.deleteOne({ _id: saved._id }).catch(() => undefined);
      throw error;
    }

    return jsonOk({ campaign: serializeCampaign(saved) }, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to create campaign', 500);
  }
}
