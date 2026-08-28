import dns from 'node:dns';
import validator from 'validator';
import type { EmailEntryValidationStatus, EmailValidationResult, ValidationStatus } from '@/lib/types/lead';

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'guerrillamail.com',
  '10minutemail.com',
  'yopmail.com',
  'throwawaymail.com',
  'fakeinbox.com',
  'trashmail.com',
  'getnada.com',
  'sharklasers.com',
  'dispostable.com',
]);

const ROLE_LOCAL_PARTS = new Set([
  'info',
  'admin',
  'support',
  'sales',
  'contact',
  'hello',
  'help',
  'noreply',
  'no-reply',
  'office',
  'team',
  'careers',
  'jobs',
  'webmaster',
  'postmaster',
]);

export interface DnsResolver {
  resolveMx: (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;
}

const defaultResolver: DnsResolver = {
  resolveMx: (domain: string) =>
    new Promise((resolve, reject) => {
      dns.resolveMx(domain, (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    }),
};

export async function validateEmail(
  email: string | null,
  resolver: DnsResolver = defaultResolver
): Promise<EmailValidationResult> {
  if (!email) {
    return {
      status: 'NOT_FOUND',
      validationChecks: null,
      reasons: ['No email address was discovered for this lead'],
      confidence: 'LOW',
    };
  }

  const reasons: string[] = [];
  const syntax = validator.isEmail(email);
  if (!syntax) {
    return {
      status: 'FAIL',
      validationChecks: {
        syntax: false,
        domainResolves: false,
        mxRecordsFound: false,
        isDisposable: false,
        isRoleEmail: false,
      },
      reasons: ['Email does not match a valid RFC-compliant format'],
      confidence: 'LOW',
    };
  }

  const [localPart, domain] = email.split('@');
  const isDisposable = DISPOSABLE_DOMAINS.has(domain.toLowerCase());
  const isRoleEmail = ROLE_LOCAL_PARTS.has(localPart.toLowerCase());

  let mxRecordsFound = false;
  let domainResolves = false;
  try {
    const records = await resolver.resolveMx(domain);
    mxRecordsFound = records.length > 0;
    domainResolves = true;
  } catch {
    domainResolves = false;
    mxRecordsFound = false;
    reasons.push(`Could not resolve MX records for domain "${domain}"`);
  }

  if (isDisposable) reasons.push('Domain is a known disposable email provider');
  if (isRoleEmail) reasons.push('Address appears to be a role-based inbox rather than a person');
  if (!mxRecordsFound) reasons.push('Domain has no valid mail exchange (MX) records');

  const validationChecks = {
    syntax,
    domainResolves,
    mxRecordsFound,
    isDisposable,
    isRoleEmail,
  };

  if (!mxRecordsFound || isDisposable) {
    return { status: 'FAIL', validationChecks, reasons, confidence: 'LOW' };
  }

  if (isRoleEmail) {
    return { status: 'NEEDS_REVIEW', validationChecks, reasons, confidence: 'MEDIUM' };
  }

  reasons.push('Syntax valid, domain resolves, MX records found, not disposable or role-based');
  return { status: 'PASS', validationChecks, reasons, confidence: 'HIGH' };
}

const STATUS_TO_ENTRY_STATUS: Record<ValidationStatus, EmailEntryValidationStatus> = {
  PASS: 'valid',
  FAIL: 'invalid',
  NEEDS_REVIEW: 'risky',
  NOT_FOUND: 'unknown',
};

export function mapValidationStatusToEntryStatus(
  status: ValidationStatus
): EmailEntryValidationStatus {
  return STATUS_TO_ENTRY_STATUS[status];
}

export interface EmailEntryValidationResult {
  email: string;
  validationStatus: EmailEntryValidationStatus;
  validationDetails: string;
}

/**
 * Validates a single email for multi-email enrichment, reusing the same free
 * DNS/MX-based checks as the primary pipeline but mapped onto the
 * pending/valid/invalid/unknown/risky vocabulary used for stored EmailEntry
 * records. This is the application's configured validation provider; swap
 * the resolver (or this function) for a paid deliverability API if one is
 * ever configured.
 */
export async function validateEmailForEntry(
  email: string,
  resolver: DnsResolver = defaultResolver
): Promise<EmailEntryValidationResult> {
  const result = await validateEmail(email, resolver);
  return {
    email,
    validationStatus: STATUS_TO_ENTRY_STATUS[result.status],
    validationDetails: JSON.stringify({ checks: result.validationChecks, reasons: result.reasons }),
  };
}

const DEFAULT_VALIDATION_CONCURRENCY = 5;

/**
 * Validates many emails with bounded concurrency so a large crawl result
 * doesn't fire dozens of simultaneous DNS lookups at once.
 */
export async function validateEmailEntries(
  emails: string[],
  resolver: DnsResolver = defaultResolver,
  concurrency = DEFAULT_VALIDATION_CONCURRENCY
): Promise<EmailEntryValidationResult[]> {
  const results: EmailEntryValidationResult[] = new Array(emails.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < emails.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await validateEmailForEntry(emails[index], resolver);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, emails.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
