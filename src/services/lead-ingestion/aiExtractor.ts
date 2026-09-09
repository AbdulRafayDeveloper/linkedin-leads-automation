import { getFallbackChatModels } from '@/lib/ai/provider';
import { extractAllUrls } from './regexExtractor';

export interface CompanyPosition {
  companyName: string;
  jobTitle: string;
  workPeriod: string | null;
  websiteUrl: string | null;
  roleSummary: string;
}

export interface AiExtractedData {
  fullName: string | null;
  personSummary: string;
  currentCompanies: CompanyPosition[];
  rawUrls: string[];
  rawEmails: string[];
  rawPhones: string[];
}

function extractText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.content === 'string') return r.content;
    if (Array.isArray(r.content)) {
      return r.content
        .map((p) => (typeof p === 'string' ? p : (p as Record<string, unknown>).text ?? ''))
        .join('');
    }
  }
  return String(raw ?? '');
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'none' ? t : null;
}

function cleanJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return s;
}

/**
 * Calls the AI with the raw LinkedIn text and returns a structured JSON.
 * Tries each model in the fallback chain until one succeeds.
 */
export async function extractWithAi(rawText: string): Promise<AiExtractedData> {
  if (!rawText?.trim()) throw new Error('Empty input');

  // ── Step 0: Pre-extract URLs with regex (always reliable) ────────────────
  // These are injected into the AI prompt so the AI always has them as context,
  // and are merged with AI results afterwards for a guaranteed-complete list.
  const regexUrls = extractAllUrls(rawText);
  const regexUrlsBlock = regexUrls.length > 0
    ? `\n\nIMPORTANT — The following URLs were pre-extracted from the text via regex. You MUST include ALL of these in "rawUrls" and map them to the correct company or mark as portfolio:\n${regexUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}`
    : '';

  const prompt = `You are a LinkedIn profile parser. I will give you raw copied text from a LinkedIn Sales Navigator profile page.

Your task: extract a structured JSON object. Follow these rules EXACTLY.

### OUTPUT FORMAT (return ONLY this JSON, no other text):
{
  "fullName": "<full name of the person>",
  "personSummary": "<2-3 sentence professional overview of this person>",
  "currentCompanies": [
    {
      "companyName": "<exact company name>",
      "jobTitle": "<exact job title at this company>",
      "workPeriod": "<e.g. Apr 2025 - Present>",
      "websiteUrl": "<website URL for THIS specific company if mentioned in the text or pre-extracted URLs above, else null>",
      "roleSummary": "<1-2 sentence summary of what they do at this specific company>"
    }
  ],
  "rawUrls": ["<every URL found anywhere in the text — MUST include the pre-extracted URLs listed above>"],
  "rawEmails": ["<every email address found in the text>"],
  "rawPhones": ["<every phone/mobile/WhatsApp number found in the text — include country codes, spaces, dashes, parentheses exactly as written. Include ALL international formats: +1, +44, +92, +971, etc.>"]
}

### RULES:
1. "currentCompanies" must contain ONLY roles where the end date says "Present" — do NOT include past roles.
2. Include ALL current roles, even if there are 2 or 3.
3. For "websiteUrl" inside each company: check the pre-extracted URLs first; assign any URL whose domain matches the company name. Otherwise use null.
4. "rawUrls" = every URL found anywhere in the text (contact section, bio, etc.) PLUS all pre-extracted URLs.
5. "rawPhones" = extract ALL phone numbers regardless of country or format. Do not filter or validate them.
6. Return valid JSON only. No markdown fences, no explanation text.${regexUrlsBlock}

### RAW TEXT:
"""
${rawText}
"""`;


  const models = await getFallbackChatModels(0);
  const errors: string[] = [];

  for (const model of models) {
    try {
      const res = await model.invoke(prompt);
      const text = extractText(res);
      const json = cleanJson(text);
      if (!json) throw new Error('No JSON in response');

      const p = JSON.parse(json) as Record<string, unknown>;

      const fullName = str(p.fullName);
      const personSummary = str(p.personSummary) ?? 'Candidate profile extracted.';

      // Parse currentCompanies array from any variation key or single object
      const rawRawList =
        p.currentCompanies ??
        p.companies ??
        p.current_companies ??
        p.positions ??
        p.roles ??
        p.currentCompany ??
        p.company ??
        p.current_company;

      const rawList = Array.isArray(rawRawList)
        ? rawRawList
        : (rawRawList && typeof rawRawList === 'object' ? [rawRawList] : []);

      const currentCompanies: CompanyPosition[] = rawList
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
          companyName:
            str(
              item.companyName ??
                item.company ??
                item.company_name ??
                item.organization ??
                item.name ??
                item.title
            ) ?? 'Unknown Company',
          jobTitle:
            str(item.jobTitle ?? item.title ?? item.position ?? item.role) ??
            'Professional',
          workPeriod: str(item.workPeriod ?? item.period ?? item.duration ?? item.dates),
          websiteUrl: str(item.websiteUrl ?? item.url ?? item.website),
          roleSummary: str(item.roleSummary ?? item.summary ?? item.description) ?? '',
        }));

      // Fallback: if AI returned 0 companies in array but returned top-level fields or objects
      if (currentCompanies.length === 0) {
        const topCompObj =
          (typeof p.currentCompany === 'object' && p.currentCompany ? (p.currentCompany as Record<string, unknown>) : null) ??
          (typeof p.company === 'object' && p.company ? (p.company as Record<string, unknown>) : null);

        const extractedName =
          str(
            p.companyName ??
              p.company ??
              p.company_name ??
              p.organization ??
              (topCompObj ? topCompObj.companyName ?? topCompObj.company ?? topCompObj.name : null)
          ) ?? 'Unspecified Company';

        const extractedJob =
          str(
            p.jobTitle ??
              p.title ??
              p.position ??
              (topCompObj ? topCompObj.jobTitle ?? topCompObj.title ?? topCompObj.role : null)
          ) ?? 'Professional';

        currentCompanies.push({
          companyName: extractedName,
          jobTitle: extractedJob,
          workPeriod: str(p.workPeriod ?? (topCompObj ? topCompObj.workPeriod : null)),
          websiteUrl: str(p.websiteUrl ?? (topCompObj ? topCompObj.websiteUrl : null)),
          roleSummary: personSummary,
        });
      }

      const rawUrls = Array.isArray(p.rawUrls)
        ? (p.rawUrls.map(str).filter(Boolean) as string[])
        : [];
      const rawEmails = Array.isArray(p.rawEmails)
        ? (p.rawEmails.map(str).filter(Boolean) as string[])
        : [];
      const rawPhones = Array.isArray(p.rawPhones)
        ? (p.rawPhones.map(str).filter(Boolean) as string[])
        : [];

      // Merge AI rawUrls with regex pre-extracted URLs for guaranteed completeness
      const mergedUrls = Array.from(new Set([
        ...rawUrls,
        ...regexUrls,
      ]));

      return { fullName, personSummary, currentCompanies, rawUrls: mergedUrls, rawEmails, rawPhones };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Resilient Fallback: Use Regex Extractor if LLM calls fail so ingestion never breaks!
  const { extractWithRegex } = await import('./regexExtractor');
  const reg = extractWithRegex(rawText);

  return {
    fullName: reg.fullName ?? 'Extracted Candidate',
    personSummary: 'LinkedIn profile data extracted via regex fallback.',
    currentCompanies: [
      {
        companyName: reg.companyName ?? 'Extracted Company',
        jobTitle: reg.jobTitle ?? 'Professional',
        workPeriod: null,
        websiteUrl: reg.websiteUrl,
        roleSummary: '',
      },
    ],
    // Use full regex URL list in fallback
    rawUrls: reg.allUrls ?? (reg.websiteUrl ? [reg.websiteUrl] : []),
    rawEmails: reg.email ? [reg.email] : [],
    // Phone extraction is AI-only — regex cannot reliably handle all international formats
    rawPhones: [],
  };
}

/**
 * Given a list of URLs and company names, asks AI to map each URL to a company.
 * Returns the updated companies array with websiteUrl filled in, plus any leftover
 * URL that belongs to the candidate personally (portfolioUrl).
 */
export async function mapUrlsToCompaniesWithAi(
  companies: CompanyPosition[],
  rawUrls: string[]
): Promise<{ companies: CompanyPosition[]; portfolioUrl: string | null }> {
  if (rawUrls.length === 0) {
    return { companies, portfolioUrl: null };
  }

  const prompt = `You are a URL analyst. I have a list of company names and a list of URLs found on a person's LinkedIn profile.

Your task: figure out which URL belongs to which company, or if it's the person's personal portfolio/bio site.

### COMPANY NAMES:
${companies.map((c, i) => `${i + 1}. ${c.companyName}`).join('\n')}

### URLS FOUND:
${rawUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}

### OUTPUT FORMAT (return ONLY this JSON, no other text):
{
  "mappings": [
    { "url": "<exact url>", "type": "company", "companyName": "<exact company name from list above>" },
    { "url": "<exact url>", "type": "portfolio", "companyName": null }
  ]
}

Rules:
- "type" is either "company" (belongs to that business) or "portfolio" (personal site of the candidate).
- Match by domain keywords, acronyms, or brand names.
- If you cannot determine, default to "company" for the first company.
- Return valid JSON only.`;

  const models = await getFallbackChatModels(0);
  const updated = companies.map((c) => ({ ...c }));
  let portfolioUrl: string | null = null;

  for (const model of models) {
    try {
      const res = await model.invoke(prompt);
      const text = extractText(res);
      const json = cleanJson(text);
      const p = JSON.parse(json) as { mappings?: Array<{ url: string; type: string; companyName: string | null }> };

      for (const mapping of p.mappings ?? []) {
        const url = str(mapping.url);
        if (!url) continue;

        if (mapping.type === 'portfolio') {
          portfolioUrl = url;
        } else if (mapping.type === 'company' && mapping.companyName) {
          const mappedName = (mapping.companyName ?? '').toLowerCase().trim();
          // Exact match first, then partial/fuzzy match
          const comp =
            updated.find((c) => c.companyName.toLowerCase() === mappedName) ??
            updated.find(
              (c) =>
                c.companyName.toLowerCase().includes(mappedName) ||
                mappedName.includes(c.companyName.toLowerCase())
            );
          if (comp && !comp.websiteUrl) {
            comp.websiteUrl = url;
          }
        }
      }

      // Fallback: assign leftover URLs to companies that still have none
      for (const url of rawUrls) {
        const alreadyAssigned =
          portfolioUrl === url || updated.some((c) => c.websiteUrl === url);
        if (!alreadyAssigned) {
          const compWithoutUrl = updated.find((c) => !c.websiteUrl);
          if (compWithoutUrl) {
            compWithoutUrl.websiteUrl = url;
          }
        }
      }

      return { companies: updated, portfolioUrl };
    } catch {
      // try next model
    }
  }

  // Hard fallback: assign first URL to first company missing a website URL
  if (rawUrls.length > 0) {
    const compWithoutUrl = updated.find((c) => !c.websiteUrl) ?? updated[0];
    if (compWithoutUrl && !compWithoutUrl.websiteUrl) {
      compWithoutUrl.websiteUrl = rawUrls[0];
    }
  }
  return { companies: updated, portfolioUrl };
}

const PERSONAL_DOMAIN_REGEX = /^(gmail|yahoo|hotmail|outlook|live|icloud|me|msn|protonmail|proton|yandex|gmx|mail|zoho)\./i;

export interface MappedEmailResult {
  companiesWithEmails: Array<CompanyPosition & { companyEmails?: string[] }>;
  personalEmails: string[];
  primaryPersonalEmail: string | null;
}

export function mapEmailsToCompanies(
  emails: string[],
  companies: CompanyPosition[],
  portfolioUrl?: string | null
): MappedEmailResult {
  const personalEmails: string[] = [];
  const companyEmailMap = new Map<number, string[]>();
  companies.forEach((_, idx) => companyEmailMap.set(idx, []));

  for (const rawEmail of emails) {
    const email = rawEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) continue;

    const domain = email.split('@')[1] || '';

    // 1. Check if personal email provider
    if (PERSONAL_DOMAIN_REGEX.test(domain)) {
      if (!personalEmails.includes(email)) personalEmails.push(email);
      continue;
    }

    // 2. Check if matches portfolio domain
    let isPortfolio = false;
    if (portfolioUrl) {
      try {
        const portHost = new URL(portfolioUrl.startsWith('http') ? portfolioUrl : `https://${portfolioUrl}`).hostname.toLowerCase();
        if (domain.includes(portHost) || portHost.includes(domain)) {
          isPortfolio = true;
        }
      } catch {
        // ignore
      }
    }

    if (isPortfolio) {
      if (!personalEmails.includes(email)) personalEmails.push(email);
      continue;
    }

    // 3. Try matching to companies by websiteUrl domain or companyName
    let matchedCompanyIdx = -1;
    companies.forEach((comp, idx) => {
      if (matchedCompanyIdx !== -1) return;

      if (comp.websiteUrl) {
        try {
          const compHost = new URL(comp.websiteUrl.startsWith('http') ? comp.websiteUrl : `https://${comp.websiteUrl}`).hostname.toLowerCase();
          const cleanDomain = domain.replace(/^www\./, '');
          const cleanCompHost = compHost.replace(/^www\./, '');
          if (cleanCompHost.includes(cleanDomain) || cleanDomain.includes(cleanCompHost)) {
            matchedCompanyIdx = idx;
          }
        } catch {
          // ignore
        }
      }

      if (matchedCompanyIdx === -1 && comp.companyName) {
        const compSlug = comp.companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const domainSlug = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
        if (compSlug && domainSlug && (compSlug.includes(domainSlug) || domainSlug.includes(compSlug))) {
          matchedCompanyIdx = idx;
        }
      }
    });

    if (matchedCompanyIdx !== -1) {
      const existing = companyEmailMap.get(matchedCompanyIdx) || [];
      if (!existing.includes(email)) existing.push(email);
      companyEmailMap.set(matchedCompanyIdx, existing);
    } else {
      if (companies.length > 0) {
        const existing = companyEmailMap.get(0) || [];
        if (!existing.includes(email)) existing.push(email);
        companyEmailMap.set(0, existing);
      } else {
        if (!personalEmails.includes(email)) personalEmails.push(email);
      }
    }
  }

  const companiesWithEmails = companies.map((comp, idx) => ({
    ...comp,
    companyEmails: companyEmailMap.get(idx) || [],
  }));

  const primaryPersonalEmail = personalEmails[0] ?? null;

  return {
    companiesWithEmails,
    personalEmails,
    primaryPersonalEmail,
  };
}
