import type { CompanyResearchResult, EmailDiscoveryResult, ParsedLead } from '@/lib/types/lead';

export function discoverEmail(
  lead: Pick<ParsedLead, 'publicEmail'>,
  company: CompanyResearchResult
): EmailDiscoveryResult {
  const notes: string[] = [];

  if (lead.publicEmail) {
    notes.push('Email found directly on the Sales Navigator profile/contact info');
    return {
      email: lead.publicEmail,
      emailSource: 'LINKEDIN',
      confidence: 'HIGH',
      pagesSearched: [],
      notes,
    };
  }

  if (company.discoveredEmails.length > 0) {
    const [firstEmail] = company.discoveredEmails;
    notes.push(`Email discovered on company website pages: ${company.sourceUrls.join(', ')}`);
    return {
      email: firstEmail,
      emailSource: 'COMPANY_WEBSITE',
      confidence: company.confidence === 'HIGH' ? 'MEDIUM' : 'LOW',
      pagesSearched: company.sourceUrls,
      notes,
    };
  }

  notes.push('No email found on profile or company website pages searched');
  return {
    email: null,
    emailSource: 'NOT_FOUND',
    confidence: 'LOW',
    pagesSearched: company.sourceUrls,
    notes,
  };
}
