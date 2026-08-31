import type { NextRequest } from 'next/server';
import { generateLeadEmail } from '@/services/lead-ingestion/emailGenerator';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    let body: { userPrompt?: string } = {};
    try {
      body = (await request.json()) as { userPrompt?: string };
    } catch {
      // Empty body is allowed
    }

    const result = await generateLeadEmail(id, body.userPrompt);
    return jsonOk({ result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to generate outreach email',
      500
    );
  }
}
