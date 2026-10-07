/**
 * Module role: tests for capability id validation and capability mediation
 * (typed refusals for ungranted capabilities).
 *
 * Implements: PL-005 §3.A.3 (capability mediation) — behavior coverage for
 * capability.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mediateCapabilities, validateCapabilityId } from "./capability.ts";

test("validateCapabilityId accepts dot-separated lowercase ids", () => {
  for (const id of ["scene.load", "random.generate", "a", "physics.step.deep"]) {
    assert.equal(validateCapabilityId(id).outcome, "ok", `expected ok for "${id}"`);
  }
});

test("validateCapabilityId accepts the maximum length", () => {
  assert.equal(validateCapabilityId("a".repeat(128)).outcome, "ok");
});

test("validateCapabilityId rejects malformed ids with typed codes", () => {
  const cases: readonly [unknown, string][] = [
    [42, "capability-id/not-a-string"],
    [null, "capability-id/not-a-string"],
    ["", "capability-id/empty"],
    ["Scene.Load", "capability-id/format"],
    [".scene", "capability-id/format"],
    ["scene.", "capability-id/format"],
    ["scene load", "capability-id/format"],
    ["a".repeat(129), "capability-id/too-long"],
  ];
  for (const [input, expectedCode] of cases) {
    const result = validateCapabilityId(input);
    if (result.outcome === "ok") {
      assert.fail(`expected ${expectedCode} for ${String(input)}`);
    }
    assert.equal(result.rejection.code, expectedCode);
  }
});

test("mediateCapabilities grants when every requirement is granted", () => {
  const result = mediateCapabilities(
    ["scene.load", "physics.step"],
    ["scene.load", "physics.step", "extra.grant"],
  );
  assert.equal(result.outcome, "granted");
});

test("mediateCapabilities grants an empty requirement list", () => {
  assert.equal(mediateCapabilities([], []).outcome, "granted");
});

test("mediateCapabilities deduplicates requirements before matching", () => {
  assert.equal(mediateCapabilities(["a.b", "a.b"], ["a.b"]).outcome, "granted");
});

test("mediateCapabilities refuses with a typed refusal listing ALL missing capabilities, sorted", () => {
  const result = mediateCapabilities(["z.last", "a.first", "m.middle"], ["m.middle"]);
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.refusal.kind, "capability-refusal");
  assert.equal(result.refusal.code, "capability/not-granted");
  assert.deepEqual(result.refusal.missing, ["a.first", "z.last"]);
  assert.ok(result.refusal.message.includes("a.first"));
  assert.ok(result.refusal.message.includes("z.last"));
});
