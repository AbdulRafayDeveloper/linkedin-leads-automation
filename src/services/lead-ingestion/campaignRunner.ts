/**
 * Pure rules for the campaign runner. Safe to import from the browser and
 * from API routes, so both sides agree on delays and formatting.
 */

/** Smallest delay the UI and API accept between two sends. */
export const MIN_DELAY_SECONDS = 5;
/** Largest delay accepted between two sends (one hour). */
export const MAX_DELAY_SECONDS = 3600;
export const DEFAULT_MIN_DELAY_SECONDS = 60;
export const DEFAULT_MAX_DELAY_SECONDS = 600;

/** How long a `sending` item may stay in that state before it is treated as timed out. */
export const SENDING_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Extra time, on top of the campaign's own maximum delay, before a runner
 * that stopped calling the API is treated as gone (tab closed, laptop asleep).
 */
export const RUNNER_GRACE_MS = 3 * 60 * 1000;

export const CAMPAIGN_NAME_MAX_LENGTH = 120;

export interface DelayRange {
  minDelaySeconds: number;
  maxDelaySeconds: number;
}

function toInteger(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Clamps both delays into the accepted range and makes sure the minimum is
 * never above the maximum. Missing or invalid values fall back to the given
 * defaults (or the global defaults).
 */
export function normalizeDelays(
  minInput: unknown,
  maxInput: unknown,
  fallback: DelayRange = {
    minDelaySeconds: DEFAULT_MIN_DELAY_SECONDS,
    maxDelaySeconds: DEFAULT_MAX_DELAY_SECONDS,
  }
): DelayRange {
  const min = clamp(toInteger(minInput) ?? fallback.minDelaySeconds, MIN_DELAY_SECONDS, MAX_DELAY_SECONDS);
  const max = clamp(toInteger(maxInput) ?? fallback.maxDelaySeconds, MIN_DELAY_SECONDS, MAX_DELAY_SECONDS);
  return min <= max
    ? { minDelaySeconds: min, maxDelaySeconds: max }
    : { minDelaySeconds: max, maxDelaySeconds: min };
}

/** A whole number of seconds between min and max inclusive, never below MIN_DELAY_SECONDS. */
export function randomDelaySeconds(min: number, max: number, random: () => number = Math.random): number {
  const range = normalizeDelays(min, max);
  const span = range.maxDelaySeconds - range.minDelaySeconds + 1;
  return range.minDelaySeconds + Math.floor(clamp(random(), 0, 0.999999) * span);
}

/** "45s", "1m 30s", "10m", "1h 5m". */
export function formatDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** "60s to 10m" for the delay range line. */
export function formatDelayRange(range: DelayRange): string {
  return `${formatDuration(range.minDelaySeconds)} to ${formatDuration(range.maxDelaySeconds)}`;
}

/** Date and time in the viewer's locale, or a dash when missing. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function isValidCampaignName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= CAMPAIGN_NAME_MAX_LENGTH;
}

/** A random id for the browser tab that drives a campaign. */
export function makeRunnerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
