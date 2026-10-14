import { type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { Client } from '@/lib/db/models/Client';
import { Campaign } from '@/lib/db/models/Campaign';
import { jsonError, jsonOk } from '@/lib/api/response';
import { LeadQueryError, buildLeadPipeline, parseLeadListQuery } from '@/lib/leads/query';

// This route serves the LeadIngestion model (my-leads, Drafts, Ready to Send),
// not the legacy Lead model.

interface FacetResult {
  rows: Record<string, unknown>[];
  total: { count: number }[];
}

export async function GET(request: NextRequest) {
  let query;
  try {
    query = parseLeadListQuery(request.nextUrl.searchParams);
  } catch (error) {
    if (error instanceof LeadQueryError) return jsonError(error.message, 400);
    throw error;
  }

  try {
    await connectToMongoDB();

    const [result] = (await LeadIngestion.aggregate(
      buildLeadPipeline(query)
    )) as unknown as FacetResult[];

    const rows = result?.rows ?? [];
    const total = result?.total?.[0]?.count ?? 0;

    const allClients = await Client.find({}).select('_id name').lean();
    const clientMap = new Map(allClients.map((c) => [c._id.toString(), c.name]));

    const leads = rows.map((lead) => {
      const clientId = (lead.clientId as mongoose.Types.ObjectId | undefined)?.toString();
      return {
        ...lead,
        _id: (lead._id as mongoose.Types.ObjectId).toString(),
        clientId,
        clientName: clientMap.get(clientId ?? '') ?? null,
      };
    });

    return jsonOk({
      leads,
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
      hasMore: query.page * query.limit < total,
      clients: allClients.map((c) => ({ id: c._id.toString(), name: c.name })),
    });
  } catch (error) {
    // The raw driver message can name hosts and internals, so it stays in the logs.
    console.error('GET /api/leads failed:', error);
    return jsonError('Failed to fetch leads', 500);
  }
}

async function readIdsFromBody(request: NextRequest): Promise<string[] | null> {
  try {
    const body = (await request.json()) as { ids?: unknown };
    return Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Deletes leads and everything that pointed at them: campaign items (with the
 * campaign counters recomputed) and clients left without a single lead.
 */
export async function DELETE(request: NextRequest) {
  const singleId = request.nextUrl.searchParams.get('id');
  const requested = singleId ? [singleId] : await readIdsFromBody(request);

  if (!requested || requested.length === 0) {
    return jsonError('No lead IDs provided for delete', 422);
  }
  if (requested.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    return jsonError('One or more lead ids are not valid', 422);
  }

  const ids = Array.from(new Set(requested));

  try {
    await connectToMongoDB();

    const leads = await LeadIngestion.find({ _id: { $in: ids } })
      .select('_id clientId')
      .lean();

    if (leads.length === 0) {
      return jsonError('No matching leads found to delete', 404);
    }

    const leadIds = leads.map((lead) => lead._id);
    const leadIdStrings = new Set(leadIds.map((id) => id.toString()));
    const { deletedCount } = await LeadIngestion.deleteMany({ _id: { $in: leadIds } });

    // Campaign items for a deleted lead would fail to send, so they go too.
    let removedCampaignItems = 0;
    const campaigns = await Campaign.find({ 'items.leadId': { $in: leadIds } });
    for (const campaign of campaigns) {
      const before = campaign.items.length;
      campaign.items = campaign.items.filter(
        (item) => !leadIdStrings.has(item.leadId?.toString() ?? '')
      );
      removedCampaignItems += before - campaign.items.length;

      campaign.totalEmails = campaign.items.length;
      campaign.sentCount = campaign.items.filter(
        (i) => i.status !== 'pending' && i.status !== 'sending'
      ).length;
      campaign.deliveredCount = campaign.items.filter(
        (i) => i.status === 'delivered' || i.status === 'opened'
      ).length;
      campaign.failedCount = campaign.items.filter((i) => i.status === 'failed').length;
      campaign.openedCount = campaign.items.filter((i) => i.status === 'opened').length;
      const stillQueued = campaign.items.filter(
        (i) => i.status === 'pending' || i.status === 'sending'
      ).length;
      if (campaign.status === 'running' && stillQueued === 0) {
        campaign.status = 'completed';
      }

      campaign.markModified('items');
      await campaign.save();
    }

    // A client exists only to group its leads; drop the ones left empty.
    let removedClients = 0;
    const clientIds = Array.from(
      new Set(leads.map((lead) => lead.clientId?.toString()).filter(Boolean) as string[])
    );
    for (const clientId of clientIds) {
      const remaining = await LeadIngestion.countDocuments({ clientId });
      if (remaining === 0) {
        const result = await Client.deleteOne({ _id: clientId });
        removedClients += result.deletedCount ?? 0;
      }
    }

    return jsonOk({ deletedCount, removedCampaignItems, removedClients });
  } catch (error) {
    console.error('DELETE /api/leads failed:', error);
    return jsonError('Failed to delete leads', 500);
  }
}
