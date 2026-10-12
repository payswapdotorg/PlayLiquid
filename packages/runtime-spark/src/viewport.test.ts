/**
 * Viewport projection tests (R6): the 9:16 portrait shape and the pure
 * screen-projection math, with typed refusals for non-spark shapes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { projectScreenToSparkFrame, projectSparkViewport } from "./viewport.ts";
import type { SparkTargetProfile } from "@playliquid/runtime-contracts";
import { fixtureSparkProfile } from "./fixtures.ts";

test("a spark profile projects to the 9:16 portrait viewport (R6)", () => {
  const projection = projectSparkViewport(fixtureSparkProfile());
  assert.equal(projection.ok, true);
  if (projection.ok) {
    assert.equal(projection.kind, "spark-viewport-projection");
    assert.equal(projection.formFactor, "mobile-first");
    assert.equal(projection.orientation, "portrait");
    assert.equal(projection.aspectRatio, "9:16");
    assert.equal(projection.aspectWidth, 9);
    assert.equal(projection.aspectHeight, 16);
  }
});

test("a non-9:16 portrait mobile-first shape is a typed refusal", () => {
  const cases: readonly Partial<SparkTargetProfile>[] = [
    { aspectRatio: "16:9" as never },
    { orientation: "landscape" as never },
    { formFactor: "desktop-first" as never },
  ];
  for (const over of cases) {
    const refusal = projectSparkViewport({ ...fixtureSparkProfile(), ...over } as SparkTargetProfile);
    assert.equal(refusal.ok, false);
    if (!refusal.ok) {
      assert.equal(refusal.code, "viewport/not-spark-shape");
    }
  }
});

test("a landscape aspect (width >= height) is refused even if the label lies", () => {
  const refusal = projectSparkViewport({ ...fixtureSparkProfile(), aspectRatio: "16:9" as never });
  assert.equal(refusal.ok, false);
});

test("screen projection centers the largest 9:16 frame (pure math)", () => {
  const projection = projectSparkViewport(fixtureSparkProfile());
  if (!projection.ok) throw new Error("unreachable");
  const frame = projectScreenToSparkFrame(projection, { width: 390, height: 844 });
  assert.equal(frame.ok, true);
  if (frame.ok) {
    // 390x844 is taller than 9:16 (which would be 390 x ~693): the frame
    // fills the width and letterboxes vertically, centered.
    assert.equal(frame.width, 390);
    assert.ok(Math.abs(frame.height - (390 * 16) / 9) < 1e-9);
    assert.equal(frame.x, 0);
    assert.ok(Math.abs(frame.y - (844 - frame.height) / 2) < 1e-9);
    assert.equal(frame.orientation, "portrait");
  }
  const pillarboxed = projectScreenToSparkFrame(projection, { width: 844, height: 390 });
  assert.equal(pillarboxed.ok, true);
  if (pillarboxed.ok) {
    assert.equal(pillarboxed.height, 390);
    assert.ok(Math.abs(pillarboxed.width - (390 * 9) / 16) < 1e-9);
  }
});

test("non-positive screen dimensions are typed refusals", () => {
  const projection = projectSparkViewport(fixtureSparkProfile());
  if (!projection.ok) throw new Error("unreachable");
  for (const screen of [{ width: 0, height: 100 }, { width: 100, height: -1 }, { width: Number.NaN, height: 100 }]) {
    const refusal = projectScreenToSparkFrame(projection, screen);
    assert.equal(refusal.ok, false);
    if (!refusal.ok) {
      assert.equal(refusal.code, "viewport/invalid-screen");
    }
  }
});
