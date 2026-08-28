import dns from 'node:dns';
import validator from 'validator';
import type { EmailValidationResult } from '@/lib/types/lead';

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
