/**
 * Regenerates every logo file in public/ from src/lib/brand/logo.ts.
 * Run after changing the logo:  npm run brand:assets
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { logoSvg, type LogoVariant } from '../src/lib/brand/logo';
import { ALL_BRAND_PNGS, FAVICON_ICO, FAVICON_SVG, MASK_ICON_SVG } from '../src/lib/brand/assets';

const PUBLIC_DIR = join(__dirname, '..', 'public');

async function write(urlPath: string, data: Buffer | string): Promise<void> {
  const file = join(PUBLIC_DIR, urlPath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
  console.log(`  ${urlPath}`);
}

// The SVG is drawn at the target size, so every PNG is rendered from vectors, not downscaled.
function renderPng(variant: LogoVariant, size: number): Promise<Buffer> {
  return sharp(Buffer.from(logoSvg(variant, size)))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/** An ICO file that embeds one PNG per size (supported by every current browser). */
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

async function main(): Promise<void> {
  console.log('Writing brand assets to public/:');

  await write(FAVICON_SVG, `${logoSvg('rounded')}\n`);
  await write(MASK_ICON_SVG, `${logoSvg('mask', 16)}\n`);

  for (const png of ALL_BRAND_PNGS) {
    await write(png.path, await renderPng(png.variant, png.size));
  }

  const icoImages = await Promise.all(
    FAVICON_ICO.sizes.map(async (size) => ({ size, png: await renderPng('rounded', size) }))
  );
  await write(FAVICON_ICO.path, buildIco(icoImages));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
