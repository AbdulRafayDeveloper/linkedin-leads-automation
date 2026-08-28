import type { NextRequest } from 'next/server';
import { getLeadById } from '@/lib/db/operations/read';
import { updateLead } from '@/lib/db/operations/update';
import { findVerifiedCompanyWebsite } from '@/lib/research/websiteVerification';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 300;

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

    const result = await findVerifiedCompanyWebsite(
      lead.currentCompany,
      {
        location: lead.currentCompanyLocation,
        title: lead.currentTitle,
        headline: lead.headline,
        about: lead.about,
      },
      lead.fullName,
      lead.currentCompanyWebsite
    );

    if (!result.website) {
      const updated = await updateLead(id, { websiteStatus: 'not_found', websiteVerified: false });
      return jsonOk({ lead: updated ?? lead, website: null, verified: false });
    }

    const updated = await updateLead(id, {
      currentCompanyWebsite: result.website,
      websiteStatus: 'found',
      websiteVerified: result.verified,
    });

    return jsonOk({ lead: updated ?? lead, website: result.website, verified: result.verified });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to search for company website',
      500
    );
  }
}
