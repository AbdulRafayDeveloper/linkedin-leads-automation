import type { CompanyResearchResult } from '@/lib/types/lead';

const FETCH_TIMEOUT_MS = 8000;

export interface FetchPage {
  (url: string): Promise<string | null>;
}

const defaultFetchPage: FetchPage = async (url: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadResearchBot/1.0)' },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

// Analytics/error-tracking scripts (Sentry, GTM, Wix, etc.) embed IDs shaped
// like "<hex>@<vendor-domain>" inside <script> tags. These match a plain
// email regex but are never real contact addresses, so they must be excluded.
const TRACKER_DOMAINS =
  /(^|\.)(wixpress\.com|sentry\.io|google-analytics\.com|googletagmanager\.com|doubleclick\.net|hotjar\.com|segment\.io|cloudflareinsights\.com)$/i;

function extractEmails(html: string): string[] {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const matches = withoutScripts.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  return Array.from(new Set(matches)).filter((email) => {
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) return false;
    const [localPart, domain] = email.split('@');
    if (TRACKER_DOMAINS.test(domain)) return false;
    if (/^[0-9a-f]{16,}$/i.test(localPart)) return false;
    return true;
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToOrigin(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return null;
  }
}

function guessDomainCandidates(companyName: string): string[] {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '');
  if (!slug) return [];
  return [`https://www.${slug}.com`, `https://${slug}.com`];
}

export async function researchCompany(
  companyName: string,
  providedWebsite: string | null,
  fetchPage: FetchPage = defaultFetchPage
): Promise<CompanyResearchResult> {
  const result: CompanyResearchResult = {
    companyName,
    officialWebsite: null,
    confidence: 'LOW',
    description: null,
    signals: [],
    discoveredEmails: [],
    sourceUrls: [],
  };

  if (!companyName || companyName === 'CURRENT_COMPANY_UNCERTAIN') {
    result.signals.push('Company name uncertain; skipped research');
    return result;
  }

  const candidates: string[] = [];
  if (providedWebsite) {
    const origin = normalizeToOrigin(providedWebsite);
    if (origin) candidates.push(origin);
  } else {
    candidates.push(...guessDomainCandidates(companyName));
  }

  for (const candidate of candidates) {
    const html = await fetchPage(candidate);
    if (!html) continue;

    const text = stripHtml(html);
    const normalizedCompany = companyName.toLowerCase();
    const nameAppears = text.toLowerCase().includes(normalizedCompany);

    result.officialWebsite = candidate;
    result.sourceUrls.push(candidate);
    result.discoveredEmails.push(...extractEmails(html));
    result.confidence = providedWebsite ? (nameAppears ? 'HIGH' : 'MEDIUM') : nameAppears ? 'MEDIUM' : 'LOW';
    if (nameAppears) {
      result.signals.push(`Company name "${companyName}" found on homepage`);
    }
    result.description = text.slice(0, 300) || null;

    for (const path of ['/about', '/contact', '/about-us', '/contact-us']) {
      const pageHtml = await fetchPage(`${candidate}${path}`);
      if (!pageHtml) continue;
      result.sourceUrls.push(`${candidate}${path}`);
      result.discoveredEmails.push(...extractEmails(pageHtml));
    }

    result.discoveredEmails = Array.from(new Set(result.discoveredEmails));
    break;
  }

  if (!result.officialWebsite) {
    result.signals.push('Could not verify an official website with confidence');
  }

  return result;
}
