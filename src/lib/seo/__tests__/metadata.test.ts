/** @jest-environment node */
import { absoluteUrl, getSiteUrl, getTwitterHandle, isIndexingAllowed } from '@/lib/config/site';
import { OG_IMAGE, PRIVATE_ROBOTS, ogImageFor, pageMetadata, siteRobots } from '../metadata';
import { OG_PAGE_PATHS, pageCardContent } from '../ogPages';

const ENV_KEYS = [
  'NEXT_PUBLIC_APP_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
  'ALLOW_SEARCH_INDEXING',
  'SITE_TWITTER_HANDLE',
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('getSiteUrl', () => {
  it('uses NEXT_PUBLIC_APP_URL without a trailing slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://leads.example.com/';
    expect(getSiteUrl()).toBe('https://leads.example.com');
    expect(absoluteUrl('/dashboard')).toBe('https://leads.example.com/dashboard');
  });

  it('adds https:// when the protocol is missing', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'leads.example.com';
    expect(getSiteUrl()).toBe('https://leads.example.com');
  });

  it('falls back to the Vercel production domain, then the deployment URL', () => {
    process.env.VERCEL_URL = 'leadforge-git-main.vercel.app';
    expect(getSiteUrl()).toBe('https://leadforge-git-main.vercel.app');

    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'leadforge.vercel.app';
    expect(getSiteUrl()).toBe('https://leadforge.vercel.app');

    process.env.NEXT_PUBLIC_APP_URL = 'https://leads.example.com';
    expect(getSiteUrl()).toBe('https://leads.example.com');
  });

  it('falls back to localhost when unset', () => {
    expect(getSiteUrl()).toBe('http://localhost:3000');
  });
});

describe('indexing', () => {
  it('is off by default, so every page is noindex', () => {
    expect(isIndexingAllowed()).toBe(false);
    expect(siteRobots()).toEqual(PRIVATE_ROBOTS);
  });

  it('is on only with ALLOW_SEARCH_INDEXING=true', () => {
    process.env.ALLOW_SEARCH_INDEXING = 'yes';
    expect(isIndexingAllowed()).toBe(false);

    process.env.ALLOW_SEARCH_INDEXING = 'true';
    expect(isIndexingAllowed()).toBe(true);
    expect(siteRobots()).toMatchObject({ index: true, follow: true });
  });
});

describe('getTwitterHandle', () => {
  it('is undefined when unset and always has one leading @', () => {
    expect(getTwitterHandle()).toBeUndefined();
    process.env.SITE_TWITTER_HANDLE = 'leadforge';
    expect(getTwitterHandle()).toBe('@leadforge');
    process.env.SITE_TWITTER_HANDLE = '@@leadforge';
    expect(getTwitterHandle()).toBe('@leadforge');
  });
});

describe('social cards', () => {
  it('gives every sidebar page its own card', () => {
    expect(OG_PAGE_PATHS).toEqual(
      expect.arrayContaining(['/dashboard', '/lead-ingestion', '/my-leads', '/lead-ingestion/campaigns'])
    );
    expect(pageCardContent('/lead-ingestion/campaigns')).toMatchObject({
      section: 'Outreach',
      title: 'Campaigns',
      url: 'localhost:3000/lead-ingestion/campaigns',
    });
  });

  it('falls back to the site-wide card for other pages', () => {
    expect(pageCardContent('/process')).toBeUndefined();
    expect(pageCardContent('/lead-ingestion/campaigns/abc')).toBeUndefined();
    expect(ogImageFor('/', 'LeadForge')).toBe(OG_IMAGE);
    expect(ogImageFor('/process', 'Process Lead')).toBe(OG_IMAGE);
  });
});

describe('pageMetadata', () => {
  it('sets title, canonical and full Open Graph and Twitter tags with the page card', () => {
    const meta = pageMetadata({ title: 'Drafts', description: 'Review emails.', path: '/lead-ingestion/emails' });
    const image = {
      url: '/og/lead-ingestion/emails',
      width: 1200,
      height: 630,
      type: 'image/png',
      alt: 'Drafts · LeadForge',
    };

    expect(meta.title).toBe('Drafts');
    expect(meta.alternates).toEqual({ canonical: '/lead-ingestion/emails' });
    expect(meta.openGraph).toMatchObject({
      title: 'Drafts · LeadForge',
      description: 'Review emails.',
      url: '/lead-ingestion/emails',
      siteName: 'LeadForge',
      type: 'website',
      images: [image],
    });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', images: [image] });
  });

  it('uses the site-wide card for pages without their own', () => {
    const meta = pageMetadata({ title: 'Process Lead', description: 'x', path: '/process' });
    expect(meta.openGraph).toMatchObject({ images: [OG_IMAGE] });
    expect(meta.twitter).toMatchObject({ images: [OG_IMAGE] });
  });

  it('supports an absolute title', () => {
    const meta = pageMetadata({ title: 'LeadForge', description: 'x', path: '/', absoluteTitle: true });
    expect(meta.title).toEqual({ absolute: 'LeadForge' });
  });
});
