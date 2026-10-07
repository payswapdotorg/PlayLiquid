/**
 * Module role: tests for call provenance — the fields every typed outcome
 * carries (tool identity + declared surface), and the guarantee that there
 * is no engagement-telemetry field to fabricate.
 *
 * Implements: PL-005 §3.A.5 (provenance hooks) — behavior coverage for
 * provenance.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCallProvenance, validateCallProvenance } from "./provenance.ts";
import type { ToolIdentity } from "./descriptor.ts";

const tool = { namespace: "playliquid", name: "dice-roll" };
const surface = { major: 1, minor: 2 };

test("buildCallProvenance carries identity and declared surface only", () => {
  const provenance = buildCallProvenance(tool, surface);
  assert.equal(provenance.kind, "call-provenance");
  assert.equal(provenance.tool.name, "dice-roll");
  assert.equal(provenance.declaredSurface.minor, 2);
  // The provenance surface has nowhere to hang engagement telemetry:
  assert.deepEqual(Reflect.ownKeys(provenance).sort(), ["declaredSurface", "kind", "tool"]);
  assert.throws(() => {
    (provenance as { tool: ToolIdentity }).tool = { namespace: "x", name: "y" };
  }, TypeError);
});

test("validateCallProvenance accepts a built provenance", () => {
  assert.equal(validateCallProvenance(buildCallProvenance(tool, surface)).outcome, "ok");
});

test("validateCallProvenance rejects non-objects", () => {
  const result = validateCallProvenance(null);
  if (result.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(result.rejections[0]!.code, "provenance/not-an-object");
});

test("validateCallProvenance rejects wrong kind, tool, and surface", () => {
  const kindResult = validateCallProvenance({ tool, declaredSurface: surface });
  if (kindResult.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.deepEqual(kindResult.rejections.map((item) => item.code), ["provenance/kind-invalid"]);

  const toolResult = validateCallProvenance({ kind: "call-provenance", tool: null, declaredSurface: surface });
  if (toolResult.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.deepEqual(toolResult.rejections.map((item) => item.code), ["provenance/tool-invalid"]);

  const surfaceResult = validateCallProvenance({ kind: "call-provenance", tool, declaredSurface: { major: 1 } });
  if (surfaceResult.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.deepEqual(surfaceResult.rejections.map((item) => item.code), ["provenance/surface-invalid"]);
});
