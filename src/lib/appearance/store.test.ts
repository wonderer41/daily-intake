import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { parseAppearanceBody, toAppearanceDto } from "./store";

function field(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return (error.details as { field: string }).field;
  }
  assert.fail("expected a validation error");
}

test("a body sets the theme, the background, or both", () => {
  assert.deepEqual(parseAppearanceBody({ theme: "gruvbox" }), { theme: "gruvbox", background: undefined });
  assert.deepEqual(parseAppearanceBody({ background: "plain" }), { theme: undefined, background: "plain" });
  assert.deepEqual(parseAppearanceBody({ theme: "rose-pine", background: "water-lilies" }), { theme: "rose-pine", background: "water-lilies" });
});

test("unknown ids, unknown fields and empty bodies are rejected by name", () => {
  assert.equal(field(() => parseAppearanceBody({ theme: "solarized" })), "theme");
  assert.equal(field(() => parseAppearanceBody({ background: "starry-night" })), "background");
  assert.equal(field(() => parseAppearanceBody({ theme: "gruvbox", font: "comic" })), "font");
  assert.equal(field(() => parseAppearanceBody({})), "body");
});

test("no row, or ids this version doesn't know, read as Water Lilies", () => {
  assert.deepEqual(toAppearanceDto(null), { theme: "water-lilies", background: "water-lilies" });
  assert.deepEqual(toAppearanceDto({ theme: "tokyo-night", background: "plain" }), { theme: "tokyo-night", background: "plain" });
  assert.deepEqual(toAppearanceDto({ theme: "retired-theme", background: "gone" }), { theme: "water-lilies", background: "water-lilies" });
});
