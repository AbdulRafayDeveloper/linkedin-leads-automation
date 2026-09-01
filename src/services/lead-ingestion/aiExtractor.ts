import { getFallbackChatModels } from '@/lib/ai/provider';

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
      "websiteUrl": "<website URL for THIS specific company if mentioned in the text, else null>",
      "roleSummary": "<1-2 sentence summary of what they do at this specific company>"
    }
  ],
  "rawUrls": ["<every URL found anywhere in the text>"],
  "rawEmails": ["<every email address found in the text>"],
  "rawPhones": ["<every phone number found in the text>"]
}

### RULES:
1. "currentCompanies" must contain ONLY roles where the end date says "Present" — do NOT include past roles.
2. Include ALL current roles, even if there are 2 or 3.
3. For "websiteUrl" inside each company: only put a URL if the text explicitly shows a website for THAT company. Otherwise use null.
4. "rawUrls" = every URL found anywhere in the text (contact section, bio, etc.)
5. Return valid JSON only. No markdown fences, no explanation text.

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

      // Parse currentCompanies array
      const rawList = Array.isArray(p.currentCompanies) ? p.currentCompanies : [];
      const currentCompanies: CompanyPosition[] = rawList
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
          companyName: str(item.companyName) ?? 'Unknown Company',
          jobTitle: str(item.jobTitle) ?? 'Professional',
          workPeriod: str(item.workPeriod),
          websiteUrl: str(item.websiteUrl),
          roleSummary: str(item.roleSummary) ?? '',
        }));

      // Fallback: if AI returned 0 companies but returned top-level fields
      if (currentCompanies.length === 0) {
        currentCompanies.push({
          companyName: str(p.companyName) ?? 'Unspecified Company',
          jobTitle: str(p.jobTitle) ?? 'Professional',
          workPeriod: str(p.workPeriod),
          websiteUrl: str(p.websiteUrl),
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

      return { fullName, personSummary, currentCompanies, rawUrls, rawEmails, rawPhones };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(`AI extraction failed: ${errors.join(' | ')}`);
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
        if (!alreadyAssigned && updated[0] && !updated[0].websiteUrl) {
          updated[0].websiteUrl = url;
        }
      }

      return { companies: updated, portfolioUrl };
    } catch {
      // try next model
    }
  }

  // Hard fallback: assign first URL to first company
  if (rawUrls.length > 0 && updated[0] && !updated[0].websiteUrl) {
    updated[0].websiteUrl = rawUrls[0];
  }
  return { companies: updated, portfolioUrl };
}
