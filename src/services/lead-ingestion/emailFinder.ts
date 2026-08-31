const USER_AGENT = 'Mozilla/5.0 (compatible; LeadResearchBot/1.0; +https://example.com/bot)';
const FETCH_TIMEOUT_MS = 6000;

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

function normalizeUrl(url: string, origin: string): string | null {
  try {
    const resolved = new URL(url, origin);
    if (resolved.origin !== origin) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

async function fetchPageText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('xml')) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractEmails(html: string): string[] {
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

export async function findEmailsOnWebsite(websiteUrl: string): Promise<string[]> {
  const formattedUrl = /^https?:\/\//i.test(websiteUrl.trim())
    ? websiteUrl.trim()
    : `https://${websiteUrl.trim()}`;

  let origin: string;
  try {
    origin = new URL(formattedUrl).origin;
  } catch {
    return [];
  }

  const emails = new Set<string>();
  const visited = new Set<string>();

  // Fetch Homepage
  visited.add(origin + '/');
  const homepageHtml = await fetchPageText(origin);
  if (!homepageHtml) {
    return [];
  }

  // Extract from Homepage
  extractEmails(homepageHtml).forEach((email) => emails.add(email));

  // Extract Links and filter to high-value subpages
  const allLinks = extractLinks(homepageHtml, origin);
  const queue = allLinks.filter((link) => {
    try {
      const pathname = new URL(link).pathname.toLowerCase();
      return HIGH_VALUE_PATHS.some((path) => pathname.startsWith(path));
    } catch {
      return false;
    }
  });

  // Limit crawling to homepage + up to 4 high-value subpages
  const toCrawl = Array.from(new Set(queue)).slice(0, 4);

  await Promise.all(
    toCrawl.map(async (url) => {
      try {
        if (visited.has(url)) return;
        visited.add(url);
        const subpageHtml = await fetchPageText(url);
        if (subpageHtml) {
          extractEmails(subpageHtml).forEach((email) => emails.add(email));
        }
      } catch {
        // ignore individual subpage failures
      }
    })
  );

  return Array.from(emails);
}
