import type { BadgeTone } from '@/components/ui/Badge';

/**
 * Pure helpers behind the lead cards on /my-leads. Kept out of the component so
 * the rules that decide what a badge says are unit tested.
 */

export type EmailCheck = 'valid' | 'risky' | 'invalid' | 'unknown' | 'pending' | 'unchecked';

export interface VerifiedEmail {
  email: string;
  status: Exclude<EmailCheck, 'unchecked'>;
}

export interface LeadCardCompany {
  companyName: string | null;
  jobTitle: string | null;
  websiteUrl: string | null;
  companyEmails: string[];
  approved: boolean;
}

export interface LeadCardRecord {
  _id: string;
  clientId?: string | null;
  clientName?: string | null;
  fullName: string | null;
  companyName: string | null;
  jobTitle: string | null;
  email: string | null;
  discoveredEmails?: string[];
  verifiedEmails?: VerifiedEmail[];
  emailValidationStatus?: EmailCheck | null;
  emailStatus?: string | null;
  approved?: boolean;
  currentCompanies?: LeadCardCompany[];
  portfolioUrl?: string | null;
  websiteUrl?: string | null;
  additionalUrls?: string[];
  /** First LinkedIn URL found in the pasted profile, picked on the server. */
  rawLinkedinUrl?: string | null;
  createdAt?: string | null;
}

export interface EmailRow {
  email: string;
  status: EmailCheck;
  /** The same address also appears in another box on this lead. */
  shared: boolean;
}

export interface LeadBox {
  key: string;
  kind: 'personal' | 'company';
  title: string;
  subtitle: string | null;
  approved: boolean;
  emails: EmailRow[];
}

/** Values the pipeline writes when it has nothing real; never shown as data. */
const PLACEHOLDER_VALUES = new Set([
  'unspecified company',
  'unknown company',
  'professional',
  'n/a',
  'none',
  'null',
  'undefined',
]);

export function isPlaceholderValue(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
}

/** `value` if it is real, otherwise null. */
export function realValue(value: string | null | undefined): string | null {
  return isPlaceholderValue(value) ? null : (value as string).trim();
}

/**
 * Flags a name the extractor clearly got wrong ("0 notifications", a URL, a
 * sentence), so the card can ask for a look instead of presenting it as a person.
 */
export function looksUnreliableName(value: string | null | undefined): boolean {
  const name = realValue(value);
  if (!name) return false;
  if (name.length > 60) return true;
  if (/[@<>]|https?:\/\//i.test(name)) return true;
  if (!/\p{L}/u.test(name)) return true;
  if (/^[^\p{L}]/u.test(name)) return true;
  if (name.split(/\s+/).length > 6) return true;
  return false;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmailLike(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value.trim());
}

/** Unique by lower case, keeping the first spelling and dropping junk entries. */
export function dedupeEmails(emails: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const value = raw?.trim();
    if (!value || !isEmailLike(value)) continue;
    const key = normalizeEmail(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function buildVerificationMap(verified: VerifiedEmail[] | undefined): Map<string, EmailCheck> {
  const map = new Map<string, EmailCheck>();
  for (const item of verified ?? []) {
    if (!item?.email) continue;
    map.set(normalizeEmail(item.email), item.status);
  }
  return map;
}

/**
 * The status of this exact address. A record for another address is never
 * borrowed; the lead-level status only counts for the lead's primary email.
 */
export function resolveEmailStatus(
  email: string,
  map: Map<string, EmailCheck>,
  options: { primaryEmail?: string | null; primaryStatus?: EmailCheck | null } = {}
): EmailCheck {
  const key = normalizeEmail(email);
  const exact = map.get(key);
  if (exact) return exact;
  const primary = options.primaryEmail ? normalizeEmail(options.primaryEmail) : null;
  if (primary && primary === key && options.primaryStatus) return options.primaryStatus;
  return 'unchecked';
}

export interface EmailStatusMeta {
  tone: BadgeTone;
  label: string;
  /** Spelled out for screen readers and the title attribute. */
  description: string;
}

const STATUS_META: Record<EmailCheck, EmailStatusMeta> = {
  valid: { tone: 'success', label: 'Verified', description: 'SMTP confirmed this mailbox exists' },
  risky: {
    tone: 'warning',
    label: 'Risky',
    description: 'The mail server would not confirm it; the app still sends to it',
  },
  invalid: { tone: 'danger', label: 'Invalid', description: 'The mail server rejected this address' },
  unknown: { tone: 'neutral', label: 'Unknown', description: 'The check finished without an answer' },
  pending: { tone: 'info', label: 'Checking', description: 'Verification is still queued' },
  unchecked: { tone: 'neutral', label: 'Not checked', description: 'This address was never verified' },
};

export function emailStatusMeta(status: EmailCheck): EmailStatusMeta {
  return STATUS_META[status] ?? STATUS_META.unchecked;
}

/** True when the app would send to this address (risky counts as sendable). */
export function isSendable(status: EmailCheck): boolean {
  return status === 'valid' || status === 'risky';
}

/**
 * The personal box plus one box per real company. No company is invented when
 * the lead has none: the card shows an explicit note instead.
 */
export function buildLeadBoxes(lead: LeadCardRecord): LeadBox[] {
  const map = buildVerificationMap(lead.verifiedEmails);
  const personalEmails = dedupeEmails([...(lead.discoveredEmails ?? []), lead.email]);
  const companies = lead.currentCompanies ?? [];

  const counts = new Map<string, number>();
  const countAll = [...personalEmails, ...companies.flatMap((c) => dedupeEmails(c.companyEmails ?? []))];
  for (const email of countAll) {
    const key = normalizeEmail(email);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const toRow = (email: string): EmailRow => ({
    email,
    status: resolveEmailStatus(email, map, {
      primaryEmail: lead.email,
      primaryStatus: lead.emailValidationStatus ?? null,
    }),
    shared: (counts.get(normalizeEmail(email)) ?? 0) > 1,
  });

  const boxes: LeadBox[] = [
    {
      key: 'personal',
      kind: 'personal',
      title: 'Personal profile',
      subtitle: realValue(lead.jobTitle),
      approved: lead.approved === true,
      emails: personalEmails.map(toRow),
    },
  ];

  companies.forEach((company, index) => {
    boxes.push({
      key: `company-${index}`,
      kind: 'company',
      title: realValue(company.companyName) ?? 'Company',
      subtitle: realValue(company.jobTitle),
      approved: company.approved === true,
      emails: dedupeEmails(company.companyEmails ?? []).map(toRow),
    });
  });

  return boxes;
}

const TRAILING_JUNK = /[.,;:!?)\]}'"<>]+$/;

/**
 * The lead's LinkedIn URL: the portfolio link, one of the extra URLs, or the
 * first one found in the pasted text. Trailing punctuation is trimmed, so a URL
 * that ended a sentence still opens.
 */
export function pickLinkedInUrl(lead: LeadCardRecord): string | null {
  const candidates = [
    lead.portfolioUrl,
    ...(lead.additionalUrls ?? []),
    lead.rawLinkedinUrl,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value || !/linkedin\.com/i.test(value)) continue;
    const cleaned = value.replace(TRAILING_JUNK, '');
    const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    try {
      const url = new URL(withProtocol);
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) continue;
      return url.toString();
    } catch {
      continue;
    }
  }
  return null;
}

/** A readable date, or null when the record has none or a broken one. */
export function formatLeadDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
