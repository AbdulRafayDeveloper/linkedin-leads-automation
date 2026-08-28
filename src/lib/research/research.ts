import { getFallbackChatModels } from '@/lib/ai/provider';
import { buildCompanyWebsiteGuessPrompt } from '@/lib/ai/prompts/companyWebsiteGuessPrompt';
import type { AiChatModel } from '@/lib/ai/extractLeadWithAi';
import type { CompanyResearchResult } from '@/lib/types/lead';

const FETCH_TIMEOUT_MS = 8000;

export interface FetchPage {
  (url: string): Promise<string | null>;
}

const defaultFetchPage: FetchPage = async (url: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadResearchBot/1.0)' },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export interface PageProbeResult {
  status: number | null;
  text: string;
}

export interface PageProbe {
  (url: string): Promise<PageProbeResult>;
}

// Unlike defaultFetchPage (which only cares about real page content and
// treats any non-2xx response as a dead end), a website-existence check
// needs the raw status too: a company's real site returning a 403 from its
// own bot-protection (Cloudflare, Akamai, etc.) is strong evidence the
// domain is real and in active use, even though its content can't be read.
const defaultPageProbe: PageProbe = async (url: string): Promise<PageProbeResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadResearchBot/1.0)' },
    });
    const html = await response.text().catch(() => '');
    return { status: response.status, text: stripHtml(html) };
  } catch {
    return { status: null, text: '' };
  } finally {
    clearTimeout(timeout);
  }
};

// Analytics/error-tracking scripts (Sentry, GTM, Wix, etc.) embed IDs shaped
// like "<hex>@<vendor-domain>" inside <script> tags. These match a plain
// email regex but are never real contact addresses, so they must be excluded.
const TRACKER_DOMAINS =
  /(^|\.)(wixpress\.com|sentry\.io|google-analytics\.com|googletagmanager\.com|doubleclick\.net|hotjar\.com|segment\.io|cloudflareinsights\.com)$/i;

function extractEmails(html: string): string[] {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const matches = withoutScripts.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  return Array.from(new Set(matches)).filter((email) => {
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) return false;
    const [localPart, domain] = email.split('@');
    if (TRACKER_DOMAINS.test(domain)) return false;
    if (/^[0-9a-f]{16,}$/i.test(localPart)) return false;
    return true;
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToOrigin(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.origin;
  } catch {
    return null;
  }
}

// Startups frequently end up on a non-.com TLD when the .com is already
// taken by an unrelated (often larger/older) company of the same name, so
// guessing .com alone reliably picks the wrong company in that case.
const GUESS_TLDS = ['com', 'co', 'io', 'ai', 'net'];

function guessDomainCandidates(companyName: string): string[] {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '');
  if (!slug) return [];
  return GUESS_TLDS.map((tld) => `https://${slug}.${tld}`);
}

const SEARCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Search results, directories, and social/media platforms that are never a
// company's own official website, even though they legitimately rank for a
// company-name query.
const NON_OFFICIAL_RESULT_DOMAINS =
  /(^|\.)(duckduckgo\.com|bing\.com|google\.[a-z.]+|yahoo\.com|linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|wikipedia\.org|crunchbase\.com|glassdoor\.[a-z.]+|indeed\.com|zoominfo\.com|owler\.com|bloomberg\.com|craft\.co|similarweb\.com|yelp\.com|bbb\.org|pitchbook\.com|dnb\.com|opencorporates\.com|medium\.com|blogspot\.com|wordpress\.com|quora\.com|reddit\.com|trustpilot\.com|apollo\.io|rocketreach\.co|signalhire\.com|play\.google\.com|apps\.apple\.com|github\.com|microsoft\.com)$/i;

export interface SearchEngine {
  (query: string): Promise<string[]>;
}

// Parses DuckDuckGo's non-JS HTML results page, which encodes each result's
// real destination in a "uddg=" query param on its redirect link.
const duckDuckGoSearch: SearchEngine = async (query: string): Promise<string[]> => {
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': SEARCH_USER_AGENT },
    });
    if (!response.ok) return [];
    const html = await response.text();
    const regex = /uddg=([^&"']+)/g;
    const urls: string[] = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      try {
        urls.push(decodeURIComponent(match[1]));
      } catch {
        // ignore malformed redirect params
      }
    }
    return urls;
  } catch {
    return [];
  }
};

// Fallback search engine used when DuckDuckGo is blocked/rate-limited or
// returns nothing usable, so a single engine outage doesn't lose a real
// website that is otherwise easy to find.
const bingSearch: SearchEngine = async (query: string): Promise<string[]> => {
  try {
    const response = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': SEARCH_USER_AGENT },
    });
    if (!response.ok) return [];
    const html = await response.text();
    const regex = /<a[^>]+href="(https?:\/\/[^"]+)"/g;
    const urls: string[] = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      urls.push(match[1]);
    }
    return urls;
  } catch {
    return [];
  }
};

// Derives a short disambiguating phrase (industry/product context) from the
// lead's own profile text, so a generic or common company name can be told
// apart from unrelated companies sharing the same name.
function buildIndustryHint(context: CompanyWebsiteContext): string | null {
  const source = context.about || context.headline || null;
  if (!source) return null;
  const words = source
    .replace(/https?:\/\/\S+/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(' ');
  return words.length > 3 ? words : null;
}

function buildCandidateQueries(companyName: string, context: CompanyWebsiteContext): string[] {
  const location = context.location ? ` ${context.location}` : '';
  const industryHint = buildIndustryHint(context);
  const queries = [`${companyName}${location} official website`];
  if (industryHint) queries.push(`${companyName} ${industryHint} official website`);
  queries.push(`${companyName} official website`);
  queries.push(`${companyName} company website`);
  return Array.from(new Set(queries));
}

export interface CompanyWebsiteContext {
  location?: string | null;
  title?: string | null;
  headline?: string | null;
  about?: string | null;
}

export interface CompanyWebsiteSearchResult {
  website: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  queriesTried: string[];
}

export interface FindCompanyWebsiteOptions {
  searchEngines?: SearchEngine[];
  // Chat models to ask for a knowledge-based domain guess. Omit to use the
  // real Groq/OpenAI fallback chain; pass [] to disable this tier entirely
  // (e.g. in tests, to avoid real network/API calls).
  aiModels?: AiChatModel[];
  pageProbe?: PageProbe;
  maxCandidatesToVerify?: number;
}

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

// Uses the model's own training knowledge to name a likely domain, so a
// company that is hard to find via web search (or whose name collides with
// an unrelated, better-known company) can still be identified from context.
// A model error or an unparsable response just yields no extra candidates.
async function guessDomainsWithAi(
  companyName: string,
  context: CompanyWebsiteContext,
  models: AiChatModel[]
): Promise<string[]> {
  const prompt = buildCompanyWebsiteGuessPrompt(companyName, context);
  for (const model of models) {
    try {
      const response = await model.invoke(prompt);
      const text = extractModelText(response);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (!Array.isArray(parsed)) continue;
      const domains = parsed.filter((d): d is string => typeof d === 'string' && d.trim().length > 0);
      if (domains.length > 0) return domains;
    } catch {
      continue;
    }
  }
  return [];
}

// Anti-bot challenge pages (Cloudflare, Akamai, generic "prove you're human"
// interstitials) are themselves evidence the domain is real and actively
// maintained, even though they hide the actual content.
const BOT_BLOCK_SIGNATURES =
  /(attention required|checking your browser|please enable cookies|access denied|cf-browser-verification|unusual traffic|verify you are human|are you a robot)/i;
const BOT_BLOCK_STATUSES = new Set([401, 403, 429, 503]);

// A guessed TLD variant of the real company's domain is often simply unused
// and sitting at a registrar's parking/for-sale page. Such a page almost
// always echoes the domain name in its own text ("example.net is for sale"),
// which would otherwise look exactly like a real name-match to the scorer
// above — so it must be excluded outright rather than scored normally.
const PARKING_PAGE_SIGNATURES =
  /(domain (is |may be )?for sale|buy this domain|make an offer|this domain is parked|domain parking|inquire about this domain|checkout\.namecheap|hugedomains|afternic|sedo\.com|dan\.com|spaceship\.com|godaddy\.com\/domains|buydomains)/i;

// Scores how likely a probed page is to actually be this specific company's
// site. A normal page that mentions the company name (and ideally the lead's
// own location/industry context) scores highest. A page we couldn't read
// but that is clearly a bot-protection challenge still scores as "probably
// real" rather than being excluded, since companies don't put bot protection
// on domains that don't exist. A thin/empty 200 (a parked or placeholder
// page) scores lowest among reachable results, and a connection failure
// excludes the candidate entirely. This ordering is what lets a same-named
// but content-blocked real company beat an unrelated, fully-open decoy
// domain that merely happens to resolve.
function scoreProbe(probe: PageProbeResult, companyName: string, context: CompanyWebsiteContext): number {
  if (probe.status === null) return 0;

  const text = probe.text.toLowerCase();
  const isOk = probe.status >= 200 && probe.status < 300;

  if (isOk && PARKING_PAGE_SIGNATURES.test(text)) return 0;

  if (isOk && text.length >= 50) {
    let score = 1;
    if (text.includes(companyName.toLowerCase())) score += 3;

    const contextText = `${context.location || ''} ${buildIndustryHint(context) || ''}`.toLowerCase();
    const contextTokens = Array.from(new Set(contextText.split(/[^a-z0-9]+/).filter((token) => token.length >= 4)));
    for (const token of contextTokens) {
      if (text.includes(token)) score += 1;
    }
    return score;
  }

  if (BOT_BLOCK_STATUSES.has(probe.status) || BOT_BLOCK_SIGNATURES.test(text)) {
    return 2;
  }

  if (isOk) return 1;

  return 0;
}

/**
 * Finds a company's official website by name using free signals only (no
 * paid lookup APIs): web search, the model's own knowledge, and guessed
 * domain patterns across common TLDs. Every candidate is fetched and scored
 * against the company name and the lead's own location/industry context
 * before being trusted, so a same-named-but-unrelated company (or a blindly
 * guessed .com that isn't this company) doesn't win just by being found
 * first — a real website that exists on the web should still surface even
 * when one source (a search engine, a guessed TLD) comes back empty or wrong.
 */
export async function findCompanyWebsite(
  companyName: string,
  context: CompanyWebsiteContext = {},
  options: FindCompanyWebsiteOptions = {}
): Promise<CompanyWebsiteSearchResult> {
  if (!companyName || companyName === 'CURRENT_COMPANY_UNCERTAIN') {
    return { website: null, confidence: 'LOW', queriesTried: [] };
  }

  const searchEngines = options.searchEngines ?? [duckDuckGoSearch, bingSearch];
  const pageProbe = options.pageProbe ?? defaultPageProbe;
  const maxCandidates = options.maxCandidatesToVerify ?? 6;

  const queries = buildCandidateQueries(companyName, context);
  const queriesTried: string[] = [];
  const seen = new Set<string>();
  const prioritized: string[] = [];

  const addCandidate = (rawUrl: string): void => {
    let origin: string | null;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (NON_OFFICIAL_RESULT_DOMAINS.test(url.hostname)) return;
      origin = url.origin;
    } catch {
      return;
    }
    if (seen.has(origin)) return;
    seen.add(origin);
    prioritized.push(origin);
  };

  // Tier 1: web search engines. Best effort only — some search engines block
  // or serve unrelated content to automated traffic, but that's harmless
  // here since every candidate is verified below rather than trusted as-is.
  for (const query of queries) {
    queriesTried.push(query);
    const resultsByEngine = await Promise.all(searchEngines.map((engine) => engine(query)));
    resultsByEngine.flat().forEach(addCandidate);
    if (prioritized.length > 0) break;
  }

  // Tier 2: the model's own knowledge of the company.
  if (!options.aiModels || options.aiModels.length > 0) {
    try {
      const models = options.aiModels ?? (await getFallbackChatModels());
      const aiGuesses = await guessDomainsWithAi(companyName, context, models);
      aiGuesses.forEach((domain) => addCandidate(domain.startsWith('http') ? domain : `https://${domain}`));
    } catch {
      // AI guessing is a best-effort signal; provider errors must not fail the search.
    }
  }

  // Tier 3: guessed domain patterns across common TLDs.
  guessDomainCandidates(companyName).forEach(addCandidate);

  if (prioritized.length === 0) {
    return { website: null, confidence: 'LOW', queriesTried };
  }

  const toVerify = prioritized.slice(0, maxCandidates);
  const scored = await Promise.all(
    toVerify.map(async (origin) => ({
      origin,
      score: scoreProbe(await pageProbe(origin), companyName, context),
    }))
  );

  const reachable = scored.filter((candidate) => candidate.score > 0);
  if (reachable.length === 0) {
    // Nothing could be verified as existing at all (likely a scraper block,
    // not proof the site doesn't exist) — still surface the best guess
    // rather than nothing.
    return { website: toVerify[0], confidence: 'LOW', queriesTried };
  }

  reachable.sort((a, b) => b.score - a.score);
  const best = reachable[0];
  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = best.score >= 5 ? 'HIGH' : best.score >= 4 ? 'MEDIUM' : 'LOW';

  return { website: best.origin, confidence, queriesTried };
}

export async function researchCompany(
  companyName: string,
  providedWebsite: string | null,
  fetchPage: FetchPage = defaultFetchPage,
  context: CompanyWebsiteContext = {},
  findWebsiteOptions: FindCompanyWebsiteOptions = {}
): Promise<CompanyResearchResult> {
  const result: CompanyResearchResult = {
    companyName,
    officialWebsite: null,
    confidence: 'LOW',
    description: null,
    signals: [],
    discoveredEmails: [],
    sourceUrls: [],
  };

  if (!companyName || companyName === 'CURRENT_COMPANY_UNCERTAIN') {
    result.signals.push('Company name uncertain; skipped research');
    return result;
  }

  const candidates: string[] = [];
  if (providedWebsite) {
    const origin = normalizeToOrigin(providedWebsite);
    if (origin) candidates.push(origin);
  } else {
    const searchResult = await findCompanyWebsite(companyName, context, findWebsiteOptions);
    if (searchResult.website) {
      candidates.push(searchResult.website);
    }
  }

  for (const candidate of candidates) {
    const html = await fetchPage(candidate);
    if (!html) continue;

    const text = stripHtml(html);
    const normalizedCompany = companyName.toLowerCase();
    const nameAppears = text.toLowerCase().includes(normalizedCompany);

    result.officialWebsite = candidate;
    result.sourceUrls.push(candidate);
    result.discoveredEmails.push(...extractEmails(html));
    result.confidence = providedWebsite ? (nameAppears ? 'HIGH' : 'MEDIUM') : nameAppears ? 'MEDIUM' : 'LOW';
    if (nameAppears) {
      result.signals.push(`Company name "${companyName}" found on homepage`);
    }
    result.description = text.slice(0, 300) || null;

    const subpagePaths = [
      '/contact',
      '/contact-us',
      '/contactus',
      '/get-in-touch',
      '/reach-us',
      '/connect',
      '/talk-to-us',
      '/speak-to-us',
      '/about',
      '/about-us',
      '/company',
      '/team',
      '/our-team',
      '/leadership',
      '/management',
      '/founders',
      '/people',
      '/demo',
      '/request-demo',
      '/book-demo',
      '/schedule-demo',
      '/sales',
      '/request-quote',
      '/get-quote',
      '/support',
      '/help',
      '/help-center',
      '/customer-support',
      '/customer-service',
      '/contact-support',
      '/careers',
      '/career',
      '/jobs',
      '/join-us',
      '/work-with-us',
      '/employment',
      '/press',
      '/media',
      '/news',
      '/newsroom',
      '/press-room',
      '/press-kit',
      '/media-kit',
      '/partners',
      '/partnerships',
      '/business',
      '/sales-contact',
      '/vendors',
      '/suppliers',
      '/privacy',
      '/privacy-policy',
      '/terms',
      '/terms-and-conditions',
      '/legal',
      '/locations',
      '/offices',
      '/faq',
      '/faqs',
    ];
    const initialPaths: string[] = [];
    for (const path of subpagePaths) {
      initialPaths.push(path);
      if (path !== '/' && !path.endsWith('.xml') && !path.endsWith('.html')) {
        initialPaths.push(`${path}.html`);
      }
    }

    await Promise.all(
      initialPaths.map(async (path) => {
        try {
          const url = `${candidate}${path}`;
          const pageHtml = await fetchPage(url);
          if (pageHtml) {
            result.sourceUrls.push(url);
            result.discoveredEmails.push(...extractEmails(pageHtml));
          }
        } catch {
          // ignore
        }
      })
    );

    result.discoveredEmails = Array.from(new Set(result.discoveredEmails));
    break;
  }

  if (!result.officialWebsite) {
    result.signals.push('Could not verify an official website with confidence');
  }

  return result;
}
