import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { connectToMongoDB } from '@/lib/db/connection';
import { Client, type ClientDocument } from '@/lib/db/models/Client';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { checkIngestionInput } from '@/lib/validation/ingestionInput';
import { extractWithAi, sanitizeExtraction, type AiExtractedData } from './aiExtractor';

/**
 * Turning pasted text into a lead, in two steps: `previewIngestion` reads the
 * text with the AI and reports what it found, then `createLeadFromPreview`
 * writes the records once the user has confirmed. Nothing is stored until the
 * user confirms, so a bad paste never leaves a half-empty lead behind.
 */

export class IngestionInputError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'IngestionInputError';
  }
}

const PLACEHOLDER_COMPANIES = new Set(['Unspecified Company', 'Unknown Company']);

export function hashRawText(rawText: string): string {
  return createHash('sha256').update(rawText.trim()).digest('hex');
}

export interface DuplicateLead {
  leadId: string;
  clientName: string | null;
  fullName: string | null;
  createdAt: string;
}

export interface IngestionPreview {
  extraction: AiExtractedData;
  /** Things the user should know before saving, in plain English. */
  warnings: string[];
  summary: {
    fullName: string | null;
    companies: { companyName: string; jobTitle: string; websiteUrl: string | null }[];
    emails: string[];
    phones: string[];
    urls: string[];
  };
  duplicate: DuplicateLead | null;
}

function buildWarnings(extraction: AiExtractedData): string[] {
  const warnings: string[] = [];
  if (extraction.usedFallback) {
    warnings.push('AI extraction failed, so the text was read with the basic parser. Check the details before saving.');
  }
  if (!extraction.fullName) warnings.push('No name was found in this text.');
  const realCompanies = extraction.currentCompanies.filter((c) => !PLACEHOLDER_COMPANIES.has(c.companyName));
  if (realCompanies.length === 0) warnings.push('No current company was found.');
  if (extraction.rawEmails.length === 0) {
    warnings.push('No email address in the text. The crawler will look for one on the company website.');
  }
  return warnings;
}

/** A lead is only worth creating if at least one of these is real. */
function isUsable(extraction: AiExtractedData): boolean {
  const hasName = !!extraction.fullName;
  const hasCompany = extraction.currentCompanies.some((c) => !PLACEHOLDER_COMPANIES.has(c.companyName));
  const hasEmail = extraction.rawEmails.length > 0;
  return hasName || hasCompany || hasEmail;
}

async function findDuplicate(rawText: string): Promise<DuplicateLead | null> {
  const existing = await LeadIngestion.findOne({ rawTextHash: hashRawText(rawText) })
    .sort({ createdAt: -1 })
    .select('fullName clientId createdAt')
    .lean<{ _id: mongoose.Types.ObjectId; fullName: string | null; clientId: mongoose.Types.ObjectId; createdAt: Date } | null>();
  if (!existing) return null;

  const client = await Client.findById(existing.clientId).select('name').lean<{ name: string } | null>();
  return {
    leadId: existing._id.toString(),
    clientName: client?.name ?? null,
    fullName: existing.fullName ?? null,
    createdAt: new Date(existing.createdAt).toISOString(),
  };
}

export async function previewIngestion(rawText: string): Promise<IngestionPreview> {
  const check = checkIngestionInput(rawText);
  if (!check.ok) throw new IngestionInputError(check.message!);

  await connectToMongoDB();
  const text = rawText.trim();
  const extraction = await extractWithAi(text);

  if (!isUsable(extraction)) {
    throw new IngestionInputError(
      'No profile details could be read from this text. Copy the profile page again, including the name, current role and company.'
    );
  }

  return {
    extraction,
    warnings: buildWarnings(extraction),
    summary: {
      fullName: extraction.fullName,
      companies: extraction.currentCompanies.map((c) => ({
        companyName: c.companyName,
        jobTitle: c.jobTitle,
        websiteUrl: c.websiteUrl,
      })),
      emails: extraction.rawEmails,
      phones: extraction.rawPhones,
      urls: extraction.rawUrls,
    },
    duplicate: await findDuplicate(text),
  };
}

/**
 * Allocates "<name> #NN" without two parallel requests picking the same number:
 * the counter is bumped atomically, then the name is checked for a clash left
 * over from older data.
 */
async function createClientWithSerial(baseName: string, linkedinUrl: string | null): Promise<ClientDocument> {
  const counters = mongoose.connection.db?.collection<{ _id: string; seq: number }>('clientcounters');
  const highest = await Client.findOne({ baseName }).sort({ serialNumber: -1 }).select('serialNumber').lean<{ serialNumber: number } | null>();
  const floor = highest?.serialNumber ?? 0;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let serial: number;
    if (counters) {
      const counter = await counters.findOneAndUpdate(
        { _id: baseName },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
      );
      serial = counter?.seq ?? floor + 1 + attempt;
      if (serial <= floor) {
        // Older clients exist from before the counter: jump it past them.
        const bumped = await counters.findOneAndUpdate(
          { _id: baseName },
          { $max: { seq: floor + 1 } },
          { returnDocument: 'after' }
        );
        serial = bumped?.seq ?? floor + 1;
      }
    } else {
      serial = floor + 1 + attempt;
    }

    const name = `${baseName} #${String(serial).padStart(2, '0')}`;
    const clash = await Client.exists({ name });
    if (clash) continue;
    return Client.create({ baseName, name, serialNumber: serial, linkedinUrl });
  }

  // Fall back to a name that cannot clash.
  const unique = `${baseName} #${Date.now().toString().slice(-6)}`;
  return Client.create({ baseName, name: unique, serialNumber: floor + 1, linkedinUrl });
}

function linkedInProfileUrl(urls: string[]): string | null {
  return urls.find((u) => /linkedin\.com\/(in|pub)\//i.test(u)) ?? null;
}

export interface CreateLeadInput {
  rawText: string;
  /** The extraction shown in the preview. Re-checked against the text here. */
  extraction?: AiExtractedData | null;
  /** True once the user has chosen to import a profile that is already saved. */
  force?: boolean;
}

export interface CreateLeadResult {
  leadId: string;
  clientId: string;
  clientName: string;
  warnings: string[];
}

export class DuplicateLeadError extends Error {
  readonly status = 409;
  constructor(readonly duplicate: DuplicateLead) {
    super('This profile has already been imported.');
    this.name = 'DuplicateLeadError';
  }
}

export async function createLeadFromPreview(input: CreateLeadInput): Promise<CreateLeadResult> {
  const check = checkIngestionInput(input.rawText);
  if (!check.ok) throw new IngestionInputError(check.message!);

  await connectToMongoDB();
  const rawText = input.rawText.trim();

  if (!input.force) {
    const duplicate = await findDuplicate(rawText);
    if (duplicate) throw new DuplicateLeadError(duplicate);
  }

  // Re-run the sanitiser on whatever the browser sent back, so a hand-made
  // request cannot smuggle in an email or URL that is not in the pasted text.
  const extraction = input.extraction
    ? sanitizeExtraction({ ...input.extraction, usedFallback: !!input.extraction.usedFallback }, rawText)
    : await extractWithAi(rawText);

  if (!isUsable(extraction)) {
    throw new IngestionInputError(
      'No profile details could be read from this text. Copy the profile page again, including the name, current role and company.'
    );
  }

  const baseName = extraction.fullName ?? 'Unknown Candidate';
  const client = await createClientWithSerial(baseName, linkedInProfileUrl(extraction.rawUrls));

  try {
    const primary = extraction.currentCompanies[0] ?? {
      companyName: 'Unspecified Company',
      jobTitle: 'Professional',
      workPeriod: null,
      websiteUrl: null,
      roleSummary: '',
    };

    const lead = await LeadIngestion.create({
      clientId: client._id,
      rawText,
      rawTextHash: hashRawText(rawText),
      extractionSource: extraction.usedFallback ? 'regex_fallback' : 'ai',
      pipelineStage: 'extracted',
      fullName: extraction.fullName,
      companyName: primary.companyName,
      jobTitle: primary.jobTitle,
      workPeriod: primary.workPeriod,
      websiteUrl: primary.websiteUrl,
      portfolioUrl: null,
      email: extraction.rawEmails[0] ?? null,
      phoneNumber: extraction.rawPhones[0] ?? null,
      summary: extraction.personSummary,
      currentCompanies: extraction.currentCompanies.map((c) => ({
        companyName: c.companyName,
        jobTitle: c.jobTitle,
        workPeriod: c.workPeriod,
        websiteUrl: c.websiteUrl,
        summary: c.roleSummary ?? '',
        companyEmails: [],
        emailSubject: null,
        emailBody: null,
        approved: false,
      })),
      additionalUrls: extraction.rawUrls,
      discoveredEmails: extraction.rawEmails,
      discoveredPhones: extraction.rawPhones,
      status: 'processing',
      crawlStatus: 'not_started',
    });

    return {
      leadId: (lead._id as mongoose.Types.ObjectId).toString(),
      clientId: (client._id as mongoose.Types.ObjectId).toString(),
      clientName: client.name,
      warnings: buildWarnings(extraction),
    };
  } catch (error) {
    // Never leave a client behind that has no lead.
    await Client.deleteOne({ _id: client._id }).catch(() => undefined);
    console.error('[intake] lead creation failed, rolled back client:', error instanceof Error ? error.message : error);
    throw error;
  }
}
