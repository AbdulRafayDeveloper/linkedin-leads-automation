/**
 * Tiny in-memory sliding-window limiter for expensive endpoints (SMTP
 * verification, crawling). There is no auth on this app, so this is what keeps
 * a loop or a stranger from using it as an email-validation oracle.
 *
 * Per server instance only: good enough here, since the alternative is a
 * shared store this single-user app doesn't have.
 */

const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the next attempt is allowed (0 when ok). */
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const hits = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
    return { ok: false, retryAfter };
  }

  hits.push(now);
  buckets.set(key, hits);

  // Keep the map from growing without bound on a long-lived server.
  if (buckets.size > 500) {
    for (const [bucketKey, times] of buckets) {
      if (times.every((time) => now - time >= windowMs)) buckets.delete(bucketKey);
    }
  }

  return { ok: true, retryAfter: 0 };
}

/** Best-effort client identity for rate limiting behind a proxy. */
export function clientKey(request: Request, suffix = ''): string {
  const headers = request.headers;
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip')?.trim() ||
    'unknown';
  return `${ip}:${suffix}`;
}

/** Test helper: forget every recorded hit. */
export function resetRateLimits(): void {
  buckets.clear();
}
