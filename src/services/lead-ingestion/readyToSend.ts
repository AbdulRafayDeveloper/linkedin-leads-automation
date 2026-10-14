/**
 * "Ready to send" rules shared by the Ready to Send page and the leads list
 * API (`readyToSend=true`), so the page and the server agree on which drafts
 * can be queued.
 *
 * A draft (the personal box or one company box of a lead) is ready when it is
 * approved, has a subject and a body, and is not in a campaign. "In a
 * campaign" follows the same rule the campaign API uses to refuse duplicates
 * (`findAlreadyQueued` in campaignService.ts): the box's `inCampaign` flag, or
 * a send status written by a campaign. A failed send is retried from the
 * campaign page, not re-queued here; deleting the campaign releases the draft.
 */

export type SendStatus = 'pending' | 'sending' | 'delivered' | 'opened' | 'failed' | 'in_progress';

/** Send statuses only a campaign writes. Any of them means the box belongs to a campaign. */
export const CAMPAIGN_SEND_STATUSES: readonly SendStatus[] = ['pending', 'sending', 'delivered', 'opened', 'failed'];

export interface DraftBox {
  approved?: boolean | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  inCampaign?: boolean | null;
  campaignSendStatus?: SendStatus | string | null;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when the box is queued in, or was sent by, a campaign. */
export function isDraftQueued(box: DraftBox): boolean {
  if (box.inCampaign === true) return true;
  const status = box.campaignSendStatus ?? null;
  return Boolean(status) && (CAMPAIGN_SEND_STATUSES as readonly string[]).includes(status as string);
}

export function isDraftReady(box: DraftBox): boolean {
  return box.approved === true && hasText(box.emailSubject) && hasText(box.emailBody) && !isDraftQueued(box);
}

/**
 * Mongo filter matching leads that have at least one ready draft. Mirrors
 * `isDraftReady`; keep the two in sync.
 */
export function readyToSendQuery(): Record<string, unknown> {
  const text = { $nin: [null, ''] };
  const notQueued = {
    inCampaign: { $ne: true },
    campaignSendStatus: { $nin: [...CAMPAIGN_SEND_STATUSES] },
  };
  return {
    $or: [
      { approved: true, emailSubject: text, emailBody: text, ...notQueued },
      {
        currentCompanies: {
          $elemMatch: { approved: true, emailSubject: text, emailBody: text, ...notQueued },
        },
      },
    ],
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function isValidEmailSyntax(value: string): boolean {
  return EMAIL_RE.test(value);
}

export interface LeadLikeForEmails {
  email?: string | null;
  discoveredEmails?: string[] | null;
  verifiedEmails?: Array<{ email: string; status: string }> | null;
  emailValidationStatus?: string | null;
  currentCompanies?: Array<{ companyEmails?: string[] | null }> | null;
}

/**
 * Addresses a draft may be sent to, lowercased and deduplicated, best first.
 * `companyIndex` -1 is the personal draft, otherwise a company box.
 */
export function draftEmailCandidates(lead: LeadLikeForEmails, companyIndex: number): string[] {
  const raw =
    companyIndex === -1
      ? [lead.email ?? '', ...(lead.discoveredEmails ?? [])]
      : [...(lead.currentCompanies?.[companyIndex]?.companyEmails ?? [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const email = normalizeEmail(value);
    if (!email || !isValidEmailSyntax(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export type VerificationStatus = 'pending' | 'valid' | 'invalid' | 'risky' | 'unknown';

/** Verification status of one address, matched case-insensitively. */
export function verificationStatusFor(lead: LeadLikeForEmails, email: string): VerificationStatus {
  const target = normalizeEmail(email);
  if (!target) return 'pending';
  const hit = (lead.verifiedEmails ?? []).find((v) => normalizeEmail(v.email) === target);
  if (hit) return (hit.status as VerificationStatus) || 'pending';
  if (normalizeEmail(lead.email) === target && lead.emailValidationStatus) {
    return lead.emailValidationStatus as VerificationStatus;
  }
  return 'pending';
}

export const DELAY_MIN_SECONDS = 5;
export const DELAY_MAX_SECONDS = 3600;
export const DEFAULT_MIN_DELAY_SECONDS = 60;
export const DEFAULT_MAX_DELAY_SECONDS = 600;

/**
 * Strict validation of the anti-spam delay pair for the form: whole seconds
 * within the allowed range, minimum not above maximum. (The API clamps
 * instead of rejecting; the form tells the user what is wrong.)
 */
export function parseDelayRange(
  min: unknown,
  max: unknown
): { ok: true; min: number; max: number } | { ok: false; error: string } {
  const toInt = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isInteger(value) ? value : null;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
    return null;
  };
  const minInt = toInt(min);
  const maxInt = toInt(max);
  if (minInt === null || maxInt === null) {
    return { ok: false, error: 'Delays must be whole numbers of seconds.' };
  }
  if (minInt < DELAY_MIN_SECONDS || maxInt > DELAY_MAX_SECONDS || maxInt < DELAY_MIN_SECONDS || minInt > DELAY_MAX_SECONDS) {
    return {
      ok: false,
      error: `Delays must be between ${DELAY_MIN_SECONDS} and ${DELAY_MAX_SECONDS} seconds.`,
    };
  }
  if (minInt > maxInt) {
    return { ok: false, error: 'Minimum delay cannot be greater than maximum delay.' };
  }
  return { ok: true, min: minInt, max: maxInt };
}
