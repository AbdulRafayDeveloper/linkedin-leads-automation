import type { MetadataRoute } from 'next';
import { NAV_SECTIONS, SETTINGS_ITEM } from '@/components/sidebar/navigation';
import { absoluteUrl, isIndexingAllowed } from '@/lib/config/site';

// Every static page. Lead and campaign detail pages are private and left out.
// Empty while indexing is off, so it never lists pages tagged noindex.
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isIndexingAllowed()) return [];

  const navPaths = [...NAV_SECTIONS.flatMap((section) => section.items), SETTINGS_ITEM].map(
    (item) => item.href
  );
  const paths = Array.from(new Set(['/', ...navPaths, '/process']));
  const lastModified = new Date();

  return paths.map((path) => ({
    url: absoluteUrl(path),
    lastModified,
    changeFrequency: 'weekly',
    priority: path === '/' ? 1 : path === '/process' ? 0.5 : 0.8,
  }));
}
