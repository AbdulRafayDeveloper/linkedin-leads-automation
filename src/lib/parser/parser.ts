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

function findSectionLines(lines: string[], startLabel: RegExp, stopLabels: RegExp[]): string[] {
  const startIndex = lines.findIndex((line) => startLabel.test(line));
  if (startIndex === -1) return [];

  const collected: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (stopLabels.some((stop) => stop.test(line))) break;
    if (line.trim().length > 0 && !/^https?:\/\//i.test(line.trim())) {
      collected.push(line.trim());
    }
  }
  return collected;
}

const SECTION_LABELS = [
  /^about$/i,
  /^experience$/i,
  /^education$/i,
  /^skills$/i,
  /^activity$/i,
  /^recent activity$/i,
  /^contact info$/i,
  /^contact information$/i,
];

function extractLinkedInUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:[\w-]+\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?/);
  return match ? match[0] : null;
}

function extractCompanyLinkedInUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:[\w-]+\.)?linkedin\.com\/company\/[A-Za-z0-9\-_%]+\/?/);
  return match ? match[0] : null;
}

function extractWebsite(text: string): string | null {
  const match = text.match(/https?:\/\/(?!(?:[\w-]+\.)?linkedin\.com)[^\s<>"')]+/i);
  return match ? match[0].replace(/[.,;]+$/, '') : null;
}

function extractEmail(text: string): string | null {
  const match = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match ? match[0] : null;
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

  // Full name: first non-empty line that isn't a URL and reasonably short
  const fullName =
    lines.find((line) => !/https?:\/\//.test(line) && line.length > 0 && line.length < 100) ||
    'UNCERTAIN';

  // Headline / current title: typically the line right after the name
  const nameIndex = lines.indexOf(fullName);
  const headline =
    nameIndex >= 0 && lines[nameIndex + 1] && !/https?:\/\//.test(lines[nameIndex + 1])
      ? cleanLine(lines[nameIndex + 1])
      : null;

  const linkedinProfileUrl = extractLinkedInUrl(cleanedFull);
  const currentCompanyLinkedInUrl = extractCompanyLinkedInUrl(cleanedFull);

  // Current title / company: look for "<Title> at <Company>" pattern anywhere
  let currentTitle: string | null = null;
  let currentCompany: string | null = null;
  const titleAtCompanyMatch = cleanedFull.match(
    /([A-Za-z0-9 ,&/'-]{2,80})\s+at\s+([A-Za-z0-9 ,&.'-]{2,80})/
  );
  if (titleAtCompanyMatch) {
    currentTitle = cleanLine(titleAtCompanyMatch[1]);
    currentCompany = cleanLine(titleAtCompanyMatch[2]).split(/[\n,|]/)[0].trim();
  } else if (headline && headline.includes(' at ')) {
    const [title, company] = headline.split(/\s+at\s+/);
    currentTitle = cleanLine(title);
    currentCompany = cleanLine(company);
  } else {
    currentTitle = headline;
    currentCompany = null;
  }

  if (!currentCompany) {
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

  const about = findSectionLines(lines, /^about$/i, SECTION_LABELS).join(' ') || null;
  const experience = findSectionLines(lines, /^experience$/i, SECTION_LABELS);
  const education = findSectionLines(lines, /^education$/i, SECTION_LABELS);
  const skills = findSectionLines(lines, /^skills$/i, SECTION_LABELS);
  const recentActivity = [
    ...findSectionLines(lines, /^activity$/i, SECTION_LABELS),
    ...findSectionLines(lines, /^recent activity$/i, SECTION_LABELS),
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
