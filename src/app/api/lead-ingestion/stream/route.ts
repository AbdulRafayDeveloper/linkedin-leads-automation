import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { Client } from '@/lib/db/models/Client';
import { LeadIngestion, type VerifiedEmailItem } from '@/lib/db/models/LeadIngestion';
import { extractWithAi, mapUrlsToCompaniesWithAi } from '@/services/lead-ingestion/aiExtractor';
import { findEmailsOnWebsite } from '@/services/lead-ingestion/emailFinder';
import { verifyEmailSmtp } from '@/services/lead-ingestion/smtpVerifier';
import mongoose from 'mongoose';

export const maxDuration = 120;

function send(
  controller: ReadableStreamDefaultController,
  event: string,
  data: unknown
) {
  controller.enqueue(
    new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  );
}

/** Creates a new client with serial increment — same name → #01 #02 #03 */
async function createClientWithSerial(baseName: string) {
  const existing = await Client.find({ baseName }).sort({ serialNumber: -1 }).limit(1);
  const nextSerial = existing.length > 0 ? (existing[0].serialNumber ?? 0) + 1 : 1;
  const padded = String(nextSerial).padStart(2, '0');
  const fullName = `${baseName} #${padded}`;
  return Client.create({ baseName, name: fullName, serialNumber: nextSerial });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    content?: string;
    phase?: 'extract' | 'map' | 'crawl' | 'verify' | 'generate';
    leadId?: string;
  };

  const rawText = (body.content ?? '').trim();
  const phase = body.phase ?? 'extract';

  if (phase === 'extract' && !rawText) {
    return new Response(JSON.stringify({ error: 'Missing content' }), { status: 422 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await connectToMongoDB();

        // ══════════════════════════════════════════════════════════════
        // PHASE 1 — AI Extraction
        // ══════════════════════════════════════════════════════════════
        if (phase === 'extract') {
          send(controller, 'phase', { step: 1, label: 'Analysing raw profile data with AI...' });

          const aiData = await extractWithAi(rawText);
          send(controller, 'extracted', aiData);

          // Auto-create client with serial number
          const baseName = aiData.fullName ?? 'Unknown Candidate';
          const clientDoc = await createClientWithSerial(baseName);

          // Save initial lead record (status: processing)
          const primary = aiData.currentCompanies[0] ?? {
            companyName: 'Unknown Company',
            jobTitle: 'Professional',
            workPeriod: null,
            websiteUrl: null,
            summary: '',
          };

          const lead = await LeadIngestion.create({
            clientId: clientDoc._id as mongoose.Types.ObjectId,
            rawText,
            fullName: aiData.fullName,
            companyName: primary.companyName,
            jobTitle: primary.jobTitle,
            workPeriod: primary.workPeriod,
            websiteUrl: primary.websiteUrl,
            portfolioUrl: null,
            email: aiData.rawEmails[0] ?? null,
            phoneNumber: aiData.rawPhones[0] ?? null,
            summary: aiData.personSummary,
            currentCompanies: aiData.currentCompanies,
            // Store raw URLs from AI so Phase 2 can map them to companies
            additionalUrls: aiData.rawUrls,
            discoveredEmails: aiData.rawEmails,
            discoveredPhones: aiData.rawPhones,
            status: 'processing',
            crawlStatus: 'not_started',
          });

          send(controller, 'client_created', {
            clientId: (clientDoc._id as mongoose.Types.ObjectId).toString(),
            clientName: clientDoc.name,
            leadId: (lead._id as mongoose.Types.ObjectId).toString(),
          });

          // Generate personal outreach email draft immediately in Phase 1
          const { generateLeadEmail } = await import('@/services/lead-ingestion/emailGenerator');
          await generateLeadEmail((lead._id as mongoose.Types.ObjectId).toString(), { forceRegenerate: true }).catch(() => null);

          send(controller, 'phase_done', { step: 1 });
          controller.close();
          return;
        }

        // ══════════════════════════════════════════════════════════════
        // PHASE 2 — AI URL Mapping
        // ══════════════════════════════════════════════════════════════
        if (phase === 'map') {
          const leadId = body.leadId;
          if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
            send(controller, 'error', { message: 'Missing leadId for map phase' });
            controller.close();
            return;
          }

          const lead = await LeadIngestion.findById(leadId);
          if (!lead) {
            send(controller, 'error', { message: 'Lead not found' });
            controller.close();
            return;
          }

          send(controller, 'phase', { step: 2, label: 'Mapping URLs to companies with AI...' });

          // Use the raw URLs saved from Phase 1 (stored in additionalUrls)
          const allRawUrls: string[] = lead.additionalUrls ?? [];
          const companies = lead.currentCompanies ?? [];

          const { companies: mapped, portfolioUrl } = await mapUrlsToCompaniesWithAi(
            companies.map((c) => ({
              companyName: c.companyName,
              jobTitle: c.jobTitle,
              workPeriod: c.workPeriod ?? null,
              websiteUrl: c.websiteUrl ?? null,
              roleSummary: c.summary ?? '',
            })),
            allRawUrls
          );

          lead.currentCompanies = mapped.map((c) => ({
            companyName: c.companyName,
            jobTitle: c.jobTitle,
            workPeriod: c.workPeriod,
            websiteUrl: c.websiteUrl,
            summary: c.roleSummary ?? '',
          }));
          lead.portfolioUrl = portfolioUrl;
          if (mapped[0]?.websiteUrl) lead.websiteUrl = mapped[0].websiteUrl;
          await lead.save();

          send(controller, 'mapped', { mappedCompanies: mapped, portfolioUrl });
          send(controller, 'phase_done', { step: 2 });
          controller.close();
          return;
        }

        // ══════════════════════════════════════════════════════════════
        // PHASE 3 — Web Crawling
        // ══════════════════════════════════════════════════════════════
        if (phase === 'crawl') {
          const leadId = body.leadId;
          if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
            send(controller, 'error', { message: 'Missing leadId' });
            controller.close();
            return;
          }

          const lead = await LeadIngestion.findById(leadId);
          if (!lead) { send(controller, 'error', { message: 'Lead not found' }); controller.close(); return; }

          send(controller, 'phase', { step: 3, label: 'Crawling company websites for contact info...' });
          lead.crawlStatus = 'in_progress';
          await lead.save();

          const urlsToCrawl = Array.from(new Set([
            ...((lead.currentCompanies ?? []).map((c) => c.websiteUrl).filter(Boolean) as string[]),
            ...(lead.portfolioUrl ? [lead.portfolioUrl] : []),
          ])).slice(0, 3);

          const allEmails = new Set<string>(lead.discoveredEmails ?? []);
          const allPhones = new Set<string>(lead.discoveredPhones ?? []);

          for (const url of urlsToCrawl) {
            try {
              send(controller, 'crawling', { url });
              const result = await findEmailsOnWebsite(url, []);
              result.emails.forEach((e) => allEmails.add(e));
              result.phones.forEach((p) => allPhones.add(p));
              send(controller, 'crawled', { url, emails: result.emails, phones: result.phones });
            } catch {
              send(controller, 'crawl_error', { url });
            }
          }

          lead.discoveredEmails = Array.from(allEmails);
          lead.discoveredPhones = Array.from(allPhones);
          lead.crawlStatus = 'completed';

          // Automatically map discovered emails to specific companies or personal email
          const { mapEmailsToCompanies } = await import('@/services/lead-ingestion/aiExtractor');
          const emailMapResult = mapEmailsToCompanies(
            lead.discoveredEmails,
            (lead.currentCompanies ?? []).map((c) => ({
              companyName: c.companyName,
              jobTitle: c.jobTitle,
              workPeriod: c.workPeriod ?? null,
              websiteUrl: c.websiteUrl ?? null,
              roleSummary: c.summary ?? '',
            })),
            lead.portfolioUrl
          );

          lead.currentCompanies = (lead.currentCompanies ?? []).map((comp, idx) => ({
            ...comp,
            companyEmails: emailMapResult.companiesWithEmails[idx]?.companyEmails ?? comp.companyEmails ?? [],
          }));
          lead.markModified('currentCompanies');

          if (emailMapResult.primaryPersonalEmail) {
            lead.email = emailMapResult.primaryPersonalEmail;
          }

          await lead.save();

          send(controller, 'phase_done', { step: 3, emails: lead.discoveredEmails, phones: lead.discoveredPhones });
          controller.close();
          return;
        }

        // ══════════════════════════════════════════════════════════════
        // PHASE 4 — SMTP Verification
        // ══════════════════════════════════════════════════════════════
        if (phase === 'verify') {
          const leadId = body.leadId;
          if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
            send(controller, 'error', { message: 'Missing leadId' });
            controller.close();
            return;
          }

          const lead = await LeadIngestion.findById(leadId);
          if (!lead) { send(controller, 'error', { message: 'Lead not found' }); controller.close(); return; }

          const emails = Array.from(new Set([
            ...(lead.email ? [lead.email] : []),
            ...(lead.discoveredEmails ?? []),
          ]));

          send(controller, 'phase', { step: 4, label: `Verifying ${emails.length} email(s) via SMTP...` });

          const verified: VerifiedEmailItem[] = [];
          await Promise.all(
            emails.map(async (em) => {
              try {
                const r = await verifyEmailSmtp(em);
                verified.push({ email: em, status: r.status });
                send(controller, 'verified', { email: em, status: r.status });
              } catch {
                verified.push({ email: em, status: 'unknown' });
                send(controller, 'verified', { email: em, status: 'unknown' });
              }
            })
          );

          lead.verifiedEmails = verified;
          lead.emailValidationStatus = verified.find((v) => v.email === lead.email)?.status ?? verified[0]?.status ?? 'unknown';
          lead.status = 'completed';
          await lead.save();

          send(controller, 'phase_done', { step: 4, verifiedEmails: verified });
          send(controller, 'done', { result: lead.toObject() });
          controller.close();
          return;
        }

        // ══════════════════════════════════════════════════════════════
        // PHASE 5 — Auto-Generate Outreach Emails
        // ══════════════════════════════════════════════════════════════
        if (phase === 'generate') {
          const leadId = body.leadId;
          if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
            send(controller, 'error', { message: 'Missing leadId' });
            controller.close();
            return;
          }

          send(controller, 'phase', { step: 5, label: `Generating AI outreach drafts...` });

          const { generateLeadEmail } = await import('@/services/lead-ingestion/emailGenerator');
          
          let updatedLead: mongoose.Document | null = null;
          try {
            // Force regenerate = true ensures drafts are ALWAYS written
            updatedLead = await generateLeadEmail(leadId, { forceRegenerate: true });
            send(controller, 'phase_done', { step: 5, status: 'success' });
          } catch (err) {
            send(controller, 'phase_done', { step: 5, status: 'failed', error: String(err) });
          }

          // Fetch the final, fully populated lead document
          if (!updatedLead) updatedLead = await LeadIngestion.findById(leadId);

          send(controller, 'done', { result: updatedLead?.toObject() });
          controller.close();
          return;
        }

        send(controller, 'error', { message: `Unknown phase: ${String(phase)}` });
        controller.close();
      } catch (err) {
        send(controller, 'error', { message: err instanceof Error ? err.message : 'Unknown error' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
