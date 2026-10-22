// The page's colour themes and background presets. This file is the only source of their colours:
// the root layout turns it into CSS (appearanceCss), the picker shows its swatches, and the
// contrast test checks every theme against the same rule Water Lilies meets.
//
// The token names come from the first theme (Water Lilies), but each one is a role every theme fills:
//   pond        page ground and the base of every glass tint
//   deep-water  the background painting's main mass (panels sit over it)
//   lily-pad    the painting's second mass
//   lilac       primary buttons, progress, "now" and Hermes work blocks; on-lilac is text on it
//   lilac-text  action-coloured text and links
//   lily-pink   Hermes's identity colour
//   reflection  eyebrows, the Seerr accent, 30–60 min gaps
//   ink-light   hairlines, hard shadows, the pressed segmented button
//   depth / surface / shadow  darker tints for inner cards and inputs, bubbles, and drop shadows
// The palettes of the four Omarchy-inspired themes come from their published, open-source schemes.

export const THEME_IDS = ["water-lilies", "kanagawa", "gruvbox", "rose-pine", "tokyo-night"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const BACKGROUND_IDS = ["water-lilies", "kanagawa", "gruvbox", "rose-pine", "tokyo-night", "plain"] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];

export const DEFAULT_THEME: ThemeId = "water-lilies";
export const DEFAULT_BACKGROUND: BackgroundId = "water-lilies";

export const TOKEN_NAMES = [
  "pond",
  "deep-water",
  "lily-pad",
  "lilac",
  "lilac-text",
  "lily-pink",
  "reflection",
  "ink-light",
  "text-strong",
  "text",
  "text-muted",
  "text-done",
  "green",
  "amber",
  "stock-up",
  "stock-down",
  "on-lilac",
  "depth",
  "surface",
  "shadow",
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];

export interface Theme {
  id: ThemeId;
  label: string;
  colors: Record<TokenName, string>;
}

export const THEMES: readonly Theme[] = [
  {
    id: "water-lilies",
    label: "Water Lilies",
    colors: {
      pond: "#0e1a1f",
      "deep-water": "#1f4e5a",
      "lily-pad": "#4f7a4b",
      lilac: "#9c8fd0",
      "lilac-text": "#c9c0f0",
      "lily-pink": "#e59ab5",
      reflection: "#e8c77a",
      "ink-light": "#d8e2dc",
      "text-strong": "#f1f4ef",
      text: "#d5ddd8",
      "text-muted": "#a9b7b1",
      "text-done": "#7e8c87",
      green: "#8cc79a",
      amber: "#f0b35a",
      "stock-up": "#4cd787",
      "stock-down": "#ff7a7a",
      "on-lilac": "#120e22",
      depth: "#081216",
      surface: "#0c161b",
      shadow: "#040a0c",
    },
  },
  {
    id: "kanagawa",
    label: "Kanagawa",
    colors: {
      pond: "#16161d",
      "deep-water": "#223249",
      "lily-pad": "#2d4f67",
      lilac: "#7e9cd8",
      "lilac-text": "#9cabca",
      "lily-pink": "#d27e99",
      reflection: "#e6c384",
      "ink-light": "#dcd7ba",
      "text-strong": "#f2ecbc",
      text: "#dcd7ba",
      "text-muted": "#b8b4a0",
      "text-done": "#8a8980",
      green: "#98bb6c",
      amber: "#ffa066",
      "stock-up": "#98bb6c",
      "stock-down": "#e46876",
      "on-lilac": "#16161d",
      depth: "#0d0d12",
      surface: "#121218",
      shadow: "#050507",
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    colors: {
      pond: "#1d2021",
      "deep-water": "#3c3836",
      "lily-pad": "#504945",
      lilac: "#83a598",
      "lilac-text": "#83a598",
      "lily-pink": "#d3869b",
      reflection: "#fabd2f",
      "ink-light": "#ebdbb2",
      "text-strong": "#fbf1c7",
      text: "#ebdbb2",
      "text-muted": "#bdae93",
      "text-done": "#928374",
      green: "#b8bb26",
      amber: "#fe8019",
      "stock-up": "#b8bb26",
      "stock-down": "#fd7562",
      "on-lilac": "#1d2021",
      depth: "#141617",
      surface: "#181a1b",
      shadow: "#0a0b0b",
    },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    colors: {
      pond: "#191724",
      "deep-water": "#26233a",
      "lily-pad": "#31748f",
      lilac: "#c4a7e7",
      "lilac-text": "#c4a7e7",
      "lily-pink": "#eb6f92",
      reflection: "#ebbcba",
      "ink-light": "#e0def4",
      "text-strong": "#f4f2ff",
      text: "#e0def4",
      "text-muted": "#a9a5c4",
      "text-done": "#7e7a99",
      green: "#9ccfd8",
      amber: "#f6c177",
      "stock-up": "#9ccfd8",
      "stock-down": "#eb6f92",
      "on-lilac": "#191724",
      depth: "#110f1a",
      surface: "#15131f",
      shadow: "#08070d",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    colors: {
      pond: "#16161e",
      "deep-water": "#24283b",
      "lily-pad": "#414868",
      lilac: "#7aa2f7",
      "lilac-text": "#7dcfff",
      "lily-pink": "#bb9af7",
      reflection: "#e0af68",
      "ink-light": "#c0caf5",
      "text-strong": "#e1e7ff",
      text: "#c0caf5",
      "text-muted": "#a1abd6",
      "text-done": "#737aa2",
      green: "#9ece6a",
      amber: "#ff9e64",
      "stock-up": "#9ece6a",
      "stock-down": "#f7768e",
      "on-lilac": "#16161e",
      depth: "#0f0f15",
      surface: "#13131a",
      shadow: "#07070a",
    },
  },
];

export interface Background {
  id: BackgroundId;
  label: string;
  /**
   * Painting files under public/backgrounds; null for a plain ground in the theme's pond colour.
   * The page is desktop first: without a portrait file, phones crop the landscape one. `thumb` is the
   * picker's 320px preview (made by npm run backgrounds:generate).
   */
  images: { landscape: string; portrait?: string; thumb: string } | null;
}

/** A painting made by scripts/generate-backgrounds.ts for the theme with the same id. */
function generated(id: Exclude<BackgroundId, "water-lilies" | "plain">, label: string): Background {
  return { id, label, images: { landscape: `/backgrounds/${id}-2560.webp`, thumb: `/backgrounds/${id}-thumb.webp` } };
}

export const BACKGROUNDS: readonly Background[] = [
  {
    id: "water-lilies",
    label: "Water Lilies",
    images: {
      landscape: "/backgrounds/background-palette-knife-2560.webp",
      portrait: "/backgrounds/background-palette-knife-portrait-1200.webp",
      thumb: "/backgrounds/water-lilies-thumb.webp",
    },
  },
  generated("kanagawa", "Kanagawa"),
  generated("gruvbox", "Gruvbox"),
  generated("rose-pine", "Rosé Pine"),
  generated("tokyo-night", "Tokyo Night"),
  { id: "plain", label: "Plain", images: null },
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

export function isBackgroundId(value: unknown): value is BackgroundId {
  return typeof value === "string" && (BACKGROUND_IDS as readonly string[]).includes(value);
}

export function themeById(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

function tokenBlock(selector: string, theme: Theme): string {
  const lines = TOKEN_NAMES.map((name) => `  --${name}: ${theme.colors[name]};`);
  // The legend's source colours follow the theme's roles.
  lines.push(
    `  --source-github: ${theme.colors["text-strong"]};`,
    `  --source-hermes: ${theme.colors["lily-pink"]};`,
    `  --source-gmail: ${theme.colors.lilac};`,
    `  --source-seerr: ${theme.colors.reflection};`,
    `  --source-pipeline: ${theme.colors.green};`,
  );
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/**
 * Every theme's tokens and every background's image, keyed by the data-theme and data-background
 * attributes on <html>. Water Lilies is also the plain :root default, so a missing attribute still
 * renders the original look.
 */
export function appearanceCss(): string {
  const themes = THEMES.map((theme) => tokenBlock(theme.id === DEFAULT_THEME ? `:root, :root[data-theme="${theme.id}"]` : `:root[data-theme="${theme.id}"]`, theme));
  const backgrounds = BACKGROUNDS.filter((background) => background.images).map((background) => {
    const { landscape, portrait } = background.images!;
    const selector = `:root[data-background="${background.id}"] .page-background`;
    const rule = `${selector} {\n  background-image: url("${landscape}");\n}`;
    return portrait ? `${rule}\n@media (orientation: portrait) {\n  ${selector} {\n    background-image: url("${portrait}");\n  }\n}` : rule;
  });
  return [...themes, ...backgrounds].join("\n");
}
