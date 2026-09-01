import { findEmailsOnWebsite } from '../emailFinder';

describe('emailFinder crawler', () => {
  let globalFetchMock: jest.Mock;

  beforeEach(() => {
    globalFetchMock = jest.fn();
    global.fetch = globalFetchMock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('crawls homepage and subpages, extracting emails and phone numbers', async () => {
    // 1. Mock Homepage fetch
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/html' },
      text: jest.fn().mockResolvedValue(`
        <html>
          <body>
            <h1>Welcome to Acme Corp</h1>
            <p>For support, mailto:support@acme.com</p>
            <p>Call us: +1 (555) 019-2834</p>
            <a href="/about-us">About Us</a>
            <a href="/contact">Get in Touch</a>
          </body>
        </html>
      `),
    });

    // 2. Mock /about-us subpage fetch
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/html' },
      text: jest.fn().mockResolvedValue(`
        <html>
          <body>
            <p>Our founder is CEO Jane Doe (jane.doe@acme.com).</p>
          </body>
        </html>
      `),
    });

    // 3. Mock /contact subpage fetch
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/html' },
      text: jest.fn().mockResolvedValue(`
        <html>
          <body>
            <p>Call sales at info@acme.com</p>
          </body>
        </html>
      `),
    });

    const result = await findEmailsOnWebsite('https://acme.com');

    // Verify emails were extracted
    expect(result.emails).toContain('support@acme.com');
    expect(result.emails).toContain('jane.doe@acme.com');
    expect(result.emails).toContain('info@acme.com');

    // Verify phone was extracted
    expect(result.phones.length).toBeGreaterThan(0);
  });

  it('fails gracefully when website is unreachable', async () => {
    globalFetchMock.mockRejectedValue(new Error('DNS Resolution Failed'));

    const result = await findEmailsOnWebsite('https://dead-domain.com');
    expect(result.emails).toEqual([]);
    expect(result.phones).toEqual([]);
  });
});
