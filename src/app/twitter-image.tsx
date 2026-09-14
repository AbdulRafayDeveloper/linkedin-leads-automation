import { SITE_IMAGE_ALT } from '@/lib/config/site';
import { OG_IMAGE_SIZE, OG_IMAGE_TYPE } from '@/lib/brand/assets';
import { renderBrandCard } from '@/lib/brand/ogCard';

// Same card as opengraph-image, so X shows the logo even where a page sets no twitter:image.
export const alt = SITE_IMAGE_ALT;
export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_TYPE;

export default function Image() {
  return renderBrandCard();
}
