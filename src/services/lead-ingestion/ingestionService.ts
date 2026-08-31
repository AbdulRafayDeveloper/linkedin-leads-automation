import { connectToMongoDB } from '@/lib/db/connection';
import { Client, type ClientDocument } from '@/lib/db/models/Client';
import { LeadIngestion, type LeadIngestionDocument } from '@/lib/db/models/LeadIngestion';
import { extractWithRegex } from './regexExtractor';
import { extractWithAi } from './aiExtractor';
import { findEmailsOnWebsite } from './emailFinder';
import { verifyEmailSmtp } from './smtpVerifier';
import mongoose from 'mongoose';

export async function createClient(name: string): Promise<ClientDocument> {
  await connectToMongoDB();
  const client = new Client({ name });
  return await client.save();
}

export async function getClients(): Promise<ClientDocument[]> {
  await connectToMongoDB();
  return await Client.find().sort({ createdAt: -1 });
}

export async function startWebsiteDiscovery(leadId: string): Promise<LeadIngestionDocument | null> {
  await connectToMongoDB();

  if (!mongoose.Types.ObjectId.isValid(leadId)) {
    throw new Error('Invalid lead ID');
  }

  const doc = await LeadIngestion.findById(leadId);
  if (!doc || !doc.websiteUrl) {
    return doc;
  }

  doc.crawlStatus = 'in_progress';
  await doc.save();

  try {
    const discovered = await findEmailsOnWebsite(doc.websiteUrl);
    doc.discoveredEmails = discovered;

    if (discovered.length > 0) {
      // Pick first email and verify it
      const primaryEmail = discovered[0];
      doc.email = primaryEmail;
      doc.emailValidationStatus = 'pending';
      await doc.save();

      try {
        const verifyResult = await verifyEmailSmtp(primaryEmail);
        doc.emailValidationStatus = verifyResult.status;
        doc.emailValidationDetails = JSON.stringify({
          reasons: verifyResult.reasons,
        });
      } catch (err) {
        doc.emailValidationStatus = 'unknown';
        doc.emailValidationDetails = JSON.stringify({
          reasons: [`Verification error: ${err instanceof Error ? err.message : 'Unknown error'}`],
        });
      }
    } else {
      // No emails found
      doc.emailValidationStatus = 'unknown';
      doc.emailValidationDetails = JSON.stringify({
        reasons: ['No contact emails were found on the website pages crawled'],
      });
    }

    doc.crawlStatus = 'completed';
    return await doc.save();
  } catch (error) {
    doc.crawlStatus = 'failed';
    await doc.save().catch(() => undefined);
    throw error;
  }
}

export async function createAndProcessLead(
  clientId: string,
  rawText: string
): Promise<LeadIngestionDocument> {
  await connectToMongoDB();

  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    throw new Error('Invalid client ID');
  }

  const doc = new LeadIngestion({
    clientId: new mongoose.Types.ObjectId(clientId),
    rawText,
    status: 'processing',
    crawlStatus: 'not_started',
  });
  await doc.save();

  try {
    const [regexData, aiData] = await Promise.all([
      Promise.resolve(extractWithRegex(rawText)),
      extractWithAi(rawText).catch(() => ({
        summary: 'Failed to generate AI summary.',
        fullName: null,
        email: null,
        phoneNumber: null,
        websiteUrl: null,
      })),
    ]);

    doc.fullName = aiData.fullName || regexData.fullName;
    doc.email = aiData.email || regexData.email;
    doc.phoneNumber = aiData.phoneNumber || regexData.phoneNumber;
    doc.websiteUrl = aiData.websiteUrl || regexData.websiteUrl;
    doc.summary = aiData.summary;
    doc.status = 'completed';

    const saved = await doc.save();

    // Trigger website crawling in the background if website is present
    if (saved.websiteUrl) {
      startWebsiteDiscovery(saved._id.toString()).catch(() => undefined);
    }

    return saved;
  } catch (error) {
    doc.status = 'failed';
    await doc.save().catch(() => undefined);
    throw error;
  }
}

export async function updateLeadWebsite(
  id: string,
  websiteUrl: string
): Promise<LeadIngestionDocument> {
  await connectToMongoDB();

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid lead ingestion ID');
  }

  const doc = await LeadIngestion.findById(id);
  if (!doc) {
    throw new Error('Lead ingestion record not found');
  }

  doc.websiteUrl = websiteUrl.trim();
  const saved = await doc.save();

  // Trigger website crawling in the background
  startWebsiteDiscovery(saved._id.toString()).catch(() => undefined);

  return saved;
}

export async function getIngestedLeads(clientId: string): Promise<LeadIngestionDocument[]> {
  await connectToMongoDB();

  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    throw new Error('Invalid client ID');
  }

  return await LeadIngestion.find({ clientId: new mongoose.Types.ObjectId(clientId) }).sort({
    createdAt: -1,
  });
}
