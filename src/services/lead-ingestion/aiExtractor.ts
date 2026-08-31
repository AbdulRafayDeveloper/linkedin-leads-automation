import { getFallbackChatModels } from '@/lib/ai/provider';

export interface AiExtractedData {
  summary: string;
  fullName: string | null;
  email: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
}

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

function coerceNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

export function buildRawLeadExtractionPrompt(rawText: string): string {
  return `You are extracting structured information from a pasted LinkedIn profile page or company raw text. The text contains real data mixed with UI controls, navigation labels, and noise.

Read the raw text and return ONLY a single strict JSON object (no markdown formatting, no code fences like \`\`\`json, no commentary before or after it) with exactly these keys:
{
  "summary": "a 1-2 sentence concise summary of who this person is, their title, and the company they represent",
  "fullName": "the person's full name, or null if not found",
  "email": "the person's email address if present in the text, otherwise null",
  "phone": "the phone number if present in the text, otherwise null",
  "website": "the official website URL of the company if present in the text, otherwise null"
}

Rules:
1. Do not invent or guess any name, email, phone, or website. They must literal-match the text.
2. In the "summary" field, provide a clean, professional 1-2 sentence description based on their title and company.
3. If any field is not found, return null.

Raw pasted text:
\"\"\"
${rawText}
\"\"\"

Return only the strict JSON object.`;
}

export async function extractWithAi(
  rawText: string,
  models?: AiChatModel[]
): Promise<AiExtractedData> {
  if (!rawText || !rawText.trim()) {
    throw new Error('Cannot extract empty content');
  }

  const prompt = buildRawLeadExtractionPrompt(rawText);
  const candidateModels = models ?? (await getFallbackChatModels());
  const errors: string[] = [];

  for (const model of candidateModels) {
    try {
      const response = await model.invoke(prompt);
      const text = extractText(response);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('LLM response did not contain a JSON object');

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      return {
        summary: coerceNullableString(parsed.summary) || 'No summary generated.',
        fullName: coerceNullableString(parsed.fullName),
        email: coerceNullableString(parsed.email),
        phoneNumber: coerceNullableString(parsed.phone),
        websiteUrl: coerceNullableString(parsed.website),
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'unknown error');
    }
  }

  throw new Error(`AI extraction failed on all providers: ${errors.join('; ')}`);
}
