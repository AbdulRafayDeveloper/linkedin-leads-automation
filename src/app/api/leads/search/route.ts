import type { NextRequest } from 'next/server';
import { searchLeads } from '@/lib/db/operations/read';
import { jsonError, jsonOk } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q');
    if (!query) return jsonError('Missing query parameter "q"', 422);
    const leads = await searchLeads(query);
    return jsonOk({ leads });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Search failed', 500);
  }
}
