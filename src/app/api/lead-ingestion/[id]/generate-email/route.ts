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
    
    let body: { userPrompt?: string; companyIndex?: number; forceRegenerate?: boolean } = {};
    try {
      body = (await request.json()) as { userPrompt?: string; companyIndex?: number; forceRegenerate?: boolean };
    } catch {
      // Empty body is allowed
    }

    const result = await generateLeadEmail(id, body.userPrompt, body.companyIndex, body.forceRegenerate ?? true);
    return jsonOk({ result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to generate outreach email',
      500
    );
  }
}
