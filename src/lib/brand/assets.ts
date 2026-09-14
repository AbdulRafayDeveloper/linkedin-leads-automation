import type { LogoVariant } from './logo';

/**
 * Every logo file served from public/. scripts/generate-brand-assets.ts writes
 * exactly these files; the root metadata, the web manifest and a test that
 * checks each file exists all read the paths from here.
 *
 * No path aliases here (see logo.ts).
 */

export interface BrandPng {
  /** URL path under public/, e.g. "/favicon-32x32.png". */
  path: string;
  size: number;
  variant: LogoVariant;
}

const FAVICON_SIZES = [16, 32, 48] as const;
const APPLE_TOUCH_SIZES = [180, 167, 152, 120] as const;
const PWA_ICON_SIZES = [48, 72, 96, 128, 144, 192, 256, 384, 512] as const;

/** Browser tab icons. */
export const FAVICON_PNGS: BrandPng[] = [
  ...FAVICON_SIZES.map((size) => ({ path: `/favicon-${size}x${size}.png`, size, variant: 'rounded' as const })),
  { path: '/favicon.png', size: 32, variant: 'rounded' },
];

/** Multi-size ICO for old browsers and tools that only request /favicon.ico. */
export const FAVICON_ICO = { path: '/favicon.ico', sizes: [...FAVICON_SIZES] };

/** Scalable tab icon for modern browsers. */
export const FAVICON_SVG = '/favicon.svg';

/** Single-color glyph for Safari pinned tabs. */
export const MASK_ICON_SVG = '/safari-pinned-tab.svg';

/** iOS and iPadOS home screen icons. iOS rounds the corners, so they are full-bleed. */
export const APPLE_TOUCH_PNGS: BrandPng[] = [
  { path: '/apple-touch-icon.png', size: 180, variant: 'square' },
  ...APPLE_TOUCH_SIZES.map((size) => ({
    path: `/apple-touch-icon-${size}x${size}.png`,
    size,
    variant: 'square' as const,
  })),
];

/** PWA and Android icons (manifest purpose "any"). */
export const PWA_ICON_PNGS: BrandPng[] = PWA_ICON_SIZES.map((size) => ({
  path: `/icons/icon-${size}x${size}.png`,
  size,
  variant: 'rounded' as const,
}));

/** Android adaptive icons (manifest purpose "maskable"). */
export const MASKABLE_ICON_PNGS: BrandPng[] = [
  { path: '/icons/maskable-icon.png', size: 192, variant: 'maskable' },
  { path: '/icons/maskable-icon-512x512.png', size: 512, variant: 'maskable' },
];

/** Android themed icon (manifest purpose "monochrome"). */
export const MONOCHROME_ICON_PNG: BrandPng = {
  path: '/icons/monochrome-icon.png',
  size: 512,
  variant: 'monochrome',
};

export const ALL_BRAND_PNGS: BrandPng[] = [
  ...FAVICON_PNGS,
  ...APPLE_TOUCH_PNGS,
  ...PWA_ICON_PNGS,
  ...MASKABLE_ICON_PNGS,
  MONOCHROME_ICON_PNG,
];

/** Social preview cards (src/lib/brand/ogCard.tsx): the size every platform accepts. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 };
export const OG_IMAGE_TYPE = 'image/png';

/** The icon used where a single raster logo is needed (JSON-LD, Windows tiles). */
export const LOGO_PNG_512 = '/icons/icon-512x512.png';
export const TILE_PNG_144 = '/icons/icon-144x144.png';

/** The HTML/manifest `sizes` value, e.g. "192x192". */
export function pngSizes(png: Pick<BrandPng, 'size'>): string {
  return `${png.size}x${png.size}`;
}
