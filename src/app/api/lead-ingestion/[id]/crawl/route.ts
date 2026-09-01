import type { NextRequest } from 'next/server';
import { startWebsiteDiscovery } from '@/services/lead-ingestion/ingestionService';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { additionalUrls?: string[] };
    const result = await startWebsiteDiscovery(id, body.additionalUrls || []);
    if (!result) {
      return jsonError('Lead record not found', 404);
    }
    return jsonOk({ result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to execute website crawl',
      500
    );
  }
}
