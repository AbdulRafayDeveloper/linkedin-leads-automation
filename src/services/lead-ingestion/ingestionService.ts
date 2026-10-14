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
  additionalUrls: string[] = [],
  companyIndex?: number
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

    // ── Assign discovered emails to the correct bucket ──────────────────
    // When companyIndex is provided (user crawled a specific company URL),
    // assign emails directly to that company's companyEmails array.
    // Always also merge into discoveredEmails for global SMTP verification.
    if (typeof companyIndex === 'number' && doc.currentCompanies[companyIndex]) {
      const compSubdoc = doc.currentCompanies[companyIndex];
      const existing = compSubdoc.companyEmails ?? [];
      compSubdoc.companyEmails = Array.from(new Set([...existing, ...crawl.emails]));
      doc.markModified('currentCompanies');

      // Also merge into discoveredEmails for global SMTP tracking
      const allDiscovered = Array.from(new Set([...doc.discoveredEmails, ...crawl.emails]));
      doc.discoveredEmails = allDiscovered;
    } else {
      // No companyIndex: merge into global discoveredEmails pool
      const merged = Array.from(new Set([...(doc.discoveredEmails ?? []), ...crawl.emails]));
      doc.discoveredEmails = merged;
    }

    doc.discoveredPhones = crawl.phones;
    doc.siteType = crawl.siteType;

    const emailsToVerify = Array.from(new Set([...(doc.email ? [doc.email] : []), ...doc.discoveredEmails]));
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
      // Only update personal emailValidationStatus for the personal primary email
      const personalStatus = verified.find((v) => v.email === doc.email)?.status;
      if (personalStatus) doc.emailValidationStatus = personalStatus;
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
