import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { appearanceCss, BACKGROUND_IDS, BACKGROUNDS, isBackgroundId, isThemeId, THEME_IDS, THEMES, TOKEN_NAMES } from "./themes";

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as Rgb;
}

// Text on a glass panel: the pond tint at 50% over the painting's main mass (deep-water). Water
// Lilies meets 4.5:1 there for every text colour, and ~3.8:1 for the dimmed "done" grey.
const TEXT_TOKENS = ["text-strong", "text", "text-muted", "lilac-text", "lily-pink", "reflection", "green", "amber", "stock-up", "stock-down"] as const;
const DONE_MIN = 3;

for (const theme of THEMES) {
  test(`${theme.label}: text stays readable on a glass panel`, () => {
    const panel = over(rgb(theme.colors.pond), 0.5, rgb(theme.colors["deep-water"]));
    for (const token of TEXT_TOKENS) {
      const ratio = contrast(rgb(theme.colors[token]), panel);
      assert.ok(ratio >= 4.5, `${token} is ${ratio.toFixed(2)}:1 on the panel`);
    }
    const done = contrast(rgb(theme.colors["text-done"]), panel);
    assert.ok(done >= DONE_MIN, `text-done is ${done.toFixed(2)}:1 on the panel`);
    const onButton = contrast(rgb(theme.colors["on-lilac"]), rgb(theme.colors.lilac));
    assert.ok(onButton >= 4.5, `on-lilac is ${onButton.toFixed(2)}:1 on lilac`);
  });
}

test("every theme sets every token as a 6-digit hex colour", () => {
  assert.deepEqual(
    THEMES.map((theme) => theme.id),
    [...THEME_IDS],
  );
  for (const theme of THEMES) {
    assert.deepEqual(Object.keys(theme.colors).sort(), [...TOKEN_NAMES].sort(), theme.id);
    for (const [name, value] of Object.entries(theme.colors)) assert.match(value, /^#[0-9a-f]{6}$/, `${theme.id} ${name}`);
  }
  assert.deepEqual(
    BACKGROUNDS.map((background) => background.id),
    [...BACKGROUND_IDS],
  );
});

test("ids are checked against the known lists", () => {
  assert.equal(isThemeId("gruvbox"), true);
  assert.equal(isThemeId("solarized"), false);
  assert.equal(isThemeId(undefined), false);
  assert.equal(isBackgroundId("plain"), true);
  assert.equal(isBackgroundId("kanagawa"), true);
  assert.equal(isBackgroundId("starry-night"), false);
});

test("the CSS keys every theme and painting by the <html> attributes, Water Lilies as :root", () => {
  const css = appearanceCss();
  assert.match(css, /:root, :root\[data-theme="water-lilies"\] \{\n {2}--pond: #0e1a1f;/);
  for (const id of THEME_IDS) assert.ok(css.includes(`:root[data-theme="${id}"]`), id);
  assert.ok(css.includes(`:root[data-background="water-lilies"] .page-background {\n  background-image: url("/backgrounds/background-palette-knife-2560.webp");`));
  assert.ok(css.includes("@media (orientation: portrait)"));
  assert.ok(!css.includes('data-background="plain"'), "plain has no image rule");
  // Generated paintings are landscape only: phones crop them.
  assert.ok(css.includes(`:root[data-background="gruvbox"] .page-background {\n  background-image: url("/backgrounds/gruvbox-2560.webp");\n}`));
  assert.equal(css.match(/orientation: portrait/g)?.length, 1);
  assert.ok(css.includes("--source-hermes: #e59ab5;"));
});

test("every painting and preview a background names is in public/", () => {
  for (const background of BACKGROUNDS) {
    for (const file of Object.values(background.images ?? {})) {
      assert.ok(existsSync(path.join(process.cwd(), "public", file)), `${background.id}: ${file} is missing`);
    }
  }
});
