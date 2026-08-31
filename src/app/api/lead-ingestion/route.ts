import { type NextRequest } from 'next/server';
import { createAndProcessLead, getIngestedLeads } from '@/services/lead-ingestion/ingestionService';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { clientId?: string; content?: string };
    if (!body?.clientId?.trim()) {
      return jsonError('Missing required "clientId" field', 422);
    }
    if (!body?.content?.trim()) {
      return jsonError('Missing required "content" field', 422);
    }

    const result = await createAndProcessLead(body.clientId, body.content);
    return jsonOk({ result }, 201);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to ingest lead',
      500
    );
  }
}

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
