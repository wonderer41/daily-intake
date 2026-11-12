import assert from "node:assert/strict";
import { test } from "node:test";
import { dragScrollLeft, easeOutSoft, stepTarget } from "./motion";

test("ease cubic-bezier(.2,.7,.2,1): pinned ends, monotonic, front-loaded", () => {
  assert.equal(easeOutSoft(0), 0);
  assert.equal(easeOutSoft(1), 1);
  assert.equal(easeOutSoft(-1), 0);
  assert.equal(easeOutSoft(2), 1);
  let previous = 0;
  for (let i = 1; i <= 100; i += 1) {
    const value = easeOutSoft(i / 100);
    assert.ok(value >= previous - 1e-9, `not monotonic at ${i / 100}`);
    previous = value;
  }
  // An ease-out covers most of the distance in the first half.
  assert.ok(easeOutSoft(0.5) > 0.85, `easeOutSoft(0.5) = ${easeOutSoft(0.5)}`);
});

test("Later steps to the next card's left edge and stops at the end", () => {
  const starts = [0, 280, 560, 840, 1120];
  assert.equal(stepTarget(starts, 0, 1, 900), 280);
  assert.equal(stepTarget(starts, 100, 1, 900), 280);
  assert.equal(stepTarget(starts, 280, 1, 900), 560);
  assert.equal(stepTarget(starts, 840, 1, 900), 900);
  assert.equal(stepTarget(starts, 900, 1, 900), 900);
});

test("Earlier steps to the previous card's left edge and stops at 0", () => {
  const starts = [0, 280, 560, 840, 1120];
  assert.equal(stepTarget(starts, 900, -1, 900), 840);
  assert.equal(stepTarget(starts, 560, -1, 900), 280);
  assert.equal(stepTarget(starts, 300, -1, 900), 280);
  assert.equal(stepTarget(starts, 280, -1, 900), 0);
  assert.equal(stepTarget(starts, 0, -1, 900), 0);
});

test("nothing to scroll: both directions stay at 0", () => {
  assert.equal(stepTarget([0, 280], 0, 1, 0), 0);
  assert.equal(stepTarget([0, 280], 0, -1, -20), 0);
  assert.equal(stepTarget([], 0, 1, 500), 500);
});

test("dragging follows the mouse and stays inside the track", () => {
  // Dragging left (mouse moves -100px) shows later cards; right shows earlier ones.
  assert.equal(dragScrollLeft(200, 500, 400, 1000), 300);
  assert.equal(dragScrollLeft(200, 500, 550, 1000), 150);
  assert.equal(dragScrollLeft(200, 500, 900, 1000), 0);
  assert.equal(dragScrollLeft(900, 500, 100, 1000), 1000);
  // A track that fits on screen doesn't move.
  assert.equal(dragScrollLeft(0, 500, 100, -20), 0);
});
