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

  it('crawls homepage and subpages, extracting and filtering emails', async () => {
    // 1. Mock Homepage fetch
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/html' },
      text: jest.fn().mockResolvedValue(`
        <html>
          <body>
            <h1>Welcome to Acme Corp</h1>
            <p>For support, mailto:support@acme.com</p>
            <a href="/about-us">About Us</a>
            <a href="/contact">Get in Touch</a>
            <a href="https://external.com/faq">FAQ</a>
            <!-- Tracker email to filter -->
            <p>Tracker: test@google-analytics.com</p>
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

    // Verify it crawled the homepage, /about-us, and /contact
    expect(globalFetchMock).toHaveBeenCalledTimes(3);

    // Verify emails were extracted and deduplicated
    expect(result).toContain('support@acme.com');
    expect(result).toContain('jane.doe@acme.com');
    expect(result).toContain('info@acme.com');

    // Verify tracker emails were successfully filtered out
    expect(result).not.toContain('test@google-analytics.com');
  });

  it('fails gracefully when website is unreachable', async () => {
    globalFetchMock.mockRejectedValueOnce(new Error('DNS Resolution Failed'));

    const result = await findEmailsOnWebsite('https://dead-domain.com');
    expect(result).toEqual([]);
    expect(globalFetchMock).toHaveBeenCalledTimes(1);
  });
});
