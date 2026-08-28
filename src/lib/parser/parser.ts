import type { ParsedLead } from '@/lib/types/lead';

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

function cleanLine(line: string): string {
  return decodeHtmlEntities(stripHtmlTags(line))
    .replace(/\s+/g, ' ')
    .trim();
}

// Lines that only ever describe Sales Navigator chrome/UI, never lead content.
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

// Headers that start a real content section, keyed by field. Some fields have
// multiple valid header spellings depending on how Sales Navigator renders them.
const SECTION_START_LABELS: Record<string, RegExp[]> = {
  about: [/^about$/i],
  experience: [/^experience$/i, /['’]s experience$/i],
  education: [/^education$/i],
  skills: [/^skills$/i, /^featured skills and endorsements$/i],
  activity: [/^activity$/i],
  recentActivity: [/^recent activity$/i, /^recent activity on linkedin$/i],
};

// Any of these ends a section, whichever field started it. Sales Navigator
// pages repeat "About / Relationship / Experience" as a tab strip before the
// real section headers, so section content must stop at ANY of these labels,
// not just the labels for the field currently being collected.
const SECTION_STOP_LABELS: RegExp[] = [
  /^about$/i,
  /^experience$/i,
  /^education$/i,
  /^skills$/i,
  /^activity$/i,
  /^recent activity$/i,
  /^contact info(rmation)?$/i,
  /^interests$/i,
  /^featured skills and endorsements$/i,
  /^show all (skills|interests)$/i,
  /^see all interests$/i,
  /^lead actions panel$/i,
  /^lists?\s*\(\d+\)$/i,
  /^notes\s*\(\d+\)$/i,
  /^timeline$/i,
  /^relationship$/i,
  /^get insights about/i,
  /^generate lead iq$/i,
  /^search leads$/i,
  /^current roles?$/i,
  /^lead iq\s*new$/i,
  /^\d+ notifications? total$/i,
  /^chat with us$/i,
  /^volunteering$/i,
  /^languages$/i,
  /^show all positions$/i,
  /^what you share in common$/i,
  /^shared groups$/i,
  /^get introduced$/i,
  /^filter by connection type$/i,
  /^view all shared connections$/i,
  /^view job descriptions$/i,
];

function collectSectionContent(lines: string[], startIndex: number): string[] {
  const collected: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (SECTION_STOP_LABELS.some((stop) => stop.test(line))) break;
    if (
      line.trim().length > 0 &&
      !/^https?:\/\//i.test(line.trim()) &&
      !/^\d+\s+endorsements?$/i.test(line.trim())
    ) {
      collected.push(line.trim());
    }
  }
  return collected;
}

// Sales Navigator pages often repeat a section's label as a tab-bar item
// (with little or no content after it) before the real section header. Trying
// every occurrence and keeping the longest result reliably finds the real one.
function findBestSectionLines(lines: string[], startLabels: RegExp[]): string[] {
  let best: string[] = [];
  lines.forEach((line, index) => {
    if (!startLabels.some((label) => label.test(line))) return;
    const candidate = collectSectionContent(lines, index);
    if (candidate.join(' ').length > best.join(' ').length) {
      best = candidate;
    }
  });
  return best;
}

function extractLinkedInUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:[\w-]+\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?/);
  return match ? match[0] : null;
}

function extractCompanyLinkedInUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:[\w-]+\.)?linkedin\.com\/company\/[A-Za-z0-9\-_%]+\/?/);
  return match ? match[0] : null;
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

function extractEmail(text: string): string | null {
  const match = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match ? match[0] : null;
}

function extractFullName(lines: string[], cleanedFull: string): string {
  // Sales Navigator copy tools often print "Basic lead information for X".
  const basicInfoMatch = cleanedFull.match(/Basic lead information for ([^\n]+)/i);
  if (basicInfoMatch) return basicInfoMatch[1].trim();

  // A name line is reliably followed by a connection-degree line (1st/2nd/3rd).
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

  // Fall back to the first line that isn't Sales Navigator navigation chrome.
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
  return candidate ? candidate : 'UNCERTAIN';
}

function parseTitleAndCompany(line: string): { title: string; company: string } | null {
  const parts = line.split(/\s+at\s+/i);
  if (parts.length >= 2) {
    const title = parts[0].trim();
    let companyRaw = parts.slice(1).join(' at ').trim();
    // Clean markdown link: [Celux](url) -> Celux
    companyRaw = companyRaw.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    const company = companyRaw.replace(/^[\[\]()]+|[\[\]()]+$/g, '').trim();
    if (title.length > 0 && company.length > 0 && !title.toLowerCase().includes('worked')) {
      return { title, company };
    }
  }
  return null;
}

export function parseLeadContent(rawContent: string): ParsedLead {
  if (!rawContent || !rawContent.trim()) {
    throw new Error('Cannot parse empty content');
  }

  const cleanedFull = decodeHtmlEntities(stripHtmlTags(rawContent));
  const lines = cleanedFull
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // Drop markdown heading markers and bullet markers, keep text
    .map((l) => l.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s*/, ''));

  const fullName = extractFullName(lines, cleanedFull);

  const linkedinProfileUrl = extractLinkedInUrl(cleanedFull);
  const currentCompanyLinkedInUrl = extractCompanyLinkedInUrl(cleanedFull);

  let currentTitle: string | null = null;
  let currentCompany: string | null = null;
  let headline: string | null = null;

  // 1. Try finding by Current roles/role section label first
  const currentRoleLabelIndex = lines.findIndex((l) => /^(current\s+roles?|current\s+position|experience)$/i.test(l));
  if (currentRoleLabelIndex >= 0 && lines[currentRoleLabelIndex + 1]) {
    const parsed = parseTitleAndCompany(lines[currentRoleLabelIndex + 1]);
    if (parsed) {
      currentTitle = parsed.title;
      currentCompany = parsed.company;
      headline = lines[currentRoleLabelIndex + 1];
    }
  }

  // 2. Fallback: search top lines for "<Title> at <Company>" pattern
  if (!currentCompany) {
    for (const line of lines.slice(0, 35)) {
      const parsed = parseTitleAndCompany(line);
      if (parsed) {
        currentTitle = parsed.title;
        currentCompany = parsed.company;
        headline = line;
        break;
      }
    }
  }

  // 3. Fallback: line after name
  if (!currentCompany) {
    const nameIndex = lines.indexOf(fullName);
    headline =
      nameIndex >= 0 && lines[nameIndex + 1] && !/https?:\/\//.test(lines[nameIndex + 1])
        ? cleanLine(lines[nameIndex + 1])
        : null;
    currentTitle = headline;
    currentCompany = 'CURRENT_COMPANY_UNCERTAIN';
  }

  // Location: line matching "City, State" or "City, Country" pattern near top
  const locationLine = lines.find((line) =>
    /^[A-Za-z .'-]+,\s?[A-Za-z .'-]+(,\s?[A-Za-z .'-]+)?$/.test(line) &&
    line !== fullName &&
    line !== headline &&
    !/https?:\/\//.test(line)
  );
  const location = locationLine ? cleanLine(locationLine) : null;

  const websiteInText = extractWebsite(cleanedFull);
  const currentCompanyWebsite = websiteInText;

  const about = findBestSectionLines(lines, SECTION_START_LABELS.about).join(' ') || null;
  const experience = findBestSectionLines(lines, SECTION_START_LABELS.experience);
  const education = findBestSectionLines(lines, SECTION_START_LABELS.education);
  const skills = findBestSectionLines(lines, SECTION_START_LABELS.skills);
  const recentActivity = [
    ...findBestSectionLines(lines, SECTION_START_LABELS.activity),
    ...findBestSectionLines(lines, SECTION_START_LABELS.recentActivity),
  ];

  const publicEmail = extractEmail(cleanedFull);

  return {
    fullName: cleanLine(fullName),
    linkedinProfileUrl,
    headline,
    currentTitle,
    currentCompany,
    currentCompanyLinkedInUrl,
    currentCompanyWebsite,
    currentCompanyLocation: null,
    location,
    currentRoleStartDate: null,
    about,
    experience,
    education,
    skills,
    recentActivity,
    publicEmail,
    sourceText: rawContent,
  };
}
