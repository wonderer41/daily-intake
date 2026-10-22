// Paints the palette-knife backgrounds for the themes, in the style of the original Water Lilies
// painting: dense horizontal knife strokes with cast shadows, ridges and colour streaks, lilac "sky"
// patches, vertical willow reflections and lily-pad rafts with flowers. Colours come from each
// theme's tokens (src/lib/appearance/themes.ts); a fixed seed per theme makes every run identical.
// Desktop first: one 2560×1600 landscape image per theme (phones crop it), plus a 320px picker preview.
// Usage: npm run backgrounds:generate -- [theme ...]   (no ids = every theme except water-lilies)
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { THEMES, type Theme, type ThemeId } from "@/lib/appearance/themes";

const WIDTH = 2560;
const HEIGHT = 1600;
const OUT_DIR = path.join(process.cwd(), "public", "backgrounds");
const ORIGINAL = path.join(OUT_DIR, "background-palette-knife-2560.webp");

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16)) as Rgb;
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** `a` moved toward `b` by `t` (0 = a, 1 = b). */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * t) as Rgb);
}

/** Small seeded PRNG (mulberry32): the same seed paints the same picture. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

interface Palette {
  ground: string;
  water: string[];
  sky: string[];
  willow: string[];
  raft: string[];
  flower: string;
  shadow: string;
  ridge: string;
}

function paletteOf(theme: Theme): Palette {
  const c = theme.colors;
  return {
    ground: mix(c["deep-water"], c.pond, 0.4),
    water: [
      c["deep-water"],
      mix(c["deep-water"], c.pond, 0.3),
      mix(c["deep-water"], c["lily-pad"], 0.45),
      mix(c["lily-pad"], c.pond, 0.35),
      mix(c["deep-water"], c.lilac, 0.18),
      mix(c["deep-water"], c.green, 0.15),
      mix(c["deep-water"], c.pond, 0.55),
    ],
    sky: [mix(c.lilac, c["deep-water"], 0.55), mix(c.lilac, c["deep-water"], 0.42), mix(c.lilac, c.pond, 0.58)],
    willow: [mix(c["lily-pad"], c.pond, 0.5), mix(c["lily-pad"], c.pond, 0.35), mix(c["deep-water"], c.pond, 0.45)],
    raft: [mix(c.green, c["lily-pad"], 0.55), mix(c.green, c["lily-pad"], 0.75), mix(c.green, c["deep-water"], 0.6), mix(c.reflection, c["lily-pad"], 0.6)],
    flower: c["lily-pink"],
    shadow: c.shadow,
    ridge: c["ink-light"],
  };
}

/** Smooth 2D noise from a few seeded sine waves, roughly in [-1, 1]: decides where the patches go. */
function field(rand: () => number, waves = 5): (x: number, y: number) => number {
  const parts = Array.from({ length: waves }, () => ({
    fx: (0.4 + rand() * 1.6) / WIDTH,
    fy: (1.5 + rand() * 4) / HEIGHT,
    phase: rand() * Math.PI * 2,
    weight: 0.5 + rand(),
  }));
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  return (x, y) => parts.reduce((sum, p) => sum + p.weight * Math.sin((x * p.fx + y * p.fy) * Math.PI * 2 + p.phase), 0) / total;
}

const f = (n: number) => n.toFixed(1);

/** The same colour a little lighter or darker, so neighbouring slabs never match exactly. */
function jitter(rand: () => number, color: string): string {
  const amount = (rand() - 0.5) * 0.16;
  return amount > 0 ? mix(color, "#ffffff", amount) : mix(color, "#000000", -amount);
}

/** One knife mark: a long, slightly curved, rounded-triangle slab with a cast shadow, a ridge and streaks. */
function knifeMark(rand: () => number, x: number, y: number, length: number, thickness: number, angle: number, fill: string, palette: Palette): string {
  const skew = (rand() - 0.5) * thickness * 0.8;
  const bow = (rand() - 0.3) * thickness * 0.6;
  const tip = thickness * (0.25 + rand() * 0.35);
  // Thick, squarish start; the far end narrows to a rounded tip.
  const shape = [
    `M0,0`,
    `Q${f(length * 0.5)},${f(-bow)} ${f(length)},${f(skew)}`,
    `Q${f(length + tip)},${f(skew + tip * 0.5)} ${f(length - tip * 0.4)},${f(skew + tip)}`,
    `Q${f(length * 0.45)},${f(thickness + bow * 0.4)} ${f(thickness * 0.3)},${f(thickness)}`,
    `Q${f(-thickness * 0.25)},${f(thickness * 0.5)} 0,0`,
    "Z",
  ].join(" ");
  const ridge = `M${f(thickness * 0.2)},${f(1.2)} Q${f(length * 0.5)},${f(-bow + 1.2)} ${f(length - tip)},${f(skew + 1.2)}`;
  const streaks = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => {
    const at = thickness * (0.3 + rand() * 0.5);
    const start = length * rand() * 0.3;
    const end = length * (0.55 + rand() * 0.35);
    const tone = mix(fill, palette.ridge, 0.18 + rand() * 0.18);
    return `<path d="M${f(start)},${f(at)} Q${f((start + end) / 2)},${f(at + (rand() - 0.5) * 6)} ${f(end)},${f(at + (rand() - 0.5) * 4)}" stroke="${tone}" stroke-width="${f(1 + rand() * 1.4)}" fill="none" opacity="0.55"/>`;
  }).join("");
  return [
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)})">`,
    `<path d="${shape}" transform="translate(4 6)" fill="${palette.shadow}" opacity="0.6"/>`,
    `<path d="${shape}" fill="${jitter(rand, fill)}"/>`,
    // Light catching the upper half of the slab: the paint is thick there.
    `<path d="${shape}" transform="scale(1 0.48)" fill="${mix(fill, palette.ridge, 0.22)}" opacity="0.35"/>`,
    streaks,
    `<path d="${ridge}" stroke="${mix(fill, palette.ridge, 0.45)}" stroke-width="2" fill="none" opacity="0.55"/>`,
    `<path d="${shape}" fill="none" stroke="${palette.shadow}" stroke-width="1.2" opacity="0.3"/>`,
    "</g>",
  ].join("");
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

export function paintingSvg(theme: Theme): string {
  const rand = random(seedOf(theme.id));
  const palette = paletteOf(theme);
  const skyField = field(rand);
  const tintField = field(rand, 4);
  const marks: string[] = [];

  // 1. Water: rows of horizontal marks covering everything; lilac where the sky field is high.
  for (let y = -30; y < HEIGHT + 30; y += 22 + rand() * 12) {
    for (let x = -200 + rand() * 120; x < WIDTH + 40; x += 120 + rand() * 140) {
      const sky = skyField(x, y) > 0.3 + rand() * 0.18;
      const tone = sky ? pick(rand, palette.sky) : palette.water[Math.floor(((tintField(x, y) + 1) / 2) * palette.water.length * 0.999 + (rand() - 0.5) * 1.6 + palette.water.length) % palette.water.length];
      marks.push(knifeMark(rand, x, y, 170 + rand() * 210, 26 + rand() * 22, (rand() - 0.5) * 7, tone, palette));
    }
  }

  // 2. Willow reflections: tall vertical columns of darker marks hanging from the top.
  const willows = 8 + Math.floor(rand() * 4);
  for (let i = 0; i < willows; i += 1) {
    const cx = rand() * WIDTH;
    const depth = HEIGHT * (0.3 + rand() * 0.45);
    const width = 30 + rand() * 40;
    for (let y = -60; y < depth; y += 32 + rand() * 30) {
      for (let k = 0; k < 2; k += 1) {
        const x = cx + (rand() - 0.5) * width + Math.sin(y / 90) * 8;
        const tone = rand() < 0.25 ? pick(rand, palette.sky) : pick(rand, palette.willow);
        marks.push(knifeMark(rand, x, y, 120 + rand() * 140, 26 + rand() * 18, 88 + (rand() - 0.5) * 8, tone, palette));
      }
    }
  }

  // 3. Lily-pad rafts: clusters of short marks with flowers on top.
  const rafts = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < rafts; i += 1) {
    const cx = WIDTH * (0.1 + rand() * 0.8);
    const cy = HEIGHT * (0.3 + rand() * 0.6);
    const rx = 160 + rand() * 240;
    const ry = 50 + rand() * 60;
    const pads = 90 + Math.floor(rand() * 60);
    for (let p = 0; p < pads; p += 1) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand());
      marks.push(knifeMark(rand, cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, 34 + rand() * 46, 18 + rand() * 14, (rand() - 0.5) * 36, pick(rand, palette.raft), palette));
    }
    const flowers = 8 + Math.floor(rand() * 8);
    for (let p = 0; p < flowers; p += 1) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 0.85;
      const fx = cx + Math.cos(a) * rx * r;
      const fy = cy + Math.sin(a) * ry * r;
      marks.push(
        `<ellipse cx="${f(fx + 1.5)}" cy="${f(fy + 2)}" rx="7" ry="5" fill="${palette.shadow}" opacity="0.5"/>`,
        `<ellipse cx="${f(fx)}" cy="${f(fy)}" rx="${f(6 + rand() * 4)}" ry="${f(5 + rand() * 3)}" fill="${palette.flower}"/>`,
        `<ellipse cx="${f(fx - 1.5)}" cy="${f(fy - 1.5)}" rx="2" ry="1.5" fill="${mix(palette.flower, palette.ridge, 0.5)}" opacity="0.8"/>`,
      );
    }
  }

  const noiseSeed = Math.floor(rand() * 1000);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    "<defs>",
    // Knife edges are never clean: a low-frequency wobble bends every outline a little.
    `<filter id="knife" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.035" numOctaves="2" seed="${noiseSeed}" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G"/></filter>`,
    // Canvas grain over everything, a few percent strong.
    `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${noiseSeed + 1}"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.5 0.5 0.5 0 -0.62"/></filter>`,
    "</defs>",
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${palette.ground}"/>`,
    `<g filter="url(#knife)">`,
    ...marks,
    "</g>",
    `<rect width="${WIDTH}" height="${HEIGHT}" filter="url(#grain)" opacity="0.18"/>`,
    "</svg>",
  ].join("");
}

/** Mean and 90th-percentile luminance (0–1), to keep new paintings as dark as the original behind the glass. */
async function brightness(input: Buffer | string): Promise<{ mean: number; p90: number }> {
  const { data } = await sharp(input).resize(320).greyscale().raw().toBuffer({ resolveWithObject: true });
  const values = Array.from(data).sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length / 255;
  return { mean, p90: values[Math.floor(values.length * 0.9)] / 255 };
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const themes = requested.length
    ? requested.map((id) => {
        const theme = THEMES.find((entry) => entry.id === id);
        if (!theme) throw new Error(`Unknown theme "${id}". Known: ${THEMES.map((entry) => entry.id).join(", ")}`);
        return theme;
      })
    : THEMES.filter((theme) => theme.id !== ("water-lilies" satisfies ThemeId));

  const original = await brightness(ORIGINAL);
  console.log(`water-lilies (original)  mean ${original.mean.toFixed(3)} · p90 ${original.p90.toFixed(3)}`);
  for (const theme of themes) {
    const raster = await sharp(Buffer.from(paintingSvg(theme))).png().toBuffer();
    // Never brighter than the original on average, so text on the glass keeps its contrast.
    const factor = Math.min(1, original.mean / (await brightness(raster)).mean);
    const webp = await sharp(raster).modulate({ brightness: factor }).webp({ quality: 80, effort: 6 }).toBuffer();
    const file = path.join(OUT_DIR, `${theme.id}-2560.webp`);
    await writeFile(file, webp);
    const stats = await brightness(webp);
    await writeThumb(webp, theme.id);
    console.log(`${theme.id.padEnd(24)} mean ${stats.mean.toFixed(3)} · p90 ${stats.p90.toFixed(3)} · ${(webp.length / 1024).toFixed(0)} KB → ${path.relative(process.cwd(), file)}`);
  }
  // The original painting needs a picker preview too.
  await writeThumb(ORIGINAL, "water-lilies");
}

/** The picker's 320px preview of a painting. */
async function writeThumb(input: Buffer | string, id: string): Promise<void> {
  await sharp(input).resize(320).webp({ quality: 75 }).toFile(path.join(OUT_DIR, `${id}-thumb.webp`));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
