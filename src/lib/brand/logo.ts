/**
 * The LeadForge mark: an "L" (lead) with a spark (forge/AI) in its open corner,
 * drawn on a 32×32 grid. This file is the single source of the logo. The
 * sidebar mark, the social cards and every icon in public/ are drawn from it
 * (public/ via `npm run brand:assets`).
 *
 * No path aliases here: scripts/generate-brand-assets.ts imports this file
 * directly through ts-node.
 */

export const LOGO_GRADIENT = { from: '#6366F1', to: '#7C3AED' } as const;

export const LOGO_STROKE_PATH = 'M10 9.5V22.5H21';
export const LOGO_STROKE_WIDTH = 3.5;
export const LOGO_SPARK_PATH =
  'M20 7.75Q20.95 11.55 24.75 12.5Q20.95 13.45 20 17.25Q19.05 13.45 15.25 12.5Q19.05 11.55 20 7.75Z';

/**
 * - `rounded`: the app-icon tile with rounded corners (favicons, PWA "any" icons, social cards).
 * - `square`: full-bleed tile for platforms that round the corners themselves (Apple touch icons).
 * - `maskable`: full-bleed tile with the glyph inside the 80% safe zone (Android adaptive icons).
 * - `monochrome`: white glyph on transparent, for Android themed icons.
 * - `mask`: black glyph on transparent, for Safari pinned tabs.
 */
export type LogoVariant = 'rounded' | 'square' | 'maskable' | 'monochrome' | 'mask';

function glyph(color: string, scale = 1): string {
  const paths =
    `<path d="${LOGO_STROKE_PATH}" stroke="${color}" stroke-width="${LOGO_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${LOGO_SPARK_PATH}" fill="${color}"/>`;
  return scale === 1 ? paths : `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${paths}</g>`;
}

/** The logo as a standalone SVG document, `size` pixels square. */
export function logoSvg(variant: LogoVariant = 'rounded', size = 32): string {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">`;

  if (variant === 'monochrome') return `${open}${glyph('#FFFFFF', 0.8)}</svg>`;
  if (variant === 'mask') return `${open}${glyph('#000000')}</svg>`;

  const gradient =
    '<defs><linearGradient id="lf-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">' +
    `<stop stop-color="${LOGO_GRADIENT.from}"/><stop offset="1" stop-color="${LOGO_GRADIENT.to}"/>` +
    '</linearGradient></defs>';
  const radius = variant === 'rounded' ? ' rx="8"' : '';
  const tile = `<rect width="32" height="32"${radius} fill="url(#lf-bg)"/>`;

  return `${open}${gradient}${tile}${glyph('#FFFFFF', variant === 'maskable' ? 0.8 : 1)}</svg>`;
}

/** The logo as a data: URI, for <img> tags in generated social cards. */
export function logoDataUri(variant: LogoVariant = 'rounded', size = 32): string {
  return `data:image/svg+xml;base64,${btoa(logoSvg(variant, size))}`;
}
