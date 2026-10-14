import { type NextRequest } from 'next/server';
import { getIngestedLeads } from '@/services/lead-ingestion/ingestionService';
import { jsonError, jsonOk } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    if (!clientId) {
      return jsonError('Missing query parameter "clientId"', 400);
    }

    const results = await getIngestedLeads(clientId);
    return jsonOk({ results });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to fetch ingested leads',
      500
    );
  }
}
