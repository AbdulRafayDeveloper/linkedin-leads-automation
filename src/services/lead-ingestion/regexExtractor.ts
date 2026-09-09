const NAV_CHROME_WORDS = new Set([
  'home',
  'accounts',
  'leads',
  'smart links',
  'messaging',
  'actions list',
  'referrals',
  'search',
  'lead filters',
  'account filters',
  'saved searches',
  'personas',
  'save',
  'message',
  'sales navigator lead page',
]);

/** Known social / platform / generic domains we should NOT treat as company websites */
const EXCLUDED_DOMAINS = new Set([
  'linkedin.com', 'bing.com', 'google.com', 'yahoo.com', 'duckduckgo.com',
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'youtube.com',
  'wix.com', 'vercel.com', 'github.com', 'upwork.com', 'fiverr.com',
  'behance.net', 'dribbble.com', 'medium.com', 'substack.com',
  'notion.so', 'calendly.com', 'linktree.com', 'loom.com',
]);

function isDomainExcluded(domain: string): boolean {
  const d = domain.toLowerCase();
  for (const ex of EXCLUDED_DOMAINS) {
    if (d === ex || d.endsWith(`.${ex}`)) return true;
  }
  return false;
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&rsquo;': '\u2019',
    '&lsquo;': '\u2018',
    '&mdash;': '\u2014',
    '&ndash;': '\u2013',
  };
  return text.replace(/&[a-zA-Z#0-9]+;/g, (match) => entities[match] ?? match);
}

function stripHtmlTags(text: string): string {
  const withLineBreaks = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');
  return withLineBreaks.replace(/<[^>]*>/g, ' ');
}

function extractFullName(lines: string[], cleanedFull: string): string | null {
  const basicInfoMatch = cleanedFull.match(/Basic lead information for ([^\n]+)/i);
  if (basicInfoMatch) return basicInfoMatch[1].trim();

  for (let i = 0; i < lines.length - 1; i++) {
    if (
      /^(1st|2nd|3rd)$/i.test(lines[i + 1]) &&
      lines[i].length > 0 &&
      lines[i].length < 100 &&
      !/https?:\/\//.test(lines[i])
    ) {
      return lines[i];
    }
  }

  const candidate = lines.find((line) => {
    const lower = line.toLowerCase().trim();
    return (
      !NAV_CHROME_WORDS.has(lower) &&
      !/https?:\/\//.test(line) &&
      !/^\d+$/.test(line) &&
      !/new notifications?$/i.test(line) &&
      line.length > 0 &&
      line.length < 100
    );
  });
  return candidate ? candidate : null;
}

function extractEmail(text: string): string | null {
  const match = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match ? match[0] : null;
}

/**
 * Extracts ALL url-like strings from the text:
 * 1. Fully qualified https?:// URLs
 * 2. Bare domain patterns like  mantiqsoft.com / mysite.io
 * 3. www.something.com patterns
 *
 * Returns a deduplicated, normalised array (all lowercased, no trailing punctuation).
 */
export function extractAllUrls(rawText: string): string[] {
  const text = decodeHtmlEntities(stripHtmlTags(rawText));
  const found = new Set<string>();

  // 1. Explicit https?:// URLs
  const explicitUrls = text.match(/https?:\/\/[^\s<>"'()\[\],;]+/gi) ?? [];
  for (const raw of explicitUrls) {
    const clean = raw.replace(/[.,;:)\]]+$/, '').toLowerCase();
    try {
      const host = new URL(clean).hostname.replace(/^www\./, '');
      if (!isDomainExcluded(host)) found.add(clean);
    } catch {
      // ignore malformed
    }
  }

  // 2. Bare domain patterns (e.g.  mantiqsoft.com  myportfolio.io)
  //    Must have a valid TLD and NOT be a social/platform domain.
  const bareDomains = text.match(
    /\b(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|io|co|net|org|dev|app|ai|tech|pk|uk|us|ca|au|de|fr|in|me|site|online|store|shop|info|biz|xyz|pro|agency))\b/gi
  ) ?? [];
  for (const raw of bareDomains) {
    const clean = raw.toLowerCase().replace(/^www\./, '');
    if (!isDomainExcluded(clean) && !clean.includes(' ')) {
      // Normalise to https://
      const url = `https://${clean}`;
      found.add(url);
    }
  }

  return Array.from(found);
}

function extractWebsite(text: string): string | null {
  const urls = extractAllUrls(text);
  return urls[0] ?? null;
}

function extractCompanyAndTitle(lines: string[], text: string): { companyName: string | null; jobTitle: string | null } {
  const atMatch = text.match(/(?:current\s*:?\s*)?([A-Za-z0-9\s,&-]+?)\s+at\s+([A-Za-z0-9\s,&.-]+?)(?:\r|\n|Present|\.|$)/i);
  if (atMatch && atMatch[1] && atMatch[2] && atMatch[2].length < 100) {
    return {
      jobTitle: atMatch[1].trim(),
      companyName: atMatch[2].trim(),
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(' at ') && !line.includes('http')) {
      const parts = line.split(/\s+at\s+/i);
      if (parts[0] && parts[1] && parts[1].length < 100) {
        return {
          jobTitle: parts[0].trim(),
          companyName: parts[1].split('•')[0].split('Present')[0].trim(),
        };
      }
    }
  }

  return { companyName: null, jobTitle: null };
}

export interface RegexExtractedData {
  fullName: string | null;
  email: string | null;
  websiteUrl: string | null;
  companyName: string | null;
  jobTitle: string | null;
  allUrls: string[];
}

export function extractWithRegex(rawText: string): RegexExtractedData {
  if (!rawText || !rawText.trim()) {
    return { fullName: null, email: null, websiteUrl: null, companyName: null, jobTitle: null, allUrls: [] };
  }

  const cleanedFull = decodeHtmlEntities(stripHtmlTags(rawText));
  const lines = cleanedFull
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s*/, ''));

  const fullName = extractFullName(lines, cleanedFull);
  const email = extractEmail(cleanedFull);
  const allUrls = extractAllUrls(rawText);
  const websiteUrl = allUrls[0] ?? null;
  const compTitle = extractCompanyAndTitle(lines, cleanedFull);

  return {
    fullName,
    email,
    websiteUrl,
    companyName: compTitle.companyName,
    jobTitle: compTitle.jobTitle,
    allUrls,
  };
}
