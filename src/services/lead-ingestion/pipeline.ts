import mongoose from 'mongoose';
import { connectToMongoDB } from '@/lib/db/connection';
import {
  LeadIngestion,
  type CurrentCompanyItem,
  type LeadIngestionDocument,
  type PipelineStage,
  type VerifiedEmailItem,
} from '@/lib/db/models/LeadIngestion';
import { toSafePublicUrl } from '@/lib/utils/safeUrl';
import { mapEmailsToCompanies, mapUrlsToCompaniesWithAi } from './aiExtractor';
import { findEmailsOnWebsite } from './emailFinder';
import { verifyEmailSmtp } from './smtpVerifier';
import { generateLeadEmail } from './emailGenerator';

/**
 * The enrichment pipeline that runs after a lead is created: map URLs, crawl
 * sites, verify emails, write drafts.
 *
 * It runs on the server (started with `after()`, so the user can close the tab)
 * and each stage is saved as it finishes, so a run that is cut short — a
 * serverless timeout, a crash — resumes from where it stopped instead of
 * leaving the lead stuck in "processing" forever.
 */

/** A run whose heartbeat is older than this is treated as dead and can be taken over. */
export const STALE_RUN_MS = 3 * 60 * 1000;

export const PIPELINE_STEP: Record<PipelineStage, number> = {
  extracted: 1,
  mapping: 2,
  crawling: 3,
  verifying: 4,
  generating: 5,
  done: 6,
  failed: 0,
};

export function isPipelineRunning(
  lead: { pipelineStage?: PipelineStage | null; pipelineStartedAt?: Date | string | null },
  now: Date = new Date()
): boolean {
  const stage = lead.pipelineStage ?? 'extracted';
  if (stage === 'done' || stage === 'failed') return false;
  if (!lead.pipelineStartedAt) return false;
  return now.getTime() - new Date(lead.pipelineStartedAt).getTime() < STALE_RUN_MS;
}

async function setStage(leadId: string, stage: PipelineStage, extra: Record<string, unknown> = {}) {
  await LeadIngestion.updateOne(
    { _id: leadId },
    { $set: { pipelineStage: stage, pipelineStartedAt: new Date(), ...extra } }
  );
}

/**
 * Takes ownership of the lead's pipeline. Returns null when another run already
 * owns it, so two tabs (or a tab and the server) never crawl the same lead twice.
 */
async function claimPipeline(leadId: string): Promise<LeadIngestionDocument | null> {
  const staleBefore = new Date(Date.now() - STALE_RUN_MS);
  return LeadIngestion.findOneAndUpdate(
    {
      _id: leadId,
      pipelineStage: { $ne: 'done' },
      $or: [{ pipelineStartedAt: null }, { pipelineStartedAt: { $lt: staleBefore } }],
    },
    { $set: { pipelineStartedAt: new Date(), pipelineError: null } },
    { returnDocument: 'after' }
  );
}

/**
 * Writes a stage's result with an atomic update rather than `document.save()`.
 * The lead page can save an edit while the pipeline runs, and a long-held
 * document would then fail Mongoose's version check and strand the lead.
 */
/** Mongoose subdocuments carry methods; store plain objects. */
function plainCompany(company: CurrentCompanyItem): CurrentCompanyItem {
  const maybeDoc = company as CurrentCompanyItem & { toObject?: () => CurrentCompanyItem };
  return typeof maybeDoc.toObject === 'function' ? maybeDoc.toObject() : { ...company };
}

async function persist(
  lead: LeadIngestionDocument,
  changes: Record<string, unknown>
): Promise<LeadIngestionDocument> {
  await LeadIngestion.updateOne({ _id: lead._id }, { $set: changes });
  const fresh = await LeadIngestion.findById(lead._id);
  if (!fresh) throw new Error('Lead was deleted while it was being processed');
  return fresh;
}

// -- Stages -------------------------------------------------------------------

export async function mapLeadUrls(lead: LeadIngestionDocument): Promise<LeadIngestionDocument> {
  const { companies: mapped, portfolioUrl } = await mapUrlsToCompaniesWithAi(
    (lead.currentCompanies ?? []).map((c) => ({
      companyName: c.companyName,
      jobTitle: c.jobTitle,
      workPeriod: c.workPeriod ?? null,
      websiteUrl: c.websiteUrl ?? null,
      roleSummary: c.summary ?? '',
    })),
    lead.additionalUrls ?? []
  );

  const companies = (lead.currentCompanies ?? []).map((subdoc, idx) => {
    const c = mapped[idx];
    const plain = plainCompany(subdoc);
    if (!c) return plain;
    const validName =
      c.companyName && c.companyName !== 'Unspecified Company' && c.companyName !== 'Unknown Company'
        ? c.companyName
        : null;
    const validJob = c.jobTitle && c.jobTitle !== 'Professional' ? c.jobTitle : null;
    return {
      ...plain,
      companyName: validName ?? plain.companyName,
      jobTitle: validJob ?? plain.jobTitle,
      workPeriod: c.workPeriod ?? plain.workPeriod,
      websiteUrl: c.websiteUrl ?? plain.websiteUrl,
      summary: plain.summary || c.roleSummary || '',
    };
  });

  return persist(lead, {
    currentCompanies: companies,
    portfolioUrl,
    ...(companies[0]?.websiteUrl ? { websiteUrl: companies[0].websiteUrl } : {}),
    ...(companies[0]?.companyName ? { companyName: companies[0].companyName } : {}),
  });
}

export interface CrawlProgress {
  onSiteStart?: (url: string) => void;
  onSiteDone?: (url: string, emails: string[], phones: string[]) => void;
  onSiteError?: (url: string) => void;
}

export async function crawlLeadWebsites(
  lead: LeadIngestionDocument,
  progress: CrawlProgress = {}
): Promise<LeadIngestionDocument> {
  await LeadIngestion.updateOne({ _id: lead._id }, { $set: { crawlStatus: 'in_progress' } });

  // A pasted profile can carry any URL, so only public http(s) hosts are
  // fetched: never localhost, a private range or a cloud metadata address.
  const urlsToCrawl = Array.from(
    new Set([
      ...((lead.currentCompanies ?? []).map((c) => c.websiteUrl).filter(Boolean) as string[]),
      ...(lead.portfolioUrl ? [lead.portfolioUrl] : []),
    ])
  )
    .map((url) => toSafePublicUrl(url))
    .filter((result) => result.ok)
    .map((result) => result.url as string)
    .slice(0, 3);

  const allEmails = new Set<string>(lead.discoveredEmails ?? []);
  const allPhones = new Set<string>(lead.discoveredPhones ?? []);

  for (const url of urlsToCrawl) {
    try {
      progress.onSiteStart?.(url);
      const result = await findEmailsOnWebsite(url, []);
      result.emails.forEach((e) => allEmails.add(e));
      result.phones.forEach((p) => allPhones.add(p));
      progress.onSiteDone?.(url, result.emails, result.phones);
    } catch (error) {
      console.error(`[pipeline] crawl failed for ${url}:`, error instanceof Error ? error.message : error);
      progress.onSiteError?.(url);
    }
  }

  const discoveredEmails = Array.from(allEmails);
  const discoveredPhones = Array.from(allPhones);

  const emailMap = mapEmailsToCompanies(
    discoveredEmails,
    (lead.currentCompanies ?? []).map((c) => ({
      companyName: c.companyName,
      jobTitle: c.jobTitle,
      workPeriod: c.workPeriod ?? null,
      websiteUrl: c.websiteUrl ?? null,
      roleSummary: c.summary ?? '',
    })),
    lead.portfolioUrl
  );

  const companies = (lead.currentCompanies ?? []).map((subdoc, idx) => {
    const plain = plainCompany(subdoc);
    const found = emailMap.companiesWithEmails[idx]?.companyEmails ?? [];
    return found.length > 0
      ? { ...plain, companyEmails: Array.from(new Set([...(plain.companyEmails ?? []), ...found])) }
      : plain;
  });

  return persist(lead, {
    discoveredEmails,
    discoveredPhones,
    crawlStatus: 'completed',
    currentCompanies: companies,
    ...(emailMap.primaryPersonalEmail ? { email: emailMap.primaryPersonalEmail } : {}),
  });
}

export async function verifyLeadEmails(
  lead: LeadIngestionDocument,
  onVerified?: (email: string, status: VerifiedEmailItem['status']) => void
): Promise<LeadIngestionDocument> {
  const emails = Array.from(
    new Set([...(lead.email ? [lead.email] : []), ...(lead.discoveredEmails ?? [])])
  );

  const verified: VerifiedEmailItem[] = [];
  await Promise.all(
    emails.map(async (email) => {
      let status: VerifiedEmailItem['status'] = 'unknown';
      try {
        status = (await verifyEmailSmtp(email)).status;
      } catch (error) {
        console.error(
          `[pipeline] SMTP check failed for ${email}:`,
          error instanceof Error ? error.message : error
        );
      }
      verified.push({ email, status });
      onVerified?.(email, status);
    })
  );

  return persist(lead, {
    verifiedEmails: verified,
    emailValidationStatus:
      verified.find((v) => v.email === lead.email)?.status ?? verified[0]?.status ?? 'unknown',
    status: 'completed',
  });
}

export async function generateLeadDrafts(leadId: string): Promise<void> {
  await generateLeadEmail(leadId, { forceRegenerate: true });
}

// -- Runner -------------------------------------------------------------------

export interface PipelineRunResult {
  ran: boolean;
  stage: PipelineStage;
  error?: string;
}

/**
 * Runs every remaining stage for a lead. Safe to call twice: the second call
 * returns `{ ran: false }` while the first is still alive.
 */
export async function runIngestionPipeline(leadId: string): Promise<PipelineRunResult> {
  if (!mongoose.Types.ObjectId.isValid(leadId)) {
    return { ran: false, stage: 'failed', error: 'Invalid lead ID' };
  }
  await connectToMongoDB();

  const existing = await LeadIngestion.findById(leadId)
    .select('pipelineStage emailSubject currentCompanies.emailSubject')
    .lean<{ pipelineStage?: PipelineStage; emailSubject?: string | null; currentCompanies?: { emailSubject?: string | null }[] } | null>();

  // A lead from before these fields existed, that already has drafts, is
  // finished work: mark it done rather than regenerating over the drafts.
  if (existing && !existing.pipelineStage) {
    const hasDraft =
      !!existing.emailSubject || (existing.currentCompanies ?? []).some((c) => !!c.emailSubject);
    if (hasDraft) {
      await LeadIngestion.updateOne({ _id: leadId }, { $set: { pipelineStage: 'done' } });
      return { ran: false, stage: 'done' };
    }
  }

  const claimed = await claimPipeline(leadId);
  if (!claimed) {
    const current = await LeadIngestion.findById(leadId)
      .select('pipelineStage')
      .lean<{ pipelineStage: PipelineStage } | null>();
    return { ran: false, stage: current?.pipelineStage ?? 'done' };
  }

  try {
    // Each stage works on a freshly read document. The page, a manual crawl or
    // an edit can write to the lead while the pipeline runs; reusing one
    // in-memory copy across stages would fail on Mongoose's version check.
    const reload = async (): Promise<LeadIngestionDocument> => {
      const fresh = await LeadIngestion.findById(leadId);
      if (!fresh) throw new Error('Lead was deleted while it was being processed');
      return fresh;
    };

    let lead = claimed;
    const stageReached = PIPELINE_STEP[lead.pipelineStage];

    if (stageReached <= PIPELINE_STEP.mapping) {
      await setStage(leadId, 'mapping');
      await mapLeadUrls(await reload());
    }

    lead = await reload();
    if (stageReached <= PIPELINE_STEP.crawling) {
      await setStage(leadId, 'crawling');
      const hasSomethingToCrawl =
        (lead.currentCompanies ?? []).some((c) => !!c.websiteUrl) || !!lead.portfolioUrl;
      if (hasSomethingToCrawl) {
        await crawlLeadWebsites(await reload());
      } else {
        // Nothing to crawl is a finished crawl, not a crawl waiting to start.
        await LeadIngestion.updateOne({ _id: leadId }, { $set: { crawlStatus: 'completed' } });
      }
    }

    await setStage(leadId, 'verifying');
    await verifyLeadEmails(await reload());

    await setStage(leadId, 'generating');
    await generateLeadDrafts(leadId);

    await LeadIngestion.updateOne(
      { _id: leadId },
      {
        $set: {
          pipelineStage: 'done',
          pipelineStartedAt: null,
          pipelineError: null,
          status: 'completed',
        },
      }
    );
    return { ran: true, stage: 'done' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pipeline failed';
    console.error(`[pipeline] lead ${leadId} failed:`, message);
    await LeadIngestion.updateOne(
      { _id: leadId },
      { $set: { pipelineStage: 'failed', pipelineStartedAt: null, pipelineError: message } }
    ).catch(() => undefined);
    return { ran: true, stage: 'failed', error: message };
  }
}
