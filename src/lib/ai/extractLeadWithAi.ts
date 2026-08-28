import { getFallbackChatModels } from '@/lib/ai/provider';
import { buildLeadExtractionPrompt } from '@/lib/ai/prompts/leadExtractionPrompt';
import type { ParsedLead } from '@/lib/types/lead';

export interface AiChatModel {
  invoke: (prompt: string) => Promise<{ content: unknown } | string>;
}

function extractText(raw: { content: unknown } | string): string {
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

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function coerceNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

function normalizeExtractedLead(json: Record<string, unknown>, sourceText: string): ParsedLead {
  return {
    fullName: coerceNullableString(json.fullName) || 'UNCERTAIN',
    linkedinProfileUrl: coerceNullableString(json.linkedinProfileUrl),
    headline: coerceNullableString(json.headline),
    currentTitle: coerceNullableString(json.currentTitle),
    currentCompany: coerceNullableString(json.currentCompany) || 'CURRENT_COMPANY_UNCERTAIN',
    currentCompanyLinkedInUrl: coerceNullableString(json.currentCompanyLinkedInUrl),
    currentCompanyWebsite: coerceNullableString(json.currentCompanyWebsite),
    currentCompanyLocation: coerceNullableString(json.currentCompanyLocation),
    location: coerceNullableString(json.location),
    currentRoleStartDate: coerceNullableString(json.currentRoleStartDate),
    about: coerceNullableString(json.about),
    experience: coerceStringArray(json.experience),
    education: coerceStringArray(json.education),
    skills: coerceStringArray(json.skills),
    recentActivity: coerceStringArray(json.recentActivity),
    publicEmail: coerceNullableString(json.publicEmail),
    sourceText,
  };
}

/**
 * Extracts structured lead data from pasted Sales Navigator content using an
 * LLM instead of regex/heuristic parsing. Tries Groq first (fast, free) and
 * transparently falls back to OpenAI if Groq errors out or returns something
 * unparsable, so a single provider outage doesn't break lead processing.
 */
export async function extractLeadWithAi(
  rawContent: string,
  models?: AiChatModel[]
): Promise<ParsedLead> {
  if (!rawContent || !rawContent.trim()) {
    throw new Error('Cannot parse empty content');
  }

  const prompt = buildLeadExtractionPrompt(rawContent);
  const candidateModels = models ?? (await getFallbackChatModels());
  const errors: string[] = [];

  for (const model of candidateModels) {
    try {
      const response = await model.invoke(prompt);
      const text = extractText(response);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Model did not return a JSON object');

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return normalizeExtractedLead(parsed, rawContent);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'unknown error');
    }
  }

  throw new Error(`AI lead extraction failed on all providers: ${errors.join('; ')}`);
}
