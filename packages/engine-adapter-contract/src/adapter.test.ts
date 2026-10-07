/**
 * Module role: tests for adapter id validation — the identity half of the
 * neutral adapter interface. The behavioral half is covered by
 * fake-adapter.test.ts through the reference fake.
 *
 * Implements: PL-005 §3.B.1 (neutral adapter interface) — behavior coverage
 * for adapter.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateAdapterId } from "./adapter.ts";

test("validateAdapterId accepts dotted lowercase slugs", () => {
  for (const id of ["fabric.primary", "a", "x.y.z"]) {
    assert.equal(validateAdapterId(id).outcome, "ok", `expected ok for "${id}"`);
  }
  assert.equal(validateAdapterId("a".repeat(128)).outcome, "ok");
});

test("validateAdapterId rejects malformed ids with typed codes", () => {
  const cases: readonly [unknown, string][] = [
    [42, "adapter-id/not-a-string"],
    [null, "adapter-id/not-a-string"],
    ["", "adapter-id/empty"],
    ["Fabric.Primary", "adapter-id/format"],
    ["fabric primary", "adapter-id/format"],
    [".fabric", "adapter-id/format"],
    ["a".repeat(129), "adapter-id/too-long"],
  ];
  for (const [input, expectedCode] of cases) {
    const result = validateAdapterId(input);
    if (result.outcome === "ok") {
      assert.fail(`expected ${expectedCode} for ${String(input)}`);
    }
    assert.equal(result.rejection.code, expectedCode);
  }
});
