import { researchCompany, type FetchPage } from '../research';

function makeFetch(pages: Record<string, string>): FetchPage {
  return async (url: string) => pages[url] ?? null;
}

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
      'https://www.northwindrobotics.com': '<html><body>Northwind Robotics</body></html>',
    });
    const result = await researchCompany('Northwind Robotics', null, fetchPage);
    expect(result.officialWebsite).toBe('https://www.northwindrobotics.com');
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

  it('never fabricates an official website when nothing resolves', async () => {
    const result = await researchCompany('Totally Unknown Corp', null, async () => null);
    expect(result.officialWebsite).toBeNull();
    expect(result.signals.length).toBeGreaterThan(0);
  });
});
