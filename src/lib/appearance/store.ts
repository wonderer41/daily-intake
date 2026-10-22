import { ROOT, enumValue, invalid, optional, strictObject } from "@/lib/api/validate";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import type { Actor, AppearanceDto } from "@/types/dashboard-contracts";
import { BACKGROUND_IDS, DEFAULT_BACKGROUND, DEFAULT_THEME, isBackgroundId, isThemeId, THEME_IDS } from "./themes";

// The page's theme and background: one row, the same on every device. The page (PUT
// /api/appearance) and Hermes (PUT /api/hermes/appearance) both change it; the latest write wins.

const ROW_ID = 1;

/** The stored row as the page uses it; no row, or an id this version doesn't know, reads as the default. */
export function toAppearanceDto(row: { theme: string; background: string } | null): AppearanceDto {
  return {
    theme: row && isThemeId(row.theme) ? row.theme : DEFAULT_THEME,
    background: row && isBackgroundId(row.background) ? row.background : DEFAULT_BACKGROUND,
  };
}

export async function getAppearance(): Promise<AppearanceDto> {
  return toAppearanceDto(await prisma.appearance.findUnique({ where: { id: ROW_ID } }));
}

/** Body of both PUT routes: `theme`, `background`, or both. */
export function parseAppearanceBody(body: unknown): Partial<AppearanceDto> {
  const o = strictObject(body, ROOT, ["theme", "background"]);
  const input = {
    theme: optional(o.theme, (value) => enumValue(value, "theme", THEME_IDS)),
    background: optional(o.background, (value) => enumValue(value, "background", BACKGROUND_IDS)),
  };
  if (input.theme === undefined && input.background === undefined) invalid(ROOT, "must set theme, background or both");
  return input;
}

/** Applies the change; publishes appearance.changed only when the look actually changed. */
export async function setAppearance(input: Partial<AppearanceDto>, by: Actor): Promise<{ data: AppearanceDto; changed: boolean }> {
  const current = await getAppearance();
  const data: AppearanceDto = { theme: input.theme ?? current.theme, background: input.background ?? current.background };
  const changed = data.theme !== current.theme || data.background !== current.background;
  if (changed) {
    await prisma.appearance.upsert({ where: { id: ROW_ID }, create: { id: ROW_ID, ...data, updatedBy: by }, update: { ...data, updatedBy: by } });
    await publishLiveEvent({ type: "appearance.changed" });
  }
  return { data, changed };
}
