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

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&rsquo;': '’',
    '&lsquo;': '‘',
    '&mdash;': '—',
    '&ndash;': '–',
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

function extractPhoneNumber(text: string): string | null {
  const phoneRegexes = [
    /\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
    /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    /\b0[123789]\d{1,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
  ];

  for (const regex of phoneRegexes) {
    const matches = text.match(regex) || [];
    for (const match of matches) {
      const cleaned = match.trim();
      if (/\d+\.\d{2,}/.test(cleaned)) continue;
      if (/\.\d+/.test(cleaned)) continue;
      if (/(\d{1,3}\s+){3,}/.test(cleaned)) continue;
      const digitsOnly = cleaned.replace(/\D/g, '');
      if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
        return cleaned;
      }
    }
  }
  return null;
}

function extractWebsite(text: string): string | null {
  const matches = text.match(/https?:\/\/(?!(?:[\w-]+\.)?linkedin\.com)[^\s<>"'()[\]]+/ig);
  if (!matches) return null;
  const excluded = /(bing\.com|google\.com|yahoo\.com|duckduckgo\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|wix\.com|vercel\.com|github\.com)/i;
  for (const match of matches) {
    const clean = match.replace(/[.,;:()[\]]+$/, '');
    if (!excluded.test(clean)) {
      return clean;
    }
  }
  return null;
}

export interface RegexExtractedData {
  fullName: string | null;
  email: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
}

export function extractWithRegex(rawText: string): RegexExtractedData {
  if (!rawText || !rawText.trim()) {
    return { fullName: null, email: null, phoneNumber: null, websiteUrl: null };
  }

  const cleanedFull = decodeHtmlEntities(stripHtmlTags(rawText));
  const lines = cleanedFull
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s*/, ''));

  const fullName = extractFullName(lines, cleanedFull);
  const email = extractEmail(cleanedFull);
  const phoneNumber = extractPhoneNumber(cleanedFull);
  const websiteUrl = extractWebsite(cleanedFull);

  return {
    fullName,
    email,
    phoneNumber,
    websiteUrl,
  };
}
