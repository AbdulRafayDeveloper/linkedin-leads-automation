import { after, type NextRequest } from 'next/server';
import { getFilteredLeads } from '@/lib/db/operations/read';
import { deleteLeadsByIds } from '@/lib/db/operations/delete';
import { createLead } from '@/lib/db/operations/create';
import { enrichLead } from '@/lib/enrichment/enrichLead';
import { jsonError, jsonOk } from '@/lib/api/response';
import type { ApprovalStatus, ProcessingResult, SentStatus, ValidationStatus } from '@/lib/types/lead';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || undefined;

    const result = await getFilteredLeads(
      {
        approvalStatus: (searchParams.get('approvalStatus') as ApprovalStatus) || undefined,
        validationStatus: (searchParams.get('validationStatus') as ValidationStatus) || undefined,
        sentStatus: (searchParams.get('sentStatus') as SentStatus) || undefined,
        search: searchParams.get('search') || undefined,
        startDate: searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined,
        endDate: searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined,
      },
      page,
      limit
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to fetch leads', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ProcessingResult;
    if (!body?.lead?.fullName) {
      return jsonError('Missing required lead data', 422);
    }
    const saved = await createLead(body);

    const leadId = saved._id.toString();
    after(() => enrichLead(leadId));

    return jsonOk({ lead: saved }, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to create lead', 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { ids?: string[] };
    if (!body?.ids?.length) {
      return jsonError('No lead IDs provided for bulk delete', 422);
    }
    const result = await deleteLeadsByIds(body.ids);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete leads', 500);
  }
}
