// Some company sites render their contact/footer content (including mailto
// links) client-side via JavaScript, so a plain fetch() only ever sees an
// empty shell. As a last-resort fallback, render the page in a real headless
// browser and return the fully rendered HTML. This is optional and must
// never crash the crawl: if Playwright or its browser binary isn't
// available in the current runtime (e.g. a serverless deployment without
// the Chromium binary installed), every call simply returns null and the
// caller falls back to whatever the plain fetch already found.
let browserUnavailable = false;

export async function fetchRenderedHtml(url: string, timeoutMs = 15000): Promise<string | null> {
  if (browserUnavailable) return null;

  let browser;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch();
  } catch {
    browserUnavailable = true;
    return null;
  }

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    return await page.content();
  } catch {
    return null;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
