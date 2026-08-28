import { connectToMongoDB } from '@/lib/db/connection';
import { Lead, type EmailEntrySubdocument, type LeadDocument } from '@/lib/db/models/Lead';
import { researchCompany } from '@/lib/research/research';
import { crawlWebsite, type CrawlOptions } from '@/lib/research/crawler';
import { classifyEmailType, dedupeEmails, normalizeEmail } from '@/lib/email/emailUtils';
import { validateEmailEntries } from '@/lib/email/validation';
import type {
  EmailEntryValidationStatus,
  EmailType,
  ValidationStatus,
} from '@/lib/types/lead';

export interface EnrichLeadOptions {
  crawlOptions?: CrawlOptions;
}

function looksPersonal(email: string, fullName: string): boolean {
  const localPart = email.split('@')[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
  const nameParts = fullName
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((part) => part.length > 1);
  return nameParts.some((part) => localPart.includes(part));
}

function refineEmailType(email: string, fallbackType: EmailType, fullName: string): EmailType {
  if (fallbackType !== 'UNKNOWN') return fallbackType;
  return looksPersonal(email, fullName) ? 'PERSONAL' : 'GENERAL';
}

const ENTRY_STATUS_TO_LEGACY: Record<EmailEntryValidationStatus, ValidationStatus> = {
  valid: 'PASS',
  invalid: 'FAIL',
  risky: 'NEEDS_REVIEW',
  unknown: 'NOT_FOUND',
  pending: 'NOT_FOUND',
};

function pickBestEmail(emails: EmailEntrySubdocument[]): EmailEntrySubdocument | null {
  const bySource = (source: 'LEAD_PROFILE' | 'COMPANY_WEBSITE') =>
    emails.find((e) => e.source === source && e.validationStatus === 'valid');

  return (
    bySource('LEAD_PROFILE') ||
    bySource('COMPANY_WEBSITE') ||
    emails.find((e) => e.source === 'LEAD_PROFILE') ||
    emails[0] ||
    null
  );
}

async function markCompletedWithoutWebsite(lead: LeadDocument): Promise<void> {
  lead.websiteStatus = 'not_found';
  lead.crawlStatus = 'skipped';
  lead.emailDiscoveryStatus = lead.emails.length > 0 ? 'emails_found' : 'no_emails_found';
  lead.enrichmentStatus = 'COMPLETED';
  await lead.save();
}

/**
 * Runs the full lead-enrichment pipeline for an already-saved lead:
 * identify current company -> find/verify official website -> crawl it for
 * public emails -> merge with any email(s) the lead already has -> dedupe ->
 * validate everything -> persist. Enrichment always runs, even when the lead
 * already has an email, and never throws: failures are recorded on the lead
 * document (websiteStatus/crawlStatus/emailDiscoveryStatus/enrichmentStatus)
 * so the lead itself is never lost.
 */
export async function enrichLead(leadId: string, options: EnrichLeadOptions = {}): Promise<void> {
  await connectToMongoDB();
  const lead = await Lead.findById(leadId);
  if (!lead) return;

  try {
    lead.enrichmentStatus = 'IDENTIFYING_COMPANY';
    await lead.save();

    const companyName = lead.currentCompany;
    if (!companyName || companyName === 'CURRENT_COMPANY_UNCERTAIN') {
      await markCompletedWithoutWebsite(lead);
      return;
    }

    lead.enrichmentStatus = 'FINDING_WEBSITE';
    await lead.save();

    const companyResult = await researchCompany(companyName, lead.currentCompanyWebsite);
    const website = companyResult.officialWebsite;

    if (!website) {
      await markCompletedWithoutWebsite(lead);
      return;
    }

    lead.currentCompanyWebsite = website;
    lead.websiteStatus = 'found';
    lead.enrichmentStatus = 'CRAWLING';
    await lead.save();

    let crawlEmails: Array<{ email: string; sourceUrl: string; emailType: EmailType }> = [];
    try {
      const crawlResult = await crawlWebsite(website, options.crawlOptions);
      crawlEmails = crawlResult.emails;
      lead.crawlStatus = 'completed';
    } catch (error) {
      lead.crawlStatus = 'failed';
      lead.enrichmentError = error instanceof Error ? error.message : 'Website crawl failed';
    }
    await lead.save();

    lead.enrichmentStatus = 'EXTRACTING';
    await lead.save();

    const existingKeys = new Set(lead.emails.map((e) => normalizeEmail(e.email)));
    const deduped = dedupeEmails(crawlEmails);
    for (const crawled of deduped) {
      const key = normalizeEmail(crawled.email);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      lead.emails.push({
        email: crawled.email,
        source: 'COMPANY_WEBSITE',
        sourceUrl: crawled.sourceUrl,
        emailType: refineEmailType(crawled.email, crawled.emailType, lead.fullName),
        validationStatus: 'pending',
        validationDetails: null,
        discoveredAt: new Date(),
        validatedAt: null,
      } as EmailEntrySubdocument);
    }

    lead.emailDiscoveryStatus = lead.emails.length > 0 ? 'emails_found' : 'no_emails_found';
    await lead.save();

    lead.enrichmentStatus = 'VALIDATING';
    await lead.save();

    const pending = lead.emails.filter((e) => e.validationStatus === 'pending');
    if (pending.length > 0) {
      const results = await validateEmailEntries(pending.map((e) => e.email));
      const resultByEmail = new Map(results.map((r) => [normalizeEmail(r.email), r]));
      for (const entry of lead.emails) {
        const result = resultByEmail.get(normalizeEmail(entry.email));
        if (!result) continue;
        entry.validationStatus = result.validationStatus;
        entry.validationDetails = result.validationDetails;
        entry.validatedAt = new Date();
      }
    }

    const best = pickBestEmail(lead.emails);
    if (best) {
      lead.email = best.email;
      lead.emailSource = best.source === 'LEAD_PROFILE' ? 'LINKEDIN' : 'COMPANY_WEBSITE';
      lead.validationStatus = ENTRY_STATUS_TO_LEGACY[best.validationStatus];
    }

    lead.enrichmentStatus = 'COMPLETED';
    await lead.save();
  } catch (error) {
    lead.enrichmentStatus = 'FAILED';
    lead.enrichmentError = error instanceof Error ? error.message : 'Unknown enrichment error';
    await lead.save().catch(() => undefined);
  }
}
