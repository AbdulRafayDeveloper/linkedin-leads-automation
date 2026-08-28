import type { EmailType } from '@/lib/types/lead';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const TYPE_PATTERNS: Array<{ type: EmailType; pattern: RegExp }> = [
  { type: 'SALES', pattern: /^(sales|business|bd|partnerships?)$/i },
  { type: 'SUPPORT', pattern: /^(support|help|helpdesk|service)$/i },
  { type: 'HR', pattern: /^(hr|careers?|jobs|recruiting|recruitment|talent)$/i },
  { type: 'PRESS', pattern: /^(press|media|pr|communications)$/i },
  { type: 'LEGAL', pattern: /^(legal|privacy|compliance|dpo)$/i },
  {
    type: 'GENERAL',
    pattern: /^(info|hello|contact|admin|office|team|enquiries?|inquiries?|general)$/i,
  },
];

export function classifyEmailType(email: string): EmailType {
  const localPart = email.split('@')[0] || '';
  for (const { type, pattern } of TYPE_PATTERNS) {
    if (pattern.test(localPart)) return type;
  }
  return 'UNKNOWN';
}

export interface DedupableEmail {
  email: string;
}

/**
 * Deduplicates emails case-insensitively, keeping the first occurrence of
 * each address. Callers should order the input so the most authoritative
 * entry (e.g. the lead's own profile email) comes first.
 */
export function dedupeEmails<T extends DedupableEmail>(entries: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of entries) {
    const key = normalizeEmail(entry.email);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}
