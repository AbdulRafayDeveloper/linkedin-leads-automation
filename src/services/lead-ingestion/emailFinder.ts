import { getFallbackChatModels } from '@/lib/ai/provider';
import type { SiteType } from '@/lib/db/models/LeadIngestion';
import type { CompanyPosition } from './aiExtractor';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 7000;

const TRACKER_DOMAINS =
  /(^|\.)(wixpress\.com|sentry\.io|google-analytics\.com|googletagmanager\.com|doubleclick\.net|hotjar\.com|segment\.io|cloudflareinsights\.com)$/i;

const HIGH_VALUE_PATHS = [
  '/contact',
  '/contact-us',
  '/contactus',
  '/about',
  '/about-us',
  '/team',
  '/our-team',
  '/connect',
  '/support',
];

export interface WebCrawlResult {
  emails: string[];
  phones: string[];
  siteType: SiteType;
}

function normalizeUrl(url: string, origin: string): string | null {
  try {
    const resolved = new URL(url, origin);
    if (resolved.origin !== origin) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

async function fetchPageText(targetUrl: string): Promise<string | null> {
  const urlsToTry = [targetUrl];

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    urlsToTry.unshift(`https://${targetUrl}`);
    urlsToTry.push(`http://${targetUrl}`);
  } else if (targetUrl.startsWith('https://')) {
    urlsToTry.push(targetUrl.replace('https://', 'http://'));
  }

  for (const url of urlsToTry) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('xml')) {
        continue;
      }
      const text = await response.text();
      if (text && text.trim().length > 50) {
        return text;
      }
    } catch {
      // try next protocol
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

export function extractEmails(html: string): string[] {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const mailtoMatches = withoutScripts.match(/mailto:([^"'\s?>]+)/gi) || [];
  const textMatches = withoutScripts.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];

  const candidates = [
    ...mailtoMatches.map((m) => m.replace(/^mailto:/i, '')),
    ...textMatches,
  ];

  const seen = new Set<string>();
  const results: string[] = [];
  for (const raw of candidates) {
    const email = raw.trim().toLowerCase();
    if (seen.has(email)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|ico|css|js)$/i.test(email)) continue;
    const domain = email.split('@')[1] || '';
    if (TRACKER_DOMAINS.test(domain)) continue;
    if (/^[0-9a-f]{16,}$/i.test(email.split('@')[0] || '')) continue;
    seen.add(email);
    results.push(email);
  }
  return results;
}

export function extractPhoneNumbers(html: string): string[] {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const telMatches = withoutScripts.match(/tel:([^"'\s?>]+)/gi) || [];
  const phoneMatches =
    withoutScripts.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g) || [];

  const candidates = [
    ...telMatches.map((m) => m.replace(/^tel:/i, '')),
    ...phoneMatches,
  ];

  const seen = new Set<string>();
  const results: string[] = [];
  for (const raw of candidates) {
    const cleaned = raw.replace(/[^\d+]/g, '');
    if (cleaned.length >= 7 && cleaned.length <= 15 && !seen.has(cleaned)) {
      seen.add(cleaned);
      results.push(raw.trim());
    }
  }
  return results;
}

function extractLinks(html: string, origin: string): string[] {
  const hrefMatches = html.match(/href\s*=\s*["']([^"']+)["']/gi) || [];
  const links = new Set<string>();
  for (const match of hrefMatches) {
    const hrefMatch = match.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) {
      continue;
    }
    const normalized = normalizeUrl(href, origin);
    if (normalized) {
      links.add(normalized);
    }
  }
  return Array.from(links);
}

export async function mapDomainsToCompanies(
  companies: CompanyPosition[],
  rawUrls: string[]
): Promise<{ mappedCompanies: CompanyPosition[]; portfolioUrl: string | null }> {
  let portfolioUrl: string | null = null;

  const mapped = companies.map((c) => ({ ...c }));

  for (const url of rawUrls) {
    const cleanUrl = url.trim().toLowerCase();
    try {
      const hostname = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`).hostname;

      if (/(github\.io|vercel\.app|netlify\.app|me|bio|portfolio)/i.test(hostname)) {
        portfolioUrl = cleanUrl;
        continue;
      }

      // Check if domain matches company name or initials
      for (const comp of mapped) {
        if (comp.websiteUrl) continue;
        const words = comp.companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const initials = comp.companyName
          .toLowerCase()
          .split(/\s+/)
          .map((w) => w[0])
          .join('');

        if (hostname.includes(words) || (initials.length >= 3 && hostname.includes(initials))) {
          comp.websiteUrl = cleanUrl;
          break;
        }
      }
    } catch {
      // ignore
    }
  }

  // Fallback: If company 1 still has no URL, assign first non-portfolio url
  if (mapped.length > 0 && !mapped[0].websiteUrl && rawUrls.length > 0) {
    mapped[0].websiteUrl = rawUrls[0];
  }

  return { mappedCompanies: mapped, portfolioUrl };
}

export async function classifyWebsiteWithAi(
  websiteUrl: string,
  htmlContent: string
): Promise<SiteType> {
  try {
    const snippet = htmlContent
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 3000);

    const models = await getFallbackChatModels();
    const prompt = `Analyze the website URL and homepage content below. Is this an official business/corporate/company website, or a personal developer/designer portfolio/blog page?

Return ONLY a JSON object: {"siteType": "company_website"} OR {"siteType": "personal_portfolio"}.

URL: ${websiteUrl}
Content snippet:
${snippet}`;

    for (const model of models) {
      try {
        const response = await model.invoke(prompt);
        const text = typeof response === 'string' ? response : JSON.stringify(response);
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as { siteType?: string };
          if (parsed.siteType === 'personal_portfolio') return 'personal_portfolio';
          if (parsed.siteType === 'company_website') return 'company_website';
        }
      } catch {
        // try next model
      }
    }
  } catch {
    // fallback
  }

  if (/(github\.io|vercel\.app|netlify\.app|me|bio|portfolio|blog)/i.test(websiteUrl)) {
    return 'personal_portfolio';
  }
  return 'company_website';
}

async function parseContactsWithAi(htmlContent: string): Promise<{ emails: string[]; phones: string[] }> {
  try {
    const textSnippet = htmlContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 4000);

    const models = await getFallbackChatModels();
    const prompt = `Extract all email addresses and phone numbers from the following website text. Return ONLY a JSON object: {"emails": [], "phones": []}.\n\nWebsite text:\n${textSnippet}`;

    for (const model of models) {
      try {
        const response = await model.invoke(prompt);
        const text = typeof response === 'string' ? response : JSON.stringify(response);
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as { emails?: string[]; phones?: string[] };
          return {
            emails: Array.isArray(parsed.emails) ? parsed.emails : [],
            phones: Array.isArray(parsed.phones) ? parsed.phones : [],
          };
        }
      } catch {
        // try next model
      }
    }
  } catch {
    // fallback failed
  }
  return { emails: [], phones: [] };
}

export async function findEmailsOnWebsite(
  websiteUrl: string,
  additionalUrls: string[] = []
): Promise<WebCrawlResult> {
  const formattedUrl = /^https?:\/\//i.test(websiteUrl.trim())
    ? websiteUrl.trim()
    : `https://${websiteUrl.trim()}`;

  let origin: string;
  try {
    origin = new URL(formattedUrl).origin;
  } catch {
    return { emails: [], phones: [], siteType: 'unknown' };
  }

  const emails = new Set<string>();
  const phones = new Set<string>();
  const visited = new Set<string>();
  let siteType: SiteType = 'unknown';

  const homepageHtml = await fetchPageText(formattedUrl);
  if (homepageHtml) {
    visited.add(origin + '/');
    extractEmails(homepageHtml).forEach((e) => emails.add(e));
    extractPhoneNumbers(homepageHtml).forEach((p) => phones.add(p));

    siteType = await classifyWebsiteWithAi(formattedUrl, homepageHtml);

    const subLinks = extractLinks(homepageHtml, origin);
    const queue = subLinks.filter((link) => {
      try {
        const pathname = new URL(link).pathname.toLowerCase();
        return HIGH_VALUE_PATHS.some((path) => pathname.startsWith(path));
      } catch {
        return false;
      }
    });

    const toCrawl = Array.from(new Set([...queue, ...additionalUrls])).slice(0, 5);

    await Promise.all(
      toCrawl.map(async (url) => {
        try {
          if (visited.has(url)) return;
          visited.add(url);
          const subHtml = await fetchPageText(url);
          if (subHtml) {
            extractEmails(subHtml).forEach((e) => emails.add(e));
            extractPhoneNumbers(subHtml).forEach((p) => phones.add(p));
          }
        } catch {
          // ignore subpage errors
        }
      })
    );

    if (emails.size === 0 || phones.size === 0) {
      const aiResult = await parseContactsWithAi(homepageHtml);
      aiResult.emails.forEach((e) => emails.add(e.toLowerCase()));
      aiResult.phones.forEach((p) => phones.add(p));
    }
  }

  return {
    emails: Array.from(emails),
    phones: Array.from(phones),
    siteType,
  };
}
