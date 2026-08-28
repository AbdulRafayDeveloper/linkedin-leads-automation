import type { NextRequest } from 'next/server';
import { getLeadById } from '@/lib/db/operations/read';
import { updateLead } from '@/lib/db/operations/update';
import { findCompanyWebsite } from '@/lib/research/research';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const lead = await getLeadById(id);
    if (!lead) return jsonError('Lead not found', 404);

    if (!lead.currentCompany || lead.currentCompany === 'CURRENT_COMPANY_UNCERTAIN') {
      return jsonError('Company name is unknown for this lead; cannot search for a website', 400);
    }

    const searchResult = await findCompanyWebsite(lead.currentCompany, {
      location: lead.currentCompanyLocation,
      title: lead.currentTitle,
      headline: lead.headline,
      about: lead.about,
    });

    if (!searchResult.website) {
      return jsonOk({ lead, website: null });
    }

    const updated = await updateLead(id, {
      currentCompanyWebsite: searchResult.website,
      websiteStatus: 'found',
    });

    return jsonOk({ lead: updated ?? lead, website: searchResult.website });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to search for company website',
      500
    );
  }
}
