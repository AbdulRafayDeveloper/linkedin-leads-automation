import mongoose from 'mongoose';
import validator from 'validator';
import { connectToMongoDB } from '@/lib/db/connection';
import {
  LeadIngestion,
  type CurrentCompanyItem,
  type EmailValidationStatus,
  type LeadIngestionDocument,
} from '@/lib/db/models/LeadIngestion';
import { Client } from '@/lib/db/models/Client';
import { sanitizeEmailHtml } from '@/lib/utils/sanitizeHtml';
import { verifyEmailSmtp } from '@/services/lead-ingestion/smtpVerifier';
import {
  approvalEligibility,
  buildVerifiedMap,
  draftItemsOfLead,
  type DraftDetail,
  type DraftEmailEntry,
  type DraftItem,
} from './draftItems';

/**
 * Every write the Drafts page makes goes through here. Each helper touches one
 * draft box only and never rewrites the whole currentCompanies array, so
 * campaign state (inCampaign, campaignSendStatus) and the boxes the user isn't
 * editing can never be lost or overwritten by stale client data.
 */

export class DraftWriteError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'DraftWriteError';
  }
}

/** Subjects are plain one-line text; the generator caps them at 350 characters. */
export const MAX_SUBJECT_LENGTH = 350;

export function normalizeSubject(raw: string): string {
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_SUBJECT_LENGTH ? text.slice(0, MAX_SUBJECT_LENGTH) : text;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function assertValidEmail(raw: string): string {
  const email = normalizeEmail(raw);
  if (!email || !validator.isEmail(email)) {
    throw new DraftWriteError(`"${raw.trim()}" is not a valid email address`, 400);
  }
  return email;
}

export async function loadLead(leadId: string): Promise<LeadIngestionDocument> {
  if (!mongoose.Types.ObjectId.isValid(leadId)) {
    throw new DraftWriteError('Invalid lead ID', 400);
  }
  await connectToMongoDB();
  const doc = await LeadIngestion.findById(leadId);
  if (!doc) {
    throw new DraftWriteError('This lead no longer exists', 404);
  }
  return doc;
}

export function companyAt(doc: LeadIngestionDocument, companyIndex: number): CurrentCompanyItem {
  const company = doc.currentCompanies?.[companyIndex];
  if (!company) {
    throw new DraftWriteError('This company box no longer exists on the lead', 404);
  }
  return company;
}

/** True while the box is still editable (not sent and not queued in a campaign). */
export function boxIsEditable(doc: LeadIngestionDocument, companyIndex: number): boolean {
  if (companyIndex === -1) {
    const sendStatus = doc.campaignSendStatus ?? doc.emailStatus;
    return !doc.inCampaign && (!sendStatus || sendStatus === 'pending' || sendStatus === 'no_contact_email');
  }
  const company = companyAt(doc, companyIndex);
  const sendStatus = company.campaignSendStatus;
  return !company.inCampaign && (!sendStatus || sendStatus === 'pending');
}

export function assertEditable(doc: LeadIngestionDocument, companyIndex: number): void {
  if (!boxIsEditable(doc, companyIndex)) {
    throw new DraftWriteError('This draft is already in a campaign and can no longer be changed', 409);
  }
}

/** The addresses of one box, in order; the first one is what a campaign sends to. */
export function boxEmails(doc: LeadIngestionDocument, companyIndex: number): string[] {
  if (companyIndex === -1) {
    const emails = doc.discoveredEmails?.length ? doc.discoveredEmails : doc.email ? [doc.email] : [];
    return [...emails];
  }
  return [...(companyAt(doc, companyIndex).companyEmails ?? [])];
}

function setBoxEmails(doc: LeadIngestionDocument, companyIndex: number, emails: string[]): void {
  if (companyIndex === -1) {
    doc.discoveredEmails = emails;
    doc.email = emails[0] ?? null;
    doc.emailValidationStatus = emails[0]
      ? buildVerifiedMap(doc.verifiedEmails).get(emails[0].toLowerCase()) ?? 'pending'
      : 'pending';
    doc.markModified('discoveredEmails');
    return;
  }
  const company = companyAt(doc, companyIndex);
  company.companyEmails = emails;
  doc.markModified('currentCompanies');
}

/** Drops verifiedEmails rows no box references any more. */
function pruneVerifiedEmails(doc: LeadIngestionDocument): void {
  const used = new Set<string>();
  for (const email of doc.discoveredEmails ?? []) used.add(email.toLowerCase());
  if (doc.email) used.add(doc.email.toLowerCase());
  for (const company of doc.currentCompanies ?? []) {
    for (const email of company.companyEmails ?? []) used.add(email.toLowerCase());
  }
  doc.verifiedEmails = (doc.verifiedEmails ?? []).filter((entry) => used.has(entry.email.toLowerCase()));
  doc.markModified('verifiedEmails');
}

function setVerifiedStatus(doc: LeadIngestionDocument, email: string, status: EmailValidationStatus): void {
  const key = normalizeEmail(email);
  const existing = (doc.verifiedEmails ?? []).find((entry) => entry.email.toLowerCase() === key);
  if (existing) existing.status = status;
  else doc.verifiedEmails.push({ email: key, status });
  doc.markModified('verifiedEmails');

  if (doc.email && doc.email.toLowerCase() === key) {
    doc.emailValidationStatus = status;
  }
}

export function emailEntries(doc: LeadIngestionDocument, companyIndex: number): DraftEmailEntry[] {
  const verified = buildVerifiedMap(doc.verifiedEmails);
  return boxEmails(doc, companyIndex).map((email) => ({
    email,
    status: verified.get(email.toLowerCase()) ?? 'pending',
  }));
}

async function clientNameOf(doc: LeadIngestionDocument): Promise<string> {
  if (!doc.clientId) return 'Client Profile';
  const client = await Client.findById(doc.clientId).select('name').lean();
  return client?.name ?? 'Client Profile';
}

function itemOf(doc: LeadIngestionDocument, companyIndex: number, clientName: string): DraftItem {
  const items = draftItemsOfLead(doc.toObject() as never, clientName);
  const item = items.find((candidate) => candidate.companyIndex === companyIndex);
  if (!item) {
    throw new DraftWriteError('This draft has no written email yet', 404);
  }
  return item;
}

/** The full draft, as the editor needs it. Always read fresh from the database. */
export async function draftDetail(doc: LeadIngestionDocument, companyIndex: number): Promise<DraftDetail> {
  const clientName = await clientNameOf(doc);
  const item = itemOf(doc, companyIndex, clientName);
  const company = companyIndex === -1 ? null : companyAt(doc, companyIndex);

  return {
    ...item,
    emails: emailEntries(doc, companyIndex),
    websiteUrl: companyIndex === -1 ? doc.portfolioUrl ?? null : company?.websiteUrl ?? null,
    leadSummary: doc.summary ?? null,
    roleSummary: company?.summary?.trim() ? company.summary : null,
    canEdit: boxIsEditable(doc, companyIndex),
  };
}

export interface DraftPatch {
  subject?: string;
  bodyHtml?: string;
  approved?: boolean;
  websiteUrl?: string | null;
}

/**
 * Updates one draft box. Approval is checked against the stored addresses, so
 * a draft can never be approved with unverified contacts even if the client
 * sends `approved: true` directly.
 */
export async function patchDraft(
  leadId: string,
  companyIndex: number,
  patch: DraftPatch
): Promise<DraftDetail> {
  const doc = await loadLead(leadId);
  if (companyIndex !== -1) companyAt(doc, companyIndex);
  assertEditable(doc, companyIndex);

  const nextApproved = patch.approved;
  if (nextApproved === true) {
    const eligibility = approvalEligibility(emailEntries(doc, companyIndex));
    if (!eligibility.ok) {
      throw new DraftWriteError(eligibility.reason ?? 'This draft cannot be approved yet', 409);
    }
  }

  if (companyIndex === -1) {
    if (patch.subject !== undefined) doc.emailSubject = normalizeSubject(patch.subject);
    if (patch.bodyHtml !== undefined) doc.emailBody = sanitizeEmailHtml(patch.bodyHtml);
    if (nextApproved !== undefined) doc.approved = nextApproved;
    if (patch.websiteUrl !== undefined) doc.portfolioUrl = patch.websiteUrl?.trim() || null;
  } else {
    const company = companyAt(doc, companyIndex);
    if (patch.subject !== undefined) company.emailSubject = normalizeSubject(patch.subject);
    if (patch.bodyHtml !== undefined) company.emailBody = sanitizeEmailHtml(patch.bodyHtml);
    if (nextApproved !== undefined) company.approved = nextApproved;
    if (patch.websiteUrl !== undefined) company.websiteUrl = patch.websiteUrl?.trim() || null;
    doc.markModified('currentCompanies');
  }

  await doc.save();
  return draftDetail(doc, companyIndex);
}

export type EmailAction = 'add' | 'remove' | 'replace' | 'verify';

/**
 * Adds, removes, replaces or re-verifies one address of a box. Adding,
 * replacing and verifying all run a real SMTP verification, for personal and
 * company boxes alike.
 */
export async function mutateDraftEmail(
  leadId: string,
  companyIndex: number,
  action: EmailAction,
  rawEmail: string,
  rawNewEmail?: string
): Promise<{ detail: DraftDetail; status: EmailValidationStatus | null }> {
  const doc = await loadLead(leadId);
  if (companyIndex !== -1) companyAt(doc, companyIndex);
  assertEditable(doc, companyIndex);

  const email = assertValidEmail(rawEmail);
  const emails = boxEmails(doc, companyIndex);
  const indexOf = emails.findIndex((candidate) => candidate.toLowerCase() === email);
  let verifiedTarget: string | null = null;

  if (action === 'add') {
    if (indexOf !== -1) {
      throw new DraftWriteError('That address is already in this list', 409);
    }
    emails.push(email);
    setBoxEmails(doc, companyIndex, emails);
    verifiedTarget = email;
  } else if (action === 'remove') {
    if (indexOf === -1) throw new DraftWriteError('That address is not in this list', 404);
    emails.splice(indexOf, 1);
    setBoxEmails(doc, companyIndex, emails);
  } else if (action === 'replace') {
    if (indexOf === -1) throw new DraftWriteError('That address is not in this list', 404);
    const newEmail = assertValidEmail(rawNewEmail ?? '');
    if (newEmail !== email && emails.some((candidate) => candidate.toLowerCase() === newEmail)) {
      throw new DraftWriteError('That address is already in this list', 409);
    }
    emails[indexOf] = newEmail;
    setBoxEmails(doc, companyIndex, emails);
    verifiedTarget = newEmail;
  } else {
    if (indexOf === -1) throw new DraftWriteError('That address is not in this list', 404);
    verifiedTarget = emails[indexOf].toLowerCase();
  }

  if (verifiedTarget) {
    setVerifiedStatus(doc, verifiedTarget, 'pending');
  }
  pruneVerifiedEmails(doc);

  // An address that is gone can't keep a box approved with unverified contacts.
  let status: EmailValidationStatus | null = null;
  if (verifiedTarget) {
    try {
      status = (await verifyEmailSmtp(verifiedTarget)).status;
    } catch {
      status = 'unknown';
    }
    setVerifiedStatus(doc, verifiedTarget, status);
  }

  // Changing contacts can invalidate an approval, so re-check it.
  const stillEligible = approvalEligibility(emailEntries(doc, companyIndex)).ok;
  if (!stillEligible) {
    if (companyIndex === -1) doc.approved = false;
    else {
      companyAt(doc, companyIndex).approved = false;
      doc.markModified('currentCompanies');
    }
  }

  await doc.save();
  return { detail: await draftDetail(doc, companyIndex), status };
}
