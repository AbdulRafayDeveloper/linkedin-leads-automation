import type { NextRequest } from 'next/server';
import { startWebsiteDiscovery } from '@/services/lead-ingestion/ingestionService';
import { jsonError, jsonOk } from '@/lib/api/response';
import { clientKey, rateLimit } from '@/lib/api/rateLimit';
import { toSafePublicUrl } from '@/lib/utils/safeUrl';

export const maxDuration = 60;

/** Crawling fetches third-party sites: keep it from being used as a proxy. */
const CRAWL_LIMIT = 20;
const CRAWL_WINDOW_MS = 5 * 60 * 1000;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      additionalUrls?: string[];
      companyIndex?: number;
    };

    const limit = rateLimit(clientKey(request, 'crawl'), CRAWL_LIMIT, CRAWL_WINDOW_MS);
    if (!limit.ok) {
      return jsonError(`Too many crawl requests. Try again in ${limit.retryAfter} seconds.`, 429);
    }

    // Only public http(s) hosts may be fetched by the server.
    const additionalUrls: string[] = [];
    for (const candidate of body.additionalUrls ?? []) {
      const safe = toSafePublicUrl(candidate);
      if (!safe.ok) return jsonError(safe.error ?? 'That website URL cannot be crawled', 400);
      additionalUrls.push(safe.url!);
    }

    // Pass companyIndex so discovered emails go to the correct company box,
    // not the global personal discoveredEmails pool.
    const result = await startWebsiteDiscovery(
      id,
      additionalUrls,
      typeof body.companyIndex === 'number' ? body.companyIndex : undefined
    );

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
