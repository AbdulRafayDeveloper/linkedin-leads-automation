import { after, type NextRequest } from 'next/server';
import { processLeadContent } from '@/lib/processLead';
import { createLead } from '@/lib/db/operations/create';
import { enrichLead } from '@/lib/enrichment/enrichLead';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { content?: string };
    if (!body?.content?.trim()) {
      return jsonError('Missing "content" field with pasted Sales Navigator text', 422);
    }

    const result = await processLeadContent(body.content);
    const saved = await createLead(result);

    const leadId = saved._id.toString();
    after(() => enrichLead(leadId));

    return jsonOk({ result, lead: saved }, 201);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to process lead',
      500
    );
  }
}
