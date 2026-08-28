import { findCompanyWebsite, researchCompany, type FetchPage, type PageProbe, type SearchEngine } from '../research';

function makeFetch(pages: Record<string, string>): FetchPage {
  return async (url: string) => pages[url] ?? null;
}

function fakeEngine(urls: string[]): SearchEngine {
  return async () => urls;
}

function probeOnlyFor(matches: Record<string, string>): PageProbe {
  return async (url: string) => (url in matches ? { status: 200, text: matches[url] } : { status: null, text: '' });
}

const probeNever: PageProbe = async () => ({ status: null, text: '' });

describe('researchCompany', () => {
  it('returns LOW confidence and skips research for an uncertain company name', async () => {
    const result = await researchCompany('CURRENT_COMPANY_UNCERTAIN', null, async () => null);
    expect(result.confidence).toBe('LOW');
    expect(result.officialWebsite).toBeNull();
  });

  it('verifies a provided website with HIGH confidence when the company name appears', async () => {
    const fetchPage = makeFetch({
      'https://www.northwindrobotics.com': '<html><body>Northwind Robotics builds robots</body></html>',
    });
    const result = await researchCompany('Northwind Robotics', 'https://www.northwindrobotics.com', fetchPage);
    expect(result.officialWebsite).toBe('https://www.northwindrobotics.com');
    expect(result.confidence).toBe('HIGH');
  });

  it('marks MEDIUM confidence when provided website does not mention the company name', async () => {
    const fetchPage = makeFetch({
      'https://www.example.com': '<html><body>Generic landing page</body></html>',
    });
    const result = await researchCompany('Northwind Robotics', 'https://www.example.com', fetchPage);
    expect(result.confidence).toBe('MEDIUM');
  });

  it('guesses a domain candidate when no website is provided', async () => {
    const fetchPage = makeFetch({
      'https://northwindrobotics.com': '<html><body>Northwind Robotics</body></html>',
    });
    const result = await researchCompany('Northwind Robotics', null, fetchPage, {}, {
      searchEngines: [fakeEngine([])],
      aiModels: [],
      pageProbe: probeOnlyFor({
        'https://northwindrobotics.com': 'Northwind Robotics builds autonomous robots for logistics customers',
      }),
    });
    expect(result.officialWebsite).toBe('https://northwindrobotics.com');
  });

  it('extracts emails discovered from homepage and sub-pages', async () => {
    const fetchPage = makeFetch({
      'https://www.northwindrobotics.com': '<html><body>Contact us at hello@northwindrobotics.com</body></html>',
      'https://www.northwindrobotics.com/contact': '<html><body>sales@northwindrobotics.com</body></html>',
    });
    const result = await researchCompany('Northwind Robotics', 'https://www.northwindrobotics.com', fetchPage);
    expect(result.discoveredEmails).toContain('hello@northwindrobotics.com');
    expect(result.discoveredEmails).toContain('sales@northwindrobotics.com');
  });

  it('ignores tracking IDs embedded in script tags that look like emails', async () => {
    const fetchPage = makeFetch({
      'https://www.northwindrobotics.com':
        '<html><head><script>Sentry.init({dsn:"https://605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com/123"})</script></head><body>Northwind Robotics. Contact hello@northwindrobotics.com</body></html>',
    });
    const result = await researchCompany('Northwind Robotics', 'https://www.northwindrobotics.com', fetchPage);
    expect(result.discoveredEmails).toEqual(['hello@northwindrobotics.com']);
  });

  it('preserves a non-standard port when normalizing a provided website', async () => {
    const fetchPage = makeFetch({
      'http://localhost:4001': '<html><body>Acme Test Co builds things</body></html>',
    });
    const result = await researchCompany('Acme Test Co', 'http://localhost:4001', fetchPage);
    expect(result.officialWebsite).toBe('http://localhost:4001');
    expect(result.confidence).toBe('HIGH');
  });

  it('never fabricates an official website when nothing resolves', async () => {
    const result = await researchCompany('Totally Unknown Corp', null, async () => null, {}, {
      searchEngines: [fakeEngine([])],
      aiModels: [],
      pageProbe: probeNever,
    });
    expect(result.officialWebsite).toBeNull();
    expect(result.signals.length).toBeGreaterThan(0);
  });
});

describe('findCompanyWebsite', () => {
  it('returns null immediately for an uncertain company name', async () => {
    const result = await findCompanyWebsite('CURRENT_COMPANY_UNCERTAIN', {}, {
      searchEngines: [fakeEngine(['https://example.com'])],
      aiModels: [],
    });
    expect(result.website).toBeNull();
    expect(result.queriesTried).toEqual([]);
  });

  it('filters out social/directory results and picks a company-matching domain', async () => {
    const engine = fakeEngine([
      'https://www.linkedin.com/company/celux',
      'https://www.crunchbase.com/organization/celux',
      'https://celux.co/',
    ]);
    const result = await findCompanyWebsite(
      'Celux',
      {},
      {
        searchEngines: [engine],
        aiModels: [],
        pageProbe: probeOnlyFor({ 'https://celux.co': 'Celux luxury fashion brand official homepage content' }),
      }
    );
    expect(result.website).toBe('https://celux.co');
    expect(result.confidence).toBe('MEDIUM');
  });

  it('includes the company location in the first query for disambiguation', async () => {
    const seenQueries: string[] = [];
    const engine: SearchEngine = async (query: string) => {
      seenQueries.push(query);
      return [];
    };
    await findCompanyWebsite(
      'Celux',
      { location: 'Adelaide, South Australia, Australia' },
      { searchEngines: [engine], aiModels: [], pageProbe: probeNever }
    );
    expect(seenQueries[0]).toContain('Adelaide, South Australia, Australia');
  });

  it('falls through to the next query when the first yields no usable candidates', async () => {
    let call = 0;
    const engine: SearchEngine = async () => {
      call += 1;
      if (call === 1) return ['https://www.linkedin.com/company/celux'];
      return ['https://celux.co/'];
    };
    const result = await findCompanyWebsite(
      'Celux',
      {},
      {
        searchEngines: [engine],
        aiModels: [],
        pageProbe: probeOnlyFor({ 'https://celux.co': 'Celux luxury fashion brand official homepage content' }),
      }
    );
    expect(result.website).toBe('https://celux.co');
    expect(call).toBeGreaterThan(1);
  });

  it('picks the candidate that matches the company name and location context over one that only resolves', async () => {
    const engine = fakeEngine(['https://celux.com/', 'https://celux.co/']);
    const result = await findCompanyWebsite(
      'Celux',
      { location: 'Adelaide, South Australia, Australia', about: 'Building a luxury fashion e-commerce platform.' },
      {
        searchEngines: [engine],
        aiModels: [],
        pageProbe: probeOnlyFor({
          'https://celux.com': 'Celux global retail concept operated internationally as a retail brand',
          'https://celux.co': 'Celux luxury fashion e-commerce, based in Adelaide, South Australia',
        }),
      }
    );
    expect(result.website).toBe('https://celux.co');
    expect(result.confidence).toBe('HIGH');
  });

  it('prefers a bot-protected candidate (403/challenge page) over an unrelated domain that resolves openly', async () => {
    // Mirrors a real-world case: the correct company's site returns a
    // Cloudflare 403 to non-browser requests, while an unrelated/parked
    // domain from a blind TLD guess returns 200 with no real content.
    const pageProbe: PageProbe = async (url: string) => {
      if (url === 'https://realcompany.com') {
        return { status: 403, text: 'Attention Required! Please enable cookies. Sorry, you have been blocked' };
      }
      if (url === 'https://realcompany.ai') {
        return { status: 200, text: '' };
      }
      return { status: null, text: '' };
    };
    const result = await findCompanyWebsite(
      'RealCompany',
      {},
      { searchEngines: [fakeEngine([])], aiModels: [], pageProbe }
    );
    expect(result.website).toBe('https://realcompany.com');
  });

  it('excludes a domain-for-sale parking page even though it echoes the company name', async () => {
    // Mirrors a real-world case: an unused guessed TLD variant sits at a
    // registrar's parking page ("freshworks.net for sale"), which echoes the
    // company name in its own text and would otherwise look like a match.
    const result = await findCompanyWebsite(
      'Freshworks',
      {},
      {
        searchEngines: [fakeEngine([])],
        aiModels: [],
        pageProbe: probeOnlyFor({
          'https://freshworks.net':
            'freshworks.net for sale | Spaceship.com Domain for sale freshworks.net Free transaction support',
        }),
      }
    );
    expect(result.website).not.toBe('https://freshworks.net');
    expect(result.confidence).toBe('LOW');
  });

  it('falls back to a guessed domain pattern when no search engine returns anything', async () => {
    const result = await findCompanyWebsite(
      'Northwind Robotics',
      {},
      {
        searchEngines: [fakeEngine([])],
        aiModels: [],
        pageProbe: probeOnlyFor({
          'https://northwindrobotics.com': 'Northwind Robotics builds autonomous robots for logistics customers',
        }),
      }
    );
    expect(result.website).toBe('https://northwindrobotics.com');
    expect(result.confidence).toBe('MEDIUM');
  });

  it('never returns a candidate that could not be verified as existing at all (no dummy/broken domains)', async () => {
    const result = await findCompanyWebsite(
      'Northwind Robotics',
      {},
      { searchEngines: [fakeEngine([])], aiModels: [], pageProbe: probeNever }
    );
    expect(result.website).toBeNull();
    expect(result.confidence).toBe('LOW');
  });

  it('uses AI-guessed domains as an extra candidate source', async () => {
    const aiModel = {
      invoke: async () => ({ content: '["celux.co"]' }),
    };
    const result = await findCompanyWebsite(
      'Celux',
      {},
      {
        searchEngines: [fakeEngine([])],
        aiModels: [aiModel],
        pageProbe: probeOnlyFor({ 'https://celux.co': 'Celux luxury fashion brand official homepage content' }),
      }
    );
    expect(result.website).toBe('https://celux.co');
  });

  it('never fabricates a website for a company with no discoverable web presence', async () => {
    const result = await findCompanyWebsite('', {}, { searchEngines: [fakeEngine([])], aiModels: [] });
    expect(result.website).toBeNull();
  });
});
