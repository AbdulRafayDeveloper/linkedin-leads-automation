/**
 * The pool of Groq API keys.
 *
 * Groq's free tier limits tokens per minute and per day **per key**, and a
 * busy day exhausts one key long before the work is done. So the app holds
 * several keys and walks through them: key 1, key 2, … last, then back to the
 * first. A key that answers with a rate limit is set aside until the moment
 * Groq itself names in the error, so the next call does not waste a round trip
 * on it.
 *
 * Keys are read from the environment, in this order:
 *   GROQ_API_KEY          (single key, still supported)
 *   GROQ_API_KEY_1 … _N   (any numbers, sorted; gaps are fine)
 *   GROQ_API_KEYS         (one line or comma separated list)
 * Adding another key is only an environment change — nothing in the code
 * needs to know how many there are.
 */

export interface GroqKey {
  /** Stable name for logs and cooldowns. Never the secret itself. */
  id: string;
  key: string;
}

interface Cooldown {
  until: number;
  reason: string;
}

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const AUTH_COOLDOWN_MS = 30 * 60_000;
const UNKNOWN_FAILURE_COOLDOWN_MS = 15_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;

const cooldowns = new Map<string, Cooldown>();
/** Where the next walk through the keys starts. */
let cursor = 0;

function collectFromEnv(env: NodeJS.ProcessEnv): string[] {
  const numbered = Object.keys(env)
    .map((name) => /^GROQ_API_KEY_(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => !!match)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((match) => env[match[0]]);

  const list = (env.GROQ_API_KEYS ?? '').split(/[\s,]+/);

  return [env.GROQ_API_KEY, ...numbered, ...list]
    .map((value) => (value ?? '').trim())
    .filter(Boolean);
}

/** Every configured key, in order, without duplicates. */
export function getGroqKeys(env: NodeJS.ProcessEnv = process.env): GroqKey[] {
  const seen = new Set<string>();
  const keys: GroqKey[] = [];
  for (const key of collectFromEnv(env)) {
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push({ id: `groq#${keys.length + 1}`, key });
  }
  return keys;
}

/** "…aB3d" — enough to tell two keys apart in a log, useless to anyone else. */
export function maskKey(key: string): string {
  return key.length <= 4 ? '…' : `…${key.slice(-4)}`;
}

function isCoolingDown(id: string, now: number): boolean {
  const cooldown = cooldowns.get(id);
  if (!cooldown) return false;
  if (cooldown.until <= now) {
    cooldowns.delete(id);
    return false;
  }
  return true;
}

/**
 * The keys to try, starting where the last call left off and skipping the ones
 * Groq has told us to wait on. If every key is cooling down they are all
 * returned anyway: a stale cooldown should never stop the app from trying.
 */
export function keysToTry(env: NodeJS.ProcessEnv = process.env, now = Date.now()): GroqKey[] {
  const keys = getGroqKeys(env);
  if (keys.length === 0) return [];

  const start = cursor % keys.length;
  const rotated = [...keys.slice(start), ...keys.slice(0, start)];
  const ready = rotated.filter((entry) => !isCoolingDown(entry.id, now));
  return ready.length > 0 ? ready : rotated;
}

/** Seconds Groq asks us to wait, from messages like "try again in 45m41.04s". */
export function parseRetryAfterMs(message: string): number | null {
  const explicit = /try again in\s+(?:(\d+)m)?\s*([\d.]+)?s?/i.exec(message);
  if (explicit) {
    const minutes = Number(explicit[1] ?? 0);
    const seconds = Number(explicit[2] ?? 0);
    const ms = Math.round((minutes * 60 + seconds) * 1000);
    if (ms > 0) return Math.min(ms, MAX_COOLDOWN_MS);
  }
  return null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error ?? '');
}

export type KeyFailureKind = 'rate_limit' | 'auth' | 'too_large' | 'other';

export function classifyFailure(message: string): KeyFailureKind {
  // "Request too large" is about the prompt, not the key: every key would
  // refuse it, so none of them is parked for it.
  if (/\b413\b|request too large|reduce the length/i.test(message)) return 'too_large';
  if (/\b429\b|rate.?limit|too many requests/i.test(message)) return 'rate_limit';
  if (/\b401\b|\b403\b|invalid api key|unauthorized|authentication/i.test(message)) return 'auth';
  return 'other';
}

/** Records a failed call so the next one starts with a different key. */
export function noteKeyFailure(id: string, error: unknown, now = Date.now()): void {
  const message = describeError(error);
  const kind = classifyFailure(message);

  if (kind === 'too_large') {
    console.error(`[groq] ${id} refused the prompt as too large; the key is still good. ${message.slice(0, 200)}`);
    return;
  }

  const wait =
    kind === 'rate_limit'
      ? (parseRetryAfterMs(message) ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS)
      : kind === 'auth'
        ? AUTH_COOLDOWN_MS
        : UNKNOWN_FAILURE_COOLDOWN_MS;

  cooldowns.set(id, { until: now + wait, reason: kind });
  advanceCursor(id);

  const seconds = Math.round(wait / 1000);
  console.error(
    `[groq] ${id} failed (${kind}); skipping it for ${seconds}s. ${message.slice(0, 200)}`
  );
}

/** A key that worked becomes the starting point for the next call. */
export function noteKeySuccess(id: string, env: NodeJS.ProcessEnv = process.env): void {
  cooldowns.delete(id);
  const index = getGroqKeys(env).findIndex((entry) => entry.id === id);
  if (index >= 0) cursor = index;
}

function advanceCursor(id: string, env: NodeJS.ProcessEnv = process.env): void {
  const keys = getGroqKeys(env);
  const index = keys.findIndex((entry) => entry.id === id);
  if (index >= 0 && keys.length > 0) cursor = (index + 1) % keys.length;
}

export interface GroqKeyStatus {
  id: string;
  masked: string;
  coolingDownFor: number;
  reason?: string;
}

/** What the pool looks like right now: for logs, diagnostics and tests. */
export function describeGroqKeys(env: NodeJS.ProcessEnv = process.env, now = Date.now()): GroqKeyStatus[] {
  return getGroqKeys(env).map((entry) => {
    const cooldown = cooldowns.get(entry.id);
    const remaining = cooldown && cooldown.until > now ? Math.round((cooldown.until - now) / 1000) : 0;
    return {
      id: entry.id,
      masked: maskKey(entry.key),
      coolingDownFor: remaining,
      ...(remaining > 0 ? { reason: cooldown!.reason } : {}),
    };
  });
}

/** Test helper: forget every cooldown and start again at the first key. */
export function resetGroqKeyState(): void {
  cooldowns.clear();
  cursor = 0;
}
