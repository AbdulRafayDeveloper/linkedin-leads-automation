import { SITE_IMAGE_ALT } from '@/lib/config/site';
import { OG_IMAGE_SIZE, OG_IMAGE_TYPE } from '@/lib/brand/assets';
import { renderBrandCard } from '@/lib/brand/ogCard';

// The site-wide social card: lead and campaign detail pages and any page
// without its own card (see ogImageFor in lib/seo/metadata).
export const alt = SITE_IMAGE_ALT;
export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_TYPE;

export default function Image() {
  return renderBrandCard();
}
