/** @jest-environment node */
import { clientKey, rateLimit, resetRateLimits } from '../rateLimit';

beforeEach(() => resetRateLimits());

describe('rateLimit', () => {
  it('allows up to the limit and then refuses with a wait time', () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(rateLimit('ip:verify', 3, 60_000, now).ok).toBe(true);
    }
    const blocked = rateLimit('ip:verify', 3, 60_000, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('lets the caller through again once the window has passed', () => {
    const now = 1_000_000;
    rateLimit('ip:verify', 1, 60_000, now);
    expect(rateLimit('ip:verify', 1, 60_000, now + 30_000).ok).toBe(false);
    expect(rateLimit('ip:verify', 1, 60_000, now + 61_000).ok).toBe(true);
  });

  it('counts each key separately', () => {
    const now = 1_000_000;
    rateLimit('a:verify', 1, 60_000, now);
    expect(rateLimit('b:verify', 1, 60_000, now).ok).toBe(true);
  });
});

describe('clientKey', () => {
  it('uses the first forwarded address and the suffix', () => {
    const request = new Request('https://app.test/api', {
      headers: { 'x-forwarded-for': '203.0.113.5, 70.41.3.18' },
    });
    expect(clientKey(request, 'crawl')).toBe('203.0.113.5:crawl');
  });

  it('falls back when no address header is present', () => {
    expect(clientKey(new Request('https://app.test/api'), 'crawl')).toBe('unknown:crawl');
  });
});
