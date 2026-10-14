/**
 * URL guards for anything the server fetches on a user's behalf (website
 * crawling). Blocks non-http(s) schemes and hosts that only exist inside the
 * network the server runs in, so the crawler can't be pointed at internal
 * services.
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal']);

const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost'];

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((part) => Number(part) > 255)) return false;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
  return false;
}

export interface SafeUrlResult {
  ok: boolean;
  /** Normalized absolute URL when ok. */
  url?: string;
  error?: string;
}

/** Accepts "acme.com" as well as a full URL; returns a normalized https(s) URL. */
export function toSafePublicUrl(input: string | null | undefined): SafeUrlResult {
  const raw = input?.trim();
  if (!raw) return { ok: false, error: 'Website URL is required' };

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, error: 'That is not a valid website URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs can be crawled' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    isPrivateIpv4(hostname) ||
    hostname.startsWith('[') // bare IPv6 literal
  ) {
    return { ok: false, error: 'That host cannot be crawled' };
  }

  if (!hostname.includes('.')) {
    return { ok: false, error: 'That is not a valid website URL' };
  }

  return { ok: true, url: parsed.toString() };
}
