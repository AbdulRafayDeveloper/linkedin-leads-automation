import { NAV_SECTIONS, SETTINGS_ITEM, getActiveNav } from '@/components/sidebar/navigation';
import { absoluteUrl } from '@/lib/config/site';
import type { PageCardContent } from '@/lib/brand/ogCard';

// Pages with their own social card: every sidebar page. The card shows the
// sidebar name and description, so the two never drift apart. Other pages
// (home, detail pages, legacy pages) use the site-wide card.

export const OG_PAGE_PATHS: string[] = [
  ...NAV_SECTIONS.flatMap((section) => section.items),
  SETTINGS_ITEM,
].map((item) => item.href);

export function hasPageCard(path: string): boolean {
  return OG_PAGE_PATHS.includes(path);
}

/** URL path of a page's card, served by src/app/og/[...slug]/route.tsx. */
export function pageCardPath(path: string): string {
  return `/og${path}`;
}

export function pageCardContent(path: string): PageCardContent | undefined {
  const active = hasPageCard(path) ? getActiveNav(path) : null;
  if (!active || active.isDetail) return undefined;

  return {
    section: active.section,
    title: active.item.label,
    description: active.item.description,
    url: absoluteUrl(path).replace(/^https?:\/\//, ''),
  };
}
