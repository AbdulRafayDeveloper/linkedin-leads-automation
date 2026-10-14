/**
 * Limits and checks for the text pasted on the New Lead page.
 * Shared by the browser (instant feedback) and the API (the real gate).
 */

export const MIN_PROFILE_CHARS = 40;
export const MAX_PROFILE_CHARS = 50_000;

export type IngestionInputError = 'empty' | 'too_short' | 'too_long' | 'no_words';

export interface IngestionInputCheck {
  ok: boolean;
  error?: IngestionInputError;
  message?: string;
}

const MESSAGES: Record<IngestionInputError, string> = {
  empty: 'Paste the profile text first.',
  too_short: `That looks too short for a profile. Paste at least ${MIN_PROFILE_CHARS} characters, including the name and current role.`,
  too_long: `That text is too long. Keep it under ${MAX_PROFILE_CHARS.toLocaleString('en-US')} characters — paste just the profile, not the whole page.`,
  no_words: 'That text has no readable profile details. Copy the name, role and company from the profile page.',
};

/** At least four word-like tokens, so "x" or "🚀🚀🚀" never reaches the model. */
function hasEnoughWords(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'._-]*/gu) ?? [];
  const letterWords = words.filter((w) => /\p{L}/u.test(w));
  return letterWords.length >= 4;
}

export function checkIngestionInput(raw: string): IngestionInputCheck {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'empty', message: MESSAGES.empty };
  if (text.length > MAX_PROFILE_CHARS) return { ok: false, error: 'too_long', message: MESSAGES.too_long };
  if (text.length < MIN_PROFILE_CHARS) return { ok: false, error: 'too_short', message: MESSAGES.too_short };
  if (!hasEnoughWords(text)) return { ok: false, error: 'no_words', message: MESSAGES.no_words };
  return { ok: true };
}
