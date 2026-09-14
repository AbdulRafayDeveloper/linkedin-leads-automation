import type { MetadataRoute } from 'next';
import { absoluteUrl, isIndexingAllowed } from '@/lib/config/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // Pages stay crawlable even when indexing is off: link-preview bots (X,
      // LinkedIn, Slack…) honor robots.txt and need the page and its card. The
      // noindex meta tag is what keeps pages out of search results.
      allow: '/',
      // Blocking the API also keeps crawlers from loading lead data while they
      // render the (client-side) pages. Detail pages carry a noindex tag too.
      disallow: '/api/',
    },
    ...(isIndexingAllowed() && { sitemap: absoluteUrl('/sitemap.xml') }),
  };
}
