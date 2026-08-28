import type { CrawledEmail } from '@/lib/types/lead';
import { classifyEmailType } from '@/lib/email/emailUtils';
import { isAllowedByRobots } from '@/lib/research/robots';
import { fetchRenderedHtml } from '@/lib/research/browserFetch';

const USER_AGENT = 'Mozilla/5.0 (compatible; LeadResearchBot/1.0; +https://example.com/bot)';

const PRIORITY_PATHS = [
  '/',
  
  // Contact / Communication
  '/contact',
  '/contact-us',
  '/contactus',
  '/get-in-touch',
  '/reach-us',
  '/connect',
  '/talk-to-us',
  '/speak-to-us',

  // Company / People
  '/about',
  '/about-us',
  '/company',
  '/team',
  '/our-team',
  '/leadership',
  '/management',
  '/founders',
  '/people',

  // Sales / Demo
  '/demo',
  '/request-demo',
  '/book-demo',
  '/schedule-demo',
  '/sales',
  '/request-quote',
  '/get-quote',

  // Support / Help
  '/support',
  '/help',
  '/help-center',
  '/customer-support',
  '/customer-service',
  '/contact-support',

  // Careers / Jobs
  '/careers',
  '/career',
  '/jobs',
  '/join-us',
  '/work-with-us',
  '/employment',

  // Press / Media
  '/press',
  '/media',
  '/news',
  '/newsroom',
  '/press-room',
  '/press-kit',
  '/media-kit',

  // Partnerships / Business
  '/partners',
  '/partnerships',
  '/business',
  '/sales-contact',
  '/vendors',
  '/suppliers',

  // Legal / Company Information
  '/privacy',
  '/privacy-policy',
  '/terms',
  '/terms-and-conditions',
  '/legal',

  // Other potentially useful pages
  '/locations',
  '/offices',
  '/faq',
  '/faqs',
];

const SKIP_EXTENSIONS =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|pdf|zip|mp4|mp3|woff2?|ttf|eot)$/i;

const TRACKER_DOMAINS =
  /(^|\.)(wixpress\.com|sentry\.io|google-analytics\.com|googletagmanager\.com|doubleclick\.net|hotjar\.com|segment\.io|cloudflareinsights\.com)$/i;

export interface FetchResult {
  html: string | null;
  status: number | null;
  finalUrl: string;
}

export interface FetchPageFn {
  (url: string): Promise<FetchResult>;
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  requestDelayMs?: number;
  timeoutMs?: number;
  fetchPage?: FetchPageFn;
  fetchRobotsTxt?: (origin: string) => Promise<string | null>;
  renderPage?: (url: string) => Promise<string | null>;
}

export interface CrawlFailure {
  url: string;
  reason: string;
}

export interface CrawlResult {
  crawledUrls: string[];
  emails: CrawledEmail[];
  failedUrls: CrawlFailure[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultFetchPage =
  (timeoutMs: number): FetchPageFn =>
  async (url: string): Promise<FetchResult> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) {
        return { html: null, status: response.status, finalUrl: response.url || url };
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('xml')) {
        return { html: null, status: response.status, finalUrl: response.url || url };
      }
      const html = await response.text();
      return { html, status: response.status, finalUrl: response.url || url };
    } catch (error) {
      throw error instanceof Error ? error : new Error('Unknown fetch error');
    } finally {
      clearTimeout(timeout);
    }
  };

const defaultFetchRobotsTxt = (fetchPage: FetchPageFn) => async (origin: string) => {
  try {
    const result = await fetchPage(`${origin}/robots.txt`);
    return result.html;
  } catch {
    return null;
  }
};

function normalizeForDedup(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    return `${parsed.origin}${pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function extractSitemapUrls(xml: string, origin: string): string[] {
  const matches = xml.match(/<loc>\s*([^<\s]+)\s*<\/loc>/gi) || [];
  return matches
    .map((m) => m.replace(/<\/?loc>/gi, '').trim())
    .filter((url) => {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    });
}

function extractLinks(html: string, pageUrl: string, origin: string): string[] {
  const hrefMatches = html.match(/href\s*=\s*["']([^"']+)["']/gi) || [];
  const links: string[] = [];
  for (const match of hrefMatches) {
    const hrefMatch = match.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) {
      continue;
    }
    try {
      const resolved = new URL(href, pageUrl);
      if (resolved.origin !== origin) continue;
      if (SKIP_EXTENSIONS.test(resolved.pathname)) continue;
      links.push(resolved.toString());
    } catch {
      continue;
    }
  }
  return links;
}

function extractEmailsFromPage(html: string, pageUrl: string): CrawledEmail[] {
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
  const results: CrawledEmail[] = [];
  for (const raw of candidates) {
    const email = raw.trim().toLowerCase();
    if (seen.has(email)) continue;
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(email)) continue;
    const domain = email.split('@')[1] || '';
    if (TRACKER_DOMAINS.test(domain)) continue;
    if (/^[0-9a-f]{16,}$/i.test(email.split('@')[0] || '')) continue;
    seen.add(email);
    results.push({ email, sourceUrl: pageUrl, emailType: classifyEmailType(email) });
  }
  return results;
}

/**
 * Crawls a company website for publicly listed email addresses. Performs a
 * breadth-first traversal starting from a fixed set of high-value paths
 * (contact, about, team, careers, etc.) plus any URLs discovered via
 * /sitemap.xml, respecting robots.txt, same-origin, page-count and depth
 * limits. A failure on any single page never aborts the crawl.
 */
export async function crawlWebsite(baseUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? 15;
  const maxDepth = options.maxDepth ?? 2;
  const requestDelayMs = options.requestDelayMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 8000;
  const fetchPage = options.fetchPage ?? defaultFetchPage(timeoutMs);
  const fetchRobotsTxt = options.fetchRobotsTxt ?? defaultFetchRobotsTxt(fetchPage);
  const renderPage = options.renderPage ?? fetchRenderedHtml;

  const origin = new URL(baseUrl).origin;
  const robotsTxt = await fetchRobotsTxt(origin);

  const initialPaths: string[] = [];
  for (const path of PRIORITY_PATHS) {
    initialPaths.push(path);
    if (path !== '/' && !path.endsWith('.xml') && !path.endsWith('.html')) {
      initialPaths.push(`${path}.html`);
    }
  }

  const queue: Array<{ url: string; depth: number }> = initialPaths.map((path) => ({
    url: `${origin}${path}`,
    depth: 0,
  }));

  try {
    const sitemapResult = await fetchPage(`${origin}/sitemap.xml`);
    if (sitemapResult.html) {
      for (const url of extractSitemapUrls(sitemapResult.html, origin)) {
        queue.push({ url, depth: 1 });
      }
    }
  } catch {
    // Sitemap is optional; ignore failures.
  }

  const visited = new Set<string>();
  const crawledUrls: string[] = [];
  const failedUrls: CrawlFailure[] = [];
  const allEmails: CrawledEmail[] = [];

  let pagesFetched = 0;
  let queueIndex = 0;

  while (queueIndex < queue.length && pagesFetched < maxPages) {
    const { url, depth } = queue[queueIndex];
    queueIndex += 1;

    const dedupKey = normalizeForDedup(url);
    if (visited.has(dedupKey)) continue;
    visited.add(dedupKey);

    const path = new URL(url).pathname || '/';
    if (!isAllowedByRobots(robotsTxt, path, USER_AGENT)) {
      failedUrls.push({ url, reason: 'disallowed_by_robots' });
      continue;
    }

    if (pagesFetched > 0 && requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }

    try {
      const result = await fetchPage(url);
      pagesFetched += 1;

      if (!result.html) {
        failedUrls.push({ url, reason: `status_${result.status ?? 'unknown'}` });
        continue;
      }

      crawledUrls.push(url);
      allEmails.push(...extractEmailsFromPage(result.html, url));

      if (depth < maxDepth) {
        for (const link of extractLinks(result.html, url, origin)) {
          if (!visited.has(normalizeForDedup(link))) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    } catch (error) {
      pagesFetched += 1;
      failedUrls.push({
        url,
        reason: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  // Some sites render contact info (mailto links, footer email text) purely
  // client-side, so a plain fetch of a JS-heavy homepage can come back
  // empty of emails even though a real browser would see them. As a last
  // resort, only when nothing was found any other way, render the homepage
  // in a real (headless) browser and re-extract from that.
  if (allEmails.length === 0 && isAllowedByRobots(robotsTxt, '/', USER_AGENT)) {
    const renderedHtml = await renderPage(origin);
    if (renderedHtml) {
      const renderedEmails = extractEmailsFromPage(renderedHtml, origin);
      if (renderedEmails.length > 0) {
        allEmails.push(...renderedEmails);
        if (!crawledUrls.some((u) => normalizeForDedup(u) === normalizeForDedup(origin))) {
          crawledUrls.push(origin);
        }
      }
    }
  }

  return { crawledUrls, emails: allEmails, failedUrls };
}
