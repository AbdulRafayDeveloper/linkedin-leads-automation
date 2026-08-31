import { type NextRequest } from 'next/server';
import { createClient, getClients } from '@/services/lead-ingestion/ingestionService';
import { jsonError, jsonOk } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string };
    if (!body?.name?.trim()) {
      return jsonError('Missing required "name" field', 422);
    }

    const client = await createClient(body.name);
    return jsonOk({ client }, 201);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to create client',
      500
    );
  }
}

export async function GET() {
  try {
    const clients = await getClients();
    return jsonOk({ clients });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to fetch clients',
      500
    );
  }
}
