import { connectToMongoDB } from '@/lib/db/connection';
import { Client, type ClientDocument } from '@/lib/db/models/Client';
import { LeadIngestion, type LeadIngestionDocument, type VerifiedEmailItem } from '@/lib/db/models/LeadIngestion';
import { findEmailsOnWebsite } from './emailFinder';
import { verifyEmailSmtp } from './smtpVerifier';
import mongoose from 'mongoose';

export async function createClient(name: string): Promise<ClientDocument> {
  await connectToMongoDB();
  const trimmedName = name.trim();
  const existing = await Client.findOne({ name: trimmedName });
  if (existing) return existing;
  return new Client({ name: trimmedName }).save();
}

export async function getClients(): Promise<ClientDocument[]> {
  await connectToMongoDB();
  return Client.find().sort({ createdAt: -1 });
}

export async function startWebsiteDiscovery(
  leadId: string,
  additionalUrls: string[] = []
): Promise<LeadIngestionDocument | null> {
  await connectToMongoDB();
  if (!mongoose.Types.ObjectId.isValid(leadId)) throw new Error('Invalid lead ID');

  const doc = await LeadIngestion.findById(leadId);
  if (!doc) return null;

  doc.crawlStatus = 'in_progress';
  const urlSet = Array.from(new Set([
    ...(doc.additionalUrls ?? []),
    ...additionalUrls,
    ...(doc.portfolioUrl ? [doc.portfolioUrl] : []),
  ]));
  doc.additionalUrls = urlSet;
  await doc.save();

  try {
    const targetUrl = doc.websiteUrl ?? doc.portfolioUrl ?? additionalUrls[0] ?? '';
    const crawl = await findEmailsOnWebsite(targetUrl, doc.additionalUrls);
    doc.discoveredEmails = crawl.emails;
    doc.discoveredPhones = crawl.phones;
    doc.siteType = crawl.siteType;

    const emailsToVerify = Array.from(new Set([...(doc.email ? [doc.email] : []), ...crawl.emails]));
    const verified: VerifiedEmailItem[] = [];
    await Promise.all(
      emailsToVerify.map(async (em) => {
        try {
          const r = await verifyEmailSmtp(em);
          verified.push({ email: em, status: r.status });
        } catch {
          verified.push({ email: em, status: 'unknown' });
        }
      })
    );

    doc.verifiedEmails = verified;
    if (emailsToVerify.length > 0) {
      if (!doc.email) doc.email = emailsToVerify[0];
      doc.emailValidationStatus = verified.find((v) => v.email === doc.email)?.status ?? 'unknown';
    } else {
      doc.emailValidationStatus = 'unknown';
    }
    doc.crawlStatus = 'completed';
    return doc.save();
  } catch {
    doc.crawlStatus = 'failed';
    await doc.save().catch(() => undefined);
    return doc;
  }
}

export async function getIngestedLeads(clientId: string): Promise<LeadIngestionDocument[]> {
  await connectToMongoDB();
  if (!mongoose.Types.ObjectId.isValid(clientId)) throw new Error('Invalid client ID');
  return LeadIngestion.find({ clientId: new mongoose.Types.ObjectId(clientId) }).sort({ createdAt: -1 });
}

export async function updateLeadWebsite(
  id: string,
  websiteUrl: string,
  additionalUrls: string[] = []
): Promise<LeadIngestionDocument> {
  await connectToMongoDB();
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Invalid lead ID');
  const doc = await LeadIngestion.findById(id);
  if (!doc) throw new Error('Lead not found');
  doc.websiteUrl = websiteUrl.trim();
  if (additionalUrls.length > 0) {
    doc.additionalUrls = Array.from(new Set([...doc.additionalUrls, ...additionalUrls]));
  }
  const saved = await doc.save();
  startWebsiteDiscovery(saved._id.toString(), additionalUrls).catch(() => undefined);
  return saved;
}

/** @deprecated Use /api/lead-ingestion/stream for new ingestion */
export async function createAndProcessLead(
  _clientIdInput?: string,
  rawText?: string
): Promise<LeadIngestionDocument[]> {
  await connectToMongoDB();
  const contentText = rawText ?? '';
  if (!contentText.trim()) throw new Error('Content text is required');

  // Lazy import to avoid circular deps at module load
  const { extractWithAi, mapUrlsToCompaniesWithAi } = await import('./aiExtractor');
  const aiData = await extractWithAi(contentText).catch(() => ({
    fullName: 'Unknown Candidate',
    personSummary: '',
    currentCompanies: [{ companyName: 'Unspecified Company', jobTitle: 'Professional', workPeriod: null, websiteUrl: null, roleSummary: '' }],
    rawUrls: [],
    rawEmails: [],
    rawPhones: [],
  }));

  const { companies: mapped, portfolioUrl } = await mapUrlsToCompaniesWithAi(
    aiData.currentCompanies,
    aiData.rawUrls
  );

  const clientName = aiData.fullName ?? 'Unknown Candidate';
  let clientDoc = await Client.findOne({ name: clientName });
  if (!clientDoc) clientDoc = await new Client({ name: clientName }).save();

  const primary = mapped[0] ?? { companyName: 'Unspecified Company', jobTitle: 'Professional', workPeriod: null, websiteUrl: null, roleSummary: '' };

  const doc = await new LeadIngestion({
    clientId: clientDoc._id,
    rawText: contentText,
    fullName: aiData.fullName,
    companyName: primary.companyName,
    jobTitle: primary.jobTitle,
    workPeriod: primary.workPeriod,
    email: aiData.rawEmails[0] ?? null,
    phoneNumber: aiData.rawPhones[0] ?? null,
    websiteUrl: primary.websiteUrl,
    portfolioUrl,
    summary: aiData.personSummary,
    currentCompanies: mapped,
    discoveredEmails: aiData.rawEmails,
    discoveredPhones: aiData.rawPhones,
    status: 'completed',
    crawlStatus: 'not_started',
  }).save();

  if (doc.websiteUrl ?? doc.portfolioUrl) {
    startWebsiteDiscovery(doc._id.toString()).catch(() => undefined);
  }

  return [doc];
}
