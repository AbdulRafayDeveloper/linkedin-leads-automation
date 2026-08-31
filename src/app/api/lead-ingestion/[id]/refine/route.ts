import type { NextRequest } from 'next/server';
import { refineEmailWithAi } from '@/services/lead-ingestion/emailGenerator';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { refinementPrompt?: string };

    if (!body.refinementPrompt || !body.refinementPrompt.trim()) {
      return jsonError('refinementPrompt is required', 400);
    }

    const result = await refineEmailWithAi(id, body.refinementPrompt);
    return jsonOk({ result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to refine email draft',
      500
    );
  }
}
