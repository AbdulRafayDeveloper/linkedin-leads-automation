export const SITE_NAME = 'LeadForge';

/** Short line shown under the logo (sidebar, footer). */
export const SITE_TAGLINE = 'AI outreach for LinkedIn leads';

/** Where the logo links: the app's home page (also the PWA start_url). */
export const APP_HOME_PATH = '/dashboard';

export const SITE_TITLE = 'LeadForge: LinkedIn Lead Research and Cold Email Outreach';

export const SITE_DESCRIPTION =
  'Turn LinkedIn and Sales Navigator profiles into verified contact emails and personalized cold outreach. LeadForge extracts leads with AI, crawls company websites, verifies emails over SMTP and sends campaigns.';

export const SITE_IMAGE_ALT =
  'LeadForge turns LinkedIn profiles into verified contact emails and personalized cold outreach';

export const SITE_KEYWORDS = [
  'LinkedIn lead generation',
  'Sales Navigator',
  'cold email outreach',
  'email finder',
  'email verification',
  'SMTP verification',
  'AI email writer',
  'personalized outreach',
  'lead research',
  'email campaigns',
];

/** Browser UI color (address bar, PWA title bar). Matches the white app header. */
export const THEME_COLOR = '#ffffff';

/** PWA splash screen background. Matches the app's slate-50 page background. */
export const BACKGROUND_COLOR = '#f8fafc';

/** Brand accent, used where a platform tints the logo (Safari pinned tab, Windows tile). */
export const BRAND_COLOR = '#4f46e5';

const FALLBACK_URL = 'http://localhost:3000';

/**
 * The public base URL of the app. Used for canonical links, Open Graph URLs,
 * the sitemap and tracking pixels. Has no trailing slash.
 *
 * Order: NEXT_PUBLIC_APP_URL, then the Vercel production domain, then the
 * Vercel deployment URL (preview builds), then localhost.
 */
export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    FALLBACK_URL;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).toString().replace(/\/+$/, '');
  } catch {
    return FALLBACK_URL;
  }
}

/** Absolute URL for a path on this app, e.g. absoluteUrl('/dashboard'). */
export function absoluteUrl(path = '/'): string {
  return `${getSiteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Whether search engines may index the app. Off unless ALLOW_SEARCH_INDEXING=true:
 * there is no login and the pages show lead emails and phone numbers. Link
 * previews (LinkedIn, X, Slack, WhatsApp…) work either way.
 */
export function isIndexingAllowed(): boolean {
  return process.env.ALLOW_SEARCH_INDEXING?.trim().toLowerCase() === 'true';
}

/** The X/Twitter handle for twitter:site and twitter:creator, e.g. "@leadforge". Optional. */
export function getTwitterHandle(): string | undefined {
  const raw = process.env.SITE_TWITTER_HANDLE?.trim().replace(/^@+/, '');
  return raw ? `@${raw}` : undefined;
}
