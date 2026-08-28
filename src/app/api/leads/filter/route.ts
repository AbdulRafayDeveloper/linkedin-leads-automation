import type { NextRequest } from 'next/server';
import { getFilteredLeads } from '@/lib/db/operations/read';
import { jsonError, jsonOk } from '@/lib/api/response';
import type { ApprovalStatus, SentStatus, ValidationStatus } from '@/lib/types/lead';

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
      },
      page,
      limit
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Filter failed', 500);
  }
}
