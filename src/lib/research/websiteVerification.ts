import { getFallbackChatModels } from '@/lib/ai/provider';
import { buildCompanyWebsiteVerificationPrompt } from '@/lib/ai/prompts/companyWebsiteVerificationPrompt';
import type { AiChatModel } from '@/lib/ai/extractLeadWithAi';
import { fetchRenderedHtml } from '@/lib/research/browserFetch';
import {
  findCompanyWebsite,
  normalizeToOrigin,
  stripHtml,
  type CompanyWebsiteContext,
  type FindCompanyWebsiteOptions,
} from '@/lib/research/research';

const FETCH_TIMEOUT_MS = 10000;
const MIN_USABLE_CONTENT_LENGTH = 80;

function extractModelText(raw: { content: unknown } | string): string {
  if (typeof raw === 'string') return raw;
  const { content } = raw;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part as { text?: string }).text || ''))
      .join('');
  }
  return '';
}

export interface HomepageFetcher {
  (url: string): Promise<string | null>;
}

// Plain fetch first (fast, works for most sites); if that comes back empty
// or too thin to judge (a JS-rendered SPA shell, for example), fall back to
// a real headless browser render before giving up on reading this candidate
// at all. Verification needs actual readable content, so this matters more
// here than it does for the lighter existence probe in research.ts.
export const defaultHomepageFetcher: HomepageFetcher = async (url: string): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadResearchBot/1.0)' },
      });
      if (response.ok) {
        const text = stripHtml(await response.text());
        if (text.length >= MIN_USABLE_CONTENT_LENGTH) return text;
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // fall through to the headless-browser attempt below
  }

  const rendered = await fetchRenderedHtml(url).catch(() => null);
  if (!rendered) return null;
  const text = stripHtml(rendered);
  return text.length > 0 ? text : null;
};

export interface WebsiteVerificationResult {
  isMatch: boolean;
  reasoning: string;
}

/**
 * Asks the model whether a candidate website's homepage content actually
 * belongs to this specific company. Fails closed (not a match) whenever the
 * model can't be reached or gives back something unparsable, since a
 * "verified" badge must reflect an actual AI judgment, never an assumption.
 */
export async function verifyCompanyWebsiteWithAi(
  websiteUrl: string,
  pageContent: string,
  companyName: string,
  context: CompanyWebsiteContext,
  personName: string | null,
  models: AiChatModel[]
): Promise<WebsiteVerificationResult> {
  const prompt = buildCompanyWebsiteVerificationPrompt({
    companyName,
    companyLocation: context.location,
    personName,
    personTitle: context.title,
    personHeadline: context.headline,
    about: context.about,
    websiteUrl,
    pageContent,
  });

  for (const model of models) {
    try {
      const response = await model.invoke(prompt);
      const text = extractModelText(response);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (typeof parsed.isMatch === 'boolean') {
        return {
          isMatch: parsed.isMatch,
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        };
      }
    } catch {
      continue;
    }
  }

  return { isMatch: false, reasoning: 'AI verification was unavailable' };
}

export interface FindVerifiedWebsiteOptions extends FindCompanyWebsiteOptions {
  maxAttempts?: number;
  homepageFetcher?: HomepageFetcher;
  verifyModels?: AiChatModel[];
}

export interface FindVerifiedWebsiteResult {
  website: string | null;
  verified: boolean;
  attempts: number;
}

/**
 * Finds a company website and confirms with AI that its actual homepage
 * content belongs to this specific company (matching name and, ideally,
 * location) before accepting it. If an existing candidate fails
 * verification, a fresh candidate is searched for and checked instead, up
 * to maxAttempts times, so a same-named-but-unrelated company link is never
 * left standing just because it was the first (or only) one found.
 */
export async function findVerifiedCompanyWebsite(
  companyName: string,
  context: CompanyWebsiteContext,
  personName: string | null,
  existingWebsite: string | null,
  options: FindVerifiedWebsiteOptions = {}
): Promise<FindVerifiedWebsiteResult> {
  const maxAttempts = options.maxAttempts ?? 10;
  const homepageFetcher = options.homepageFetcher ?? defaultHomepageFetcher;
  const verifyModels = options.verifyModels ?? (await getFallbackChatModels());
  const excluded = new Set<string>();

  let candidate = existingWebsite ? normalizeToOrigin(existingWebsite) : null;
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (!candidate) {
      const searchResult = await findCompanyWebsite(companyName, context, {
        ...options,
        excludeOrigins: excluded,
      });
      candidate = searchResult.website;
    }

    if (!candidate) break;

    attempts += 1;
    excluded.add(candidate);

    const pageContent = await homepageFetcher(candidate);
    if (pageContent) {
      const verification = await verifyCompanyWebsiteWithAi(
        candidate,
        pageContent,
        companyName,
        context,
        personName,
        verifyModels
      );
      if (verification.isMatch) {
        return { website: candidate, verified: true, attempts };
      }
    }

    candidate = null;
  }

  return { website: null, verified: false, attempts };
}
