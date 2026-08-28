import { crawlWebsite, type FetchPageFn } from '../crawler';

function makeFetchPage(pages: Record<string, { html?: string; status?: number }>): FetchPageFn {
  return async (url: string) => {
    const entry = pages[url];
    if (!entry || entry.html === undefined) {
      return { html: null, status: entry?.status ?? 404, finalUrl: url };
    }
    return { html: entry.html, status: entry.status ?? 200, finalUrl: url };
  };
}

const noRobots = async () => null;

describe('crawlWebsite', () => {
  it('extracts emails from mailto links and visible text on the homepage', async () => {
    const fetchPage = makeFetchPage({
      'https://acme.com/': {
        html: '<html><body><a href="mailto:hello@acme.com">Email us</a> or reach sales@acme.com</body></html>',
      },
    });
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      requestDelayMs: 0,
      maxPages: 1,
    });
    const emails = result.emails.map((e) => e.email);
    expect(emails).toContain('hello@acme.com');
    expect(emails).toContain('sales@acme.com');
  });

  it('follows same-origin internal links up to maxDepth', async () => {
    // Use paths outside the built-in priority list so depth is driven purely
    // by link discovery from the homepage, not by priority-path seeding.
    const fetchPage = makeFetchPage({
      'https://acme.com/': {
        html: '<html><body><a href="/updates">Updates</a></body></html>',
      },
      'https://acme.com/updates': {
        html: '<html><body>updates@acme.com <a href="/updates/latest">Latest</a></body></html>',
      },
      'https://acme.com/updates/latest': {
        html: '<html><body>latest@acme.com</body></html>',
      },
    });
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      requestDelayMs: 0,
      maxDepth: 1,
      maxPages: 250,
    });
    const emails = result.emails.map((e) => e.email);
    expect(emails).toContain('updates@acme.com');
    // /updates/latest is discovered at depth 2, beyond maxDepth: 1, so it must not be crawled.
    expect(emails).not.toContain('latest@acme.com');
  });

  it('never follows links to a different origin', async () => {
    const fetchPage = makeFetchPage({
      'https://acme.com/': {
        html: '<html><body><a href="https://evil.com/steal">External</a> hello@acme.com</body></html>',
      },
    });
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      requestDelayMs: 0,
    });
    expect(result.crawledUrls.every((u) => u.startsWith('https://acme.com'))).toBe(true);
  });

  it('respects robots.txt disallow rules', async () => {
    const fetchPage = makeFetchPage({
      'https://acme.com/': { html: '<html><body>hello@acme.com</body></html>' },
      'https://acme.com/careers': { html: '<html><body>careers@acme.com</body></html>' },
    });
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: async () => 'User-agent: *\nDisallow: /careers\n',
      requestDelayMs: 0,
      maxPages: 100,
    });
    const emails = result.emails.map((e) => e.email);
    expect(emails).toContain('hello@acme.com');
    expect(emails).not.toContain('careers@acme.com');
    expect(result.failedUrls.some((f) => f.url.includes('/careers') && f.reason === 'disallowed_by_robots')).toBe(
      true
    );
  });

  it('discovers additional URLs from sitemap.xml', async () => {
    const fetchPage = makeFetchPage({
      'https://acme.com/': { html: '<html><body>hello@acme.com</body></html>' },
      'https://acme.com/sitemap.xml': {
        html: '<urlset><url><loc>https://acme.com/leadership</loc></url></urlset>',
      },
      'https://acme.com/leadership': {
        html: '<html><body>ceo@acme.com</body></html>',
      },
    });
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      requestDelayMs: 0,
      maxPages: 30,
    });
    expect(result.emails.map((e) => e.email)).toContain('ceo@acme.com');
  });

  it('never aborts the whole crawl when one page fails', async () => {
    const fetchPage: FetchPageFn = async (url: string) => {
      if (url === 'https://acme.com/') {
        throw new Error('ECONNRESET');
      }
      if (url === 'https://acme.com/contact') {
        return { html: '<html><body>contact@acme.com</body></html>', status: 200, finalUrl: url };
      }
      return { html: null, status: 404, finalUrl: url };
    };
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      requestDelayMs: 0,
    });
    expect(result.failedUrls.some((f) => f.url === 'https://acme.com/')).toBe(true);
    expect(result.emails.map((e) => e.email)).toContain('contact@acme.com');
  });

  it('never exceeds the maxPages limit', async () => {
    const pages: Record<string, { html: string }> = {};
    for (const path of ['/', '/contact', '/about', '/team', '/careers']) {
      pages[`https://acme.com${path}`] = { html: `<html><body>no emails here</body></html>` };
    }
    const fetchPage = makeFetchPage(pages);
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      requestDelayMs: 0,
      maxPages: 2,
    });
    expect(result.crawledUrls.length).toBeLessThanOrEqual(2);
  });

  it('deduplicates repeated links to the same page (with and without trailing slash)', async () => {
    const fetchPage = makeFetchPage({
      'https://acme.com/': {
        html: '<html><body><a href="/contact">A</a><a href="/contact/">B</a></body></html>',
      },
      'https://acme.com/contact': { html: '<html><body>contact@acme.com</body></html>' },
    });
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      requestDelayMs: 0,
      maxPages: 30,
    });
    const contactHits = result.crawledUrls.filter((u) => u.includes('/contact'));
    expect(contactHits.length).toBe(1);
  });

  it('falls back to a rendered homepage when the plain fetch finds no emails (JS-rendered sites)', async () => {
    const fetchPage = makeFetchPage({
      'https://acme.com/': { html: '<html><body><div id="root"></div></body></html>' },
    });
    const renderPage = jest.fn(async (url: string) =>
      url === 'https://acme.com'
        ? '<html><body><a href="mailto:go@acme.com">Get in touch</a></body></html>'
        : null
    );
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      renderPage,
      requestDelayMs: 0,
      maxPages: 1,
    });
    expect(renderPage).toHaveBeenCalledWith('https://acme.com');
    expect(result.emails.map((e) => e.email)).toContain('go@acme.com');
  });

  it('does not bother rendering the homepage when emails were already found normally', async () => {
    const fetchPage = makeFetchPage({
      'https://acme.com/': { html: '<html><body>hello@acme.com</body></html>' },
    });
    const renderPage = jest.fn(async () => '<html><body>should-not-be-used@acme.com</body></html>');
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      renderPage,
      requestDelayMs: 0,
      maxPages: 1,
    });
    expect(renderPage).not.toHaveBeenCalled();
    expect(result.emails.map((e) => e.email)).toEqual(['hello@acme.com']);
  });

  it('does not render the homepage when robots.txt disallows it', async () => {
    const fetchPage = makeFetchPage({
      'https://acme.com/': { html: '<html><body>no emails here</body></html>' },
    });
    const renderPage = jest.fn(async () => '<html><body>go@acme.com</body></html>');
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: async () => 'User-agent: *\nDisallow: /\n',
      renderPage,
      requestDelayMs: 0,
      maxPages: 1,
    });
    expect(renderPage).not.toHaveBeenCalled();
    expect(result.emails).toEqual([]);
  });

  it('filters out tracker/analytics IDs disguised as emails', async () => {
    const fetchPage = makeFetchPage({
      'https://acme.com/': {
        html:
          '<html><head><script>Sentry.init({dsn:"https://605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com/1"})</script></head>' +
          '<body>hello@acme.com</body></html>',
      },
    });
    const result = await crawlWebsite('https://acme.com', {
      fetchPage,
      fetchRobotsTxt: noRobots,
      requestDelayMs: 0,
    });
    expect(result.emails.map((e) => e.email)).toEqual(['hello@acme.com']);
  });
});
