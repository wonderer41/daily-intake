// Turns the hand-drawn logo (src/app/icon.svg, the source of truth) into the two raster icons Next.js
// serves next to it: favicon.ico (16 + 32 px, for browsers without SVG favicons) and apple-icon.png
// (180 px, the iPhone home-screen icon). Rerun after changing icon.svg.
// Usage: npm run icons:generate
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";

const APP_DIR = path.join(process.cwd(), "src", "app");
const SOURCE = path.join(APP_DIR, "icon.svg");
const VIEWBOX = 64;
const FAVICON_SIZES = [16, 32];
const APPLE_SIZE = 180;
// The tile colour in icon.svg. iOS rounds the corners itself and shows transparency as black, so the
// home-screen icon is filled edge to edge with it.
const TILE = "#0b0e1c";

/** The logo rasterised straight at `px` (not scaled down from a big render, which blurs small sizes). */
function render(svg: Buffer, px: number): Sharp {
  return sharp(svg, { density: (72 * px) / VIEWBOX }).resize(px, px);
}

/** An .ico holding PNG images (supported by every current browser and Windows since Vista). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

async function main(): Promise<void> {
  const svg = await readFile(SOURCE);

  const images = await Promise.all(
    FAVICON_SIZES.map(async (size) => ({ size, png: await render(svg, size).png().toBuffer() })),
  );
  const favicon = path.join(APP_DIR, "favicon.ico");
  const icoFile = ico(images);
  await writeFile(favicon, icoFile);
  console.log(`favicon.ico     ${FAVICON_SIZES.join(" + ")} px · ${(icoFile.length / 1024).toFixed(1)} KB → ${path.relative(process.cwd(), favicon)}`);

  const apple = path.join(APP_DIR, "apple-icon.png");
  const png = await render(svg, APPLE_SIZE).flatten({ background: TILE }).png().toBuffer();
  await writeFile(apple, png);
  console.log(`apple-icon.png  ${APPLE_SIZE} px · ${(png.length / 1024).toFixed(1)} KB → ${path.relative(process.cwd(), apple)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
