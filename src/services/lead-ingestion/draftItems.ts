import type { EmailValidationStatus } from '@/lib/db/models/LeadIngestion';

/**
 * The Drafts page (/lead-ingestion/emails) works with one item per outreach
 * draft: the lead's personal draft (companyIndex -1) and one per current
 * company. Filtering, counting and pagination all happen per item, not per
 * lead, so "Drafts only" never shows an approved box and a page is never
 * silently empty. These helpers are pure so they can be unit tested.
 */

export type DraftApprovalFilter = 'all' | 'approved' | 'draft';
export type DraftSmtpFilter = 'all' | 'valid' | 'unverified' | 'invalid' | 'no_contact_email';
export type DraftSendStatusFilter =
  | 'all'
  | 'pending'
  | 'in_progress'
  | 'delivered'
  | 'opened'
  | 'failed'
  | 'no_contact_email';

export type DraftSendStatus = Exclude<DraftSendStatusFilter, 'all'>;

export interface DraftItem {
  /** Stable key: leadId + box index. */
  id: string;
  leadId: string;
  /** -1 = the lead's personal draft, >= 0 = index into currentCompanies. */
  companyIndex: number;
  clientId: string | null;
  clientName: string;
  /** The "#24" serial from the client name, when it has one. */
  serial: string | null;
  candidateName: string;
  companyName: string;
  jobTitle: string | null;
  subject: string;
  bodyHtml: string;
  approved: boolean;
  /** First address of the box: the one a campaign would send to. */
  targetEmail: string | null;
  emailCount: number;
  /** null when the box has no address at all. */
  smtpStatus: EmailValidationStatus | null;
  sendStatus: DraftSendStatus;
  inCampaign: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DraftFilters {
  approval: DraftApprovalFilter;
  smtp: DraftSmtpFilter;
  sendStatus: DraftSendStatusFilter;
}

export interface DraftCounts {
  total: number;
  approved: number;
  draft: number;
  valid: number;
  unverified: number;
  invalid: number;
  no_contact_email: number;
}

/** Shape this module needs from a lead document (lean or serialized). */
export interface DraftSourceLead {
  _id: unknown;
  clientId?: unknown;
  fullName?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  email?: string | null;
  discoveredEmails?: string[] | null;
  verifiedEmails?: Array<{ email?: string | null; status?: string | null }> | null;
  emailValidationStatus?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  approved?: boolean | null;
  inCampaign?: boolean | null;
  campaignSendStatus?: string | null;
  emailStatus?: string | null;
  currentCompanies?: Array<{
    companyName?: string | null;
    jobTitle?: string | null;
    companyEmails?: string[] | null;
    emailSubject?: string | null;
    emailBody?: string | null;
    approved?: boolean | null;
    inCampaign?: boolean | null;
    campaignSendStatus?: string | null;
  }> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

const SEND_STATUSES: DraftSendStatus[] = [
  'pending',
  'in_progress',
  'delivered',
  'opened',
  'failed',
  'no_contact_email',
];

const VALIDATION_STATUSES: EmailValidationStatus[] = ['pending', 'valid', 'invalid', 'risky', 'unknown'];

/** Addresses are compared case-insensitively everywhere; statuses are keyed the same way. */
export function buildVerifiedMap(
  verifiedEmails: DraftSourceLead['verifiedEmails']
): Map<string, EmailValidationStatus> {
  const map = new Map<string, EmailValidationStatus>();
  for (const entry of verifiedEmails ?? []) {
    const email = entry?.email?.trim().toLowerCase();
    if (!email) continue;
    const status = VALIDATION_STATUSES.includes(entry?.status as EmailValidationStatus)
      ? (entry?.status as EmailValidationStatus)
      : 'pending';
    map.set(email, status);
  }
  return map;
}

function cleanEmails(emails: Array<string | null | undefined> | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails ?? []) {
    const email = raw?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function toSendStatus(value: unknown, hasEmail: boolean): DraftSendStatus {
  if (!hasEmail) return 'no_contact_email';
  if (value === 'sending') return 'in_progress';
  return SEND_STATUSES.includes(value as DraftSendStatus) ? (value as DraftSendStatus) : 'pending';
}

function serialOf(clientName: string): string | null {
  return clientName.match(/#\d+/)?.[0] ?? null;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Every draft box of one lead: personal first, then each company in order. */
export function draftItemsOfLead(lead: DraftSourceLead, clientName = 'Client Profile'): DraftItem[] {
  const leadId = String(lead._id);
  const verified = buildVerifiedMap(lead.verifiedEmails);
  const clientId = lead.clientId ? String(lead.clientId) : null;
  const serial = serialOf(clientName);
  const candidateName = lead.fullName?.trim() || 'Candidate Profile';
  const createdAt = isoOrNull(lead.createdAt);
  const updatedAt = isoOrNull(lead.updatedAt);
  const items: DraftItem[] = [];

  const push = (
    companyIndex: number,
    companyName: string,
    jobTitle: string | null,
    subject: string,
    bodyHtml: string,
    approved: boolean,
    emails: string[],
    inCampaign: boolean,
    rawSendStatus: unknown
  ) => {
    const targetEmail = emails[0] ?? null;
    items.push({
      id: `${leadId}:${companyIndex}`,
      leadId,
      companyIndex,
      clientId,
      clientName,
      serial,
      candidateName,
      companyName,
      jobTitle,
      subject,
      bodyHtml,
      approved,
      targetEmail,
      emailCount: emails.length,
      smtpStatus: targetEmail ? verified.get(targetEmail.toLowerCase()) ?? 'pending' : null,
      sendStatus: toSendStatus(rawSendStatus, Boolean(targetEmail)),
      inCampaign,
      createdAt,
      updatedAt,
    });
  };

  // Personal draft. Its send status never comes from a company box.
  if (lead.emailSubject?.trim() && lead.emailBody?.trim()) {
    const source = lead.discoveredEmails?.length ? lead.discoveredEmails : lead.email ? [lead.email] : [];
    push(
      -1,
      lead.companyName?.trim() || 'Personal / Direct Email',
      lead.jobTitle?.trim() || null,
      lead.emailSubject,
      lead.emailBody,
      Boolean(lead.approved),
      cleanEmails(source),
      Boolean(lead.inCampaign),
      lead.campaignSendStatus ?? lead.emailStatus
    );
  }

  // Company drafts. A company box only ever uses its own campaign status, so a
  // sent personal email can't make a company draft look "Delivered".
  (lead.currentCompanies ?? []).forEach((company, index) => {
    if (!company?.emailSubject?.trim() || !company?.emailBody?.trim()) return;
    push(
      index,
      company.companyName?.trim() || 'Unspecified Company',
      company.jobTitle?.trim() || null,
      company.emailSubject,
      company.emailBody,
      Boolean(company.approved),
      cleanEmails(company.companyEmails),
      Boolean(company.inCampaign),
      company.campaignSendStatus
    );
  });

  return items;
}

export function buildDraftItems(leads: DraftSourceLead[], clientNameById: Map<string, string>): DraftItem[] {
  return leads.flatMap((lead) =>
    draftItemsOfLead(lead, clientNameById.get(String(lead.clientId ?? '')) ?? 'Client Profile')
  );
}

/** "Verified" means valid or risky: the same rule campaign sending uses. */
export function isSendableStatus(status: EmailValidationStatus | null): boolean {
  return status === 'valid' || status === 'risky';
}

export function matchesSmtpFilter(item: DraftItem, filter: DraftSmtpFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'no_contact_email') return !item.targetEmail;
  if (!item.targetEmail) return false;
  if (filter === 'valid') return isSendableStatus(item.smtpStatus);
  if (filter === 'invalid') return item.smtpStatus === 'invalid';
  // unverified: has an address, but it is neither sendable nor known-invalid
  return !isSendableStatus(item.smtpStatus) && item.smtpStatus !== 'invalid';
}

export function matchesFilters(item: DraftItem, filters: DraftFilters): boolean {
  if (filters.approval === 'approved' && !item.approved) return false;
  if (filters.approval === 'draft' && item.approved) return false;
  if (filters.sendStatus !== 'all' && item.sendStatus !== filters.sendStatus) return false;
  return matchesSmtpFilter(item, filters.smtp);
}

export function filterDraftItems(items: DraftItem[], filters: DraftFilters): DraftItem[] {
  return items.filter((item) => matchesFilters(item, filters));
}

/** How many items each filter value would show, so the UI can label its options. */
export function countDraftItems(items: DraftItem[]): DraftCounts {
  const counts: DraftCounts = {
    total: items.length,
    approved: 0,
    draft: 0,
    valid: 0,
    unverified: 0,
    invalid: 0,
    no_contact_email: 0,
  };
  for (const item of items) {
    if (item.approved) counts.approved++;
    else counts.draft++;

    if (matchesSmtpFilter(item, 'valid')) counts.valid++;
    else if (matchesSmtpFilter(item, 'invalid')) counts.invalid++;
    else if (matchesSmtpFilter(item, 'no_contact_email')) counts.no_contact_email++;
    else counts.unverified++;
  }
  return counts;
}

export interface DraftEmailEntry {
  email: string;
  status: EmailValidationStatus;
}

/** One draft with everything the editor needs. Returned by the draft detail API. */
export interface DraftDetail extends DraftItem {
  emails: DraftEmailEntry[];
  websiteUrl: string | null;
  leadSummary: string | null;
  roleSummary: string | null;
  /** False once the draft is in a campaign: content and contacts are then frozen. */
  canEdit: boolean;
}

/**
 * The single approval rule, used by the UI to label the button and by the API
 * to enforce it: a box needs at least one address and every address must be
 * sendable (valid or risky).
 */
export function approvalEligibility(emails: DraftEmailEntry[]): { ok: boolean; reason: string | null } {
  if (emails.length === 0) {
    return { ok: false, reason: 'Add at least one contact email before approving this draft.' };
  }
  const blocked = emails.filter((entry) => !isSendableStatus(entry.status));
  if (blocked.length > 0) {
    const list = blocked.map((entry) => entry.email).join(', ');
    return {
      ok: false,
      reason: `Verify or remove these addresses before approving: ${list}.`,
    };
  }
  return { ok: true, reason: null };
}

export function parseApprovalFilter(value: string | null): DraftApprovalFilter {
  return value === 'approved' || value === 'draft' ? value : 'all';
}

export function parseSmtpFilter(value: string | null): DraftSmtpFilter {
  return value === 'valid' || value === 'unverified' || value === 'invalid' || value === 'no_contact_email'
    ? value
    : 'all';
}

export function parseSendStatusFilter(value: string | null): DraftSendStatusFilter {
  return SEND_STATUSES.includes(value as DraftSendStatus) ? (value as DraftSendStatus) : 'all';
}
