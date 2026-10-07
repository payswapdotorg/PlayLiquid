/**
 * Module role: tests for adapter capability ids, registration-time
 * declaration lists, and the typed refusal for dispatch to an undeclared
 * capability.
 *
 * Implements: PL-005 §3.B.4 (capability declaration) — behavior coverage for
 * capability.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mediateAdapterCapability,
  validateAdapterCapabilityId,
  validateAdapterCapabilityList,
} from "./capability.ts";

test("validateAdapterCapabilityId accepts dot-separated lowercase ids", () => {
  for (const id of ["scene.render", "a", "physics.step.deep"]) {
    assert.equal(validateAdapterCapabilityId(id).outcome, "ok", `expected ok for "${id}"`);
  }
});

test("validateAdapterCapabilityId rejects malformed ids with typed codes", () => {
  const cases: readonly [unknown, string][] = [
    [42, "adapter-capability-id/not-a-string"],
    [null, "adapter-capability-id/not-a-string"],
    ["", "adapter-capability-id/empty"],
    ["Scene.Render", "adapter-capability-id/format"],
    ["scene render", "adapter-capability-id/format"],
    ["a".repeat(129), "adapter-capability-id/too-long"],
  ];
  for (const [input, expectedCode] of cases) {
    const result = validateAdapterCapabilityId(input);
    if (result.outcome === "ok") {
      assert.fail(`expected ${expectedCode} for ${String(input)}`);
    }
    assert.equal(result.rejection.code, expectedCode);
  }
});

test("validateAdapterCapabilityList accepts a clean declaration, preserving order", () => {
  const result = validateAdapterCapabilityList(["scene.render", "physics.step"]);
  if (result.outcome !== "ok") {
    assert.fail("expected ok");
  }
  assert.deepEqual(result.capabilities, ["scene.render", "physics.step"]);
});

test("validateAdapterCapabilityList rejects non-arrays, bad entries, and duplicates", () => {
  const notArray = validateAdapterCapabilityList("nope");
  if (notArray.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(notArray.rejections[0]!.code, "adapter-capability-list/not-an-array");

  const badEntry = validateAdapterCapabilityList([42]);
  if (badEntry.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(badEntry.rejections[0]!.code, "adapter-capability-list/entry-invalid");
  assert.equal(badEntry.rejections[0]!.path, "capabilities[0]");

  const duplicate = validateAdapterCapabilityList(["scene.render", "scene.render"]);
  if (duplicate.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(duplicate.rejections[0]!.code, "adapter-capability-list/duplicate");
  assert.equal(duplicate.rejections[0]!.path, "capabilities[1]");
});

test("mediateAdapterCapability grants a declared capability", () => {
  assert.equal(mediateAdapterCapability(["scene.render"], "scene.render").outcome, "granted");
});

test("mediateAdapterCapability refuses an undeclared capability with a typed refusal", () => {
  const result = mediateAdapterCapability(["scene.render"], "physics.step");
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.refusal.code, "adapter-capability/not-declared");
  assert.equal(result.refusal.requested, "physics.step");
  assert.ok(result.refusal.message.includes("physics.step"));
});
