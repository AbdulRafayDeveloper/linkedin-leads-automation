/** @jest-environment node */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '@/app/manifest';
import { BRAND_ICONS } from '@/lib/seo/metadata';
import { ALL_BRAND_PNGS, FAVICON_ICO, FAVICON_SVG, MASK_ICON_SVG } from '../assets';
import { logoSvg } from '../logo';

const PUBLIC_DIR = join(process.cwd(), 'public');
const publicFile = (urlPath: string) => join(PUBLIC_DIR, urlPath);

/** Width and height from a PNG's IHDR chunk. */
function pngDimensions(file: string): { width: number; height: number } {
  const data = readFileSync(file);
  expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

type IconEntry = string | URL | { url: string | URL; sizes?: string };

function iconUrls(entries: IconEntry | IconEntry[] | undefined): string[] {
  const list = entries === undefined ? [] : Array.isArray(entries) ? entries : [entries];
  return list.map((entry) => String(typeof entry === 'object' && 'url' in entry ? entry.url : entry));
}

describe('brand assets in public/', () => {
  it('has every generated PNG at its declared size', () => {
    for (const png of ALL_BRAND_PNGS) {
      const file = publicFile(png.path);
      expect({ path: png.path, exists: existsSync(file) }).toEqual({ path: png.path, exists: true });
      expect(pngDimensions(file)).toEqual({ width: png.size, height: png.size });
    }
  });

  it('has the SVG icons and a multi-size ICO', () => {
    expect(readFileSync(publicFile(FAVICON_SVG), 'utf8')).toContain('<svg');
    expect(readFileSync(publicFile(MASK_ICON_SVG), 'utf8')).toContain('<svg');

    const ico = readFileSync(publicFile(FAVICON_ICO.path));
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16]);
    expect(sizes).toEqual(FAVICON_ICO.sizes);
  });

  it('points every icon link tag at a file that exists', () => {
    const icons = BRAND_ICONS as Exclude<typeof BRAND_ICONS, string | URL | unknown[] | null | undefined>;
    const urls = [
      ...iconUrls(icons.icon as IconEntry[]),
      ...iconUrls(icons.shortcut as IconEntry[]),
      ...iconUrls(icons.apple as IconEntry[]),
      ...iconUrls(icons.other as IconEntry[]),
    ];
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) expect({ url, exists: existsSync(publicFile(url)) }).toEqual({ url, exists: true });
  });

  it('points every manifest icon and shortcut icon at a file that exists', () => {
    const { icons = [], shortcuts = [] } = manifest();
    const srcs = [...icons, ...shortcuts.flatMap((shortcut) => shortcut.icons ?? [])].map((icon) => icon.src);
    for (const src of srcs) expect({ src, exists: existsSync(publicFile(src)) }).toEqual({ src, exists: true });

    const purposes = icons.map((icon) => `${icon.sizes} ${icon.purpose}`);
    expect(purposes).toEqual(
      expect.arrayContaining(['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable'])
    );
  });

  it('ships none of the create-next-app placeholder assets', () => {
    for (const file of ['next.svg', 'vercel.svg', 'file.svg', 'globe.svg', 'window.svg']) {
      expect(existsSync(publicFile(`/${file}`))).toBe(false);
    }
    expect(existsSync(join(process.cwd(), 'src/app/favicon.ico'))).toBe(false);
  });
});

describe('logoSvg', () => {
  it('draws each variant from the same glyph', () => {
    expect(logoSvg('rounded')).toContain('rx="8"');
    expect(logoSvg('square')).not.toContain('rx=');
    expect(logoSvg('maskable')).toContain('scale(0.8)');
    expect(logoSvg('monochrome')).not.toContain('<rect');
    expect(logoSvg('mask')).toContain('#000000');
    expect(logoSvg('rounded', 180)).toContain('width="180" height="180"');
  });
});
