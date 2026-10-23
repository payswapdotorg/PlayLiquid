/**
 * Onboarding copy + contextual next-step tests (pure, UX-002): the
 * frozen empty-state contract — every Studio surface's first-run copy
 * explains what PlayLiquid is / what the surface does in plain product
 * language and names a REAL next step — plus the honest "what next" lines
 * after a refresh failure (E11) and after operations are recorded.
 *
 * The copy is a VIEW MODEL (view/onboarding.ts is pure), so the wording is
 * testable exactly like any other projection: deterministically, without
 * a DOM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STUDIO_EMPTY_STATE_COPY,
  refreshFailureNextStep,
  timelineNextHint,
} from "./onboarding.ts";
import type { StudioEmptySurfaceId } from "./onboarding.ts";

const SURFACES: readonly StudioEmptySurfaceId[] = [
  "packages",
  "session",
  "avatars",
  "capabilities",
  "tools",
];

test("every Studio surface has first-run empty-state copy (frozen contract)", () => {
  for (const surface of SURFACES) {
    const copy = STUDIO_EMPTY_STATE_COPY[surface];
    assert.ok(copy !== undefined, `surface ${surface} has copy`);
    assert.ok(copy.title.length > 0, `${surface}: non-empty title`);
    assert.ok(copy.explanation.length > 0, `${surface}: non-empty explanation`);
    assert.ok(copy.nextStepLabel.length > 0, `${surface}: non-empty next-step label`);
    assert.ok(copy.guidance.length >= 0, `${surface}: guidance list present`);
  }
});

test("the copy is a frozen value: the same words render every run (E9)", () => {
  assert.ok(Object.isFrozen(STUDIO_EMPTY_STATE_COPY));
  for (const surface of SURFACES) {
    assert.ok(Object.isFrozen(STUDIO_EMPTY_STATE_COPY[surface]));
  }
});

test("every explanation says what the surface does, in plain language", () => {
  for (const surface of SURFACES) {
    const explanation = STUDIO_EMPTY_STATE_COPY[surface].explanation;
    assert.ok(
      explanation.length >= 120,
      `${surface}: the explanation is substantial enough to orient a first-run user`,
    );
  }
});

test("the real next step of every Studio surface is the existing refresh control", () => {
  for (const surface of SURFACES) {
    assert.equal(
      STUDIO_EMPTY_STATE_COPY[surface].nextStepLabel,
      "Refresh snapshot",
      `${surface}: the next step is the REAL refresh operation (one typed port pull)`,
    );
  }
});

test("honest limitations: unsupported operations say so with the missing prerequisite", () => {
  // The operations that do NOT exist in the module contract today must be
  // named honestly, never implied to be one click away.
  const joined = (surface: StudioEmptySurfaceId) =>
    [STUDIO_EMPTY_STATE_COPY[surface].explanation, ...STUDIO_EMPTY_STATE_COPY[surface].guidance].join(" ");
  assert.match(joined("packages"), /not yet supported/, "publishing a package is marked unsupported");
  assert.match(joined("session"), /not yet supported/, "running a game session is marked unsupported");
  assert.match(joined("avatars"), /not yet supported/, "creating an avatar is marked unsupported");
  assert.match(joined("tools"), /not yet supported/, "registering a tool is marked unsupported");
  for (const surface of ["packages", "session", "avatars", "tools"] as const) {
    assert.match(joined(surface), /missing prerequisite/, `${surface}: the missing prerequisite is stated`);
  }
});

test("cross-workspace suggestions are PROSE, in PlayLiquid product vocabulary", () => {
  // Navigation belongs to the desktop shell; the module only suggests in
  // words. The vocabulary is the frozen product one.
  const all = SURFACES.flatMap((surface) => STUDIO_EMPTY_STATE_COPY[surface].guidance).join(" ");
  assert.match(all, /Lab workspace/, "the Lab workspace is named in prose");
  assert.match(all, /AI & Agents/, "the AI & Agents workspace is named in prose (frozen new name)");
  assert.match(all, /product top bar/, "the suggestion says where to navigate from");
});

test("titles state what is absent, in restrained plain language", () => {
  for (const surface of SURFACES) {
    assert.match(
      STUDIO_EMPTY_STATE_COPY[surface].title,
      /^No /,
      `${surface}: the title names the absence, never an unavailable action`,
    );
  }
});

test("refreshFailureNextStep: null without a failure, an honest what-next line with one", () => {
  assert.equal(refreshFailureNextStep(null), null);
  const line = refreshFailureNextStep("registry unreachable");
  assert.ok(line !== null);
  assert.match(line, /still renders/, "the last good snapshot's survival is stated");
  assert.match(line, /Refresh snapshot/, "the real next control is named");
  assert.match(line, /nothing was dropped/, "E11 honesty: nothing silently disappears");
});

test("timelineNextHint: null while empty, a short what-you-can-do-next hint once recorded", () => {
  assert.equal(timelineNextHint(0), null);
  const one = timelineNextHint(1);
  assert.ok(one !== null);
  assert.match(one, /append-only/, "the E10 discipline is named");
  assert.match(one, /1 recorded operation/, "singular for one operation");
  const many = timelineNextHint(7);
  assert.ok(many !== null);
  assert.match(many, /7 recorded operations/, "the count renders");
  assert.match(many, /Refresh snapshot/, "the real next control is named");
});

test("determinism: same inputs produce the same lines (pure copy)", () => {
  assert.equal(refreshFailureNextStep("x"), refreshFailureNextStep("x"));
  assert.equal(timelineNextHint(3), timelineNextHint(3));
});
