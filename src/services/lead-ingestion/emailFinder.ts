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
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('xml') &&
        !contentType.includes('javascript') &&
        !contentType.includes('text/plain')
      ) {
        continue;
      }
      const text = await response.text();
      if (text && text.trim().length > 20) {
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

  const mailtoMatches = html.match(/mailto:([^"'\s?>]+)/gi) || [];
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
    const userPart = email.split('@')[0] || '';
    const domain = email.split('@')[1] || '';
    if (TRACKER_DOMAINS.test(domain)) continue;
    if (domain === 'company.com' || domain === 'domain.com' || domain === 'example.com') continue;
    if (userPart === 'name' || userPart === 'yourname' || userPart === 'email' || userPart === 'username') continue;
    if (/^[0-9a-f]{16,}$/i.test(userPart)) continue;
    seen.add(email);
    results.push(email);
  }
  return results;
}

export function extractPhoneNumbers(html: string): string[] {
  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/\bd=["'][^"']*["']/gi, ' ')
    .replace(/\bviewBox=["'][^"']*["']/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  const telMatches = html.match(/tel:([^"'\s?>]+)/gi) || [];

  const phoneRegexes = [
    /\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
    /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    /\b0[123789]\d{1,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
  ];

  const matches: string[] = [];
  for (const regex of phoneRegexes) {
    const found = cleanHtml.match(regex) || [];
    matches.push(...found);
  }

  const candidates = [
    ...telMatches.map((m) => m.replace(/^tel:/i, '')),
    ...matches,
  ];

  const seen = new Set<string>();
  const results: string[] = [];
  for (const raw of candidates) {
    const trimmed = raw.trim();

    // Reject floats/decimals (e.g. 58.7519519, 189.192525, 254.1469)
    if (/\d+\.\d{2,}/.test(trimmed)) continue;
    if (/\.\d+/.test(trimmed)) continue;
    // Reject space-separated coordinate sequences (e.g. 0 0 103 24)
    if (/(\d{1,3}\s+){3,}/.test(trimmed)) continue;

    const digitsOnly = trimmed.replace(/[^\d+]/g, '');
    if (/^(19|20)\d{2}$/.test(digitsOnly)) continue;

    const plainDigits = digitsOnly.replace(/^\+/, '');
    if (plainDigits.length < 10 || plainDigits.length > 15) continue;

    if (!seen.has(digitsOnly)) {
      seen.add(digitsOnly);
      results.push(trimmed);
    }
  }

  return results;
}

function extractScriptUrls(html: string, origin: string): string[] {
  const scriptMatches = html.match(/src=["']([^"']+\.js[^"']*)["']/gi) || [];
  const scripts = new Set<string>();
  for (const match of scriptMatches) {
    const srcMatch = match.match(/src=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1].trim();
    const normalized = normalizeUrl(src, origin);
    if (normalized) {
      scripts.add(normalized);
    }
  }
  return Array.from(scripts);
}

export interface NavFooterLink {
  href: string;
  text: string;
}

export function extractNavAndFooterLinksWithText(html: string, origin: string): NavFooterLink[] {
  const results: NavFooterLink[] = [];
  const seen = new Set<string>();

  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const rawHref = match[1].trim();
    const rawText = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!rawHref || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('#')) {
      continue;
    }

    const normalized = normalizeUrl(rawHref, origin);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      results.push({
        href: normalized,
        text: rawText || 'Link',
      });
    }
  }

  const jsRouteRegex = /(?:to|path|href)\s*:\s*["'](\/[a-zA-Z0-9_/-]+)["']/g;
  while ((match = jsRouteRegex.exec(html)) !== null) {
    const routePath = match[1].trim();
    if (routePath === '/' || routePath.startsWith('//')) continue;
    const normalized = normalizeUrl(routePath, origin);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      results.push({
        href: normalized,
        text: routePath.replace(/^\//, '').replace(/-/g, ' '),
      });
    }
  }

  return results;
}

export async function findContactPagesWithAi(
  websiteUrl: string,
  links: NavFooterLink[]
): Promise<string[]> {
  if (links.length === 0) return [];

  try {
    const linksSummary = links
      .slice(0, 50)
      .map((l) => `- Text/Route: "${l.text}" | URL: ${l.href}`)
      .join('\n');

    const models = await getFallbackChatModels();
    const prompt = `You are an expert AI web crawler analyzing navigation bar, footer, and router links extracted from a company website:

Website: ${websiteUrl}

Discovered Nav/Footer Routes & Links:
${linksSummary}

Task: Identify up to 3 URLs that represent Contact Us, Reach Us, About Us, Careers, or Leadership/Team pages where company contact emails & phone numbers are published.

Return ONLY a valid JSON array of string URLs, e.g. ["https://example.com/contact", "https://example.com/about"]. Do not include markdown formatting or backticks.`;

    for (const model of models) {
      try {
        const response = await model.invoke(prompt);
        const text = typeof response === 'string' ? response : JSON.stringify(response);
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as string[];
          if (Array.isArray(parsed)) {
            return parsed.filter((u) => typeof u === 'string' && u.startsWith('http'));
          }
        }
      } catch {
        // try next model
      }
    }
  } catch {
    // fallback
  }

  return [];
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
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 4500);

    const models = await getFallbackChatModels();
    const prompt = `Extract all contact email addresses and phone numbers (including UK numbers starting with +44 or 0, US numbers, and international numbers) from the website text below.

Return ONLY a JSON object:
{"emails": ["e1@example.com"], "phones": ["+44 20 7946 0912", "+1 555-123-4567"]}

Website Text:
${textSnippet}`;

    for (const model of models) {
      try {
        const response = await model.invoke(prompt);
        const text = typeof response === 'string' ? response : JSON.stringify(response);
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as { emails?: string[]; phones?: string[] };
          return {
            emails: Array.isArray(parsed.emails) ? parsed.emails.map((e) => String(e).trim().toLowerCase()) : [],
            phones: Array.isArray(parsed.phones) ? parsed.phones.map((p) => String(p).trim()) : [],
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

  let rawPagesHtml = '';

  const homepageHtml = await fetchPageText(formattedUrl);
  if (homepageHtml) {
    visited.add(origin + '/');
    rawPagesHtml += `\n${homepageHtml}`;

    extractEmails(homepageHtml).forEach((e) => emails.add(e));
    extractPhoneNumbers(homepageHtml).forEach((p) => phones.add(p));

    siteType = await classifyWebsiteWithAi(formattedUrl, homepageHtml);

    // 1. Crawl Client-side JS script bundles
    const scriptUrls = extractScriptUrls(homepageHtml, origin);
    let allScriptContent = '';

    await Promise.all(
      scriptUrls.slice(0, 3).map(async (scriptUrl) => {
        try {
          if (visited.has(scriptUrl)) return;
          visited.add(scriptUrl);
          const jsContent = await fetchPageText(scriptUrl);
          if (jsContent) {
            allScriptContent += `\n${jsContent}`;
            extractEmails(jsContent).forEach((e) => emails.add(e));
            extractPhoneNumbers(jsContent).forEach((p) => phones.add(p));
          }
        } catch {
          // ignore
        }
      })
    );

    // 2. Extract Nav & Footer links/routes
    const htmlNavLinks = extractNavAndFooterLinksWithText(homepageHtml, origin);
    const jsNavLinks = extractNavAndFooterLinksWithText(allScriptContent, origin);
    const combinedNavLinks = [...htmlNavLinks, ...jsNavLinks];

    // 3. AI Contact Subpage Path Discoverer
    const aiDiscoveredContactUrls = await findContactPagesWithAi(formattedUrl, combinedNavLinks);
    const defaultContactUrls = HIGH_VALUE_PATHS.map((path) => `${origin}${path}`);

    const toCrawl = Array.from(
      new Set([...aiDiscoveredContactUrls, ...defaultContactUrls, ...additionalUrls])
    ).slice(0, 8);

    await Promise.all(
      toCrawl.map(async (url) => {
        try {
          if (visited.has(url)) return;
          visited.add(url);
          const subHtml = await fetchPageText(url);
          if (subHtml) {
            rawPagesHtml += `\n${subHtml}`;
            extractEmails(subHtml).forEach((e) => emails.add(e));
            extractPhoneNumbers(subHtml).forEach((p) => phones.add(p));

            const subScripts = extractScriptUrls(subHtml, origin);
            for (const sUrl of subScripts.slice(0, 2)) {
              if (visited.has(sUrl)) continue;
              visited.add(sUrl);
              const js = await fetchPageText(sUrl);
              if (js) {
                extractEmails(js).forEach((e) => emails.add(e));
                extractPhoneNumbers(js).forEach((p) => phones.add(p));
              }
            }
          }
        } catch {
          // ignore
        }
      })
    );

    // 4. AI Fallback Extractor: If regex missed phone numbers, pass page HTML text to Gemini AI!
    if (phones.size === 0 || emails.size === 0) {
      const aiResult = await parseContactsWithAi(rawPagesHtml || homepageHtml);
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
