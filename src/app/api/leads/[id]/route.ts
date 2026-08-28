import type { NextRequest } from 'next/server';
import { getLeadById } from '@/lib/db/operations/read';
import { updateLead } from '@/lib/db/operations/update';
import { deleteLead } from '@/lib/db/operations/delete';
import { jsonError, jsonOk } from '@/lib/api/response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const lead = await getLeadById(id);
    if (!lead) return jsonError('Lead not found', 404);
    return jsonOk({ lead });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to fetch lead', 500);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const updates = await request.json();
    const lead = await updateLead(id, updates);
    if (!lead) return jsonError('Lead not found', 404);
    return jsonOk({ lead });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to update lead', 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const lead = await deleteLead(id);
    if (!lead) return jsonError('Lead not found', 404);
    return jsonOk({ lead });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete lead', 500);
  }
}
