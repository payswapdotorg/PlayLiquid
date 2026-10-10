/**
 * THE E8 NEGATIVE BATTERY, part 2 (PL-025) — trust, lifecycle and
 * isolation refusals:
 *
 *  4. client-claimed outcomes rejected at the dispatch gate AND at the
 *     bridge-result gate (defense in depth);
 *  5. wrong-lifecycle-state dispatch refusals (registered/degraded/closed);
 *  6. deadline expiry handling;
 *  7. cross-tenant adapter usage isolation (R20);
 *  8. duplicate command id with DIFFERENT content → typed conflict;
 *  9. bridge error passthrough (each scripted bridge error code);
 * 10. bridge throwing is contained (typed failure, never an exception).
 *
 * Part 1 (negative-capabilities.test.ts) covers capability, dispatch-shape
 * and payload rejection codes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";
import { createBlenderAdapter } from "./adapter.ts";
import { createFakeBlenderBridge, createFakeBlenderClock } from "./fake-bridge.ts";
import { checkBlenderTenancy, validateBlenderTenantClaim } from "./tenancy.ts";

const tenant = asTenantId("tenant-alpha")!;
const digest = (char: string): string => char.repeat(64);

function makeAdapter(script?: Parameters<typeof createFakeBlenderBridge>[0]["script"]) {
  const bridge = createFakeBlenderBridge({ seed: 7, script });
  const clock = createFakeBlenderClock(10_000);
  const adapter = createBlenderAdapter({ tenant, bridge, clock });
  adapter.markReady();
  return { adapter, bridge, clock };
}

function dispatch(
  commandId: string,
  capability: string,
  payload: unknown,
  overrides: Record<string, unknown> = {},
): AdapterCommandDispatch {
  return {
    kind: "adapter-command-dispatch",
    commandId,
    capability,
    payload,
    ...overrides,
  } as AdapterCommandDispatch;
}

// ---------------------------------------------------------------------------
// 4. Client-claim rejection (both gates)
// ---------------------------------------------------------------------------

test("E8: a client-claimed outcome in the dispatch payload is rejected", async () => {
  const { adapter, bridge } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cc1", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
    clientClaimed: true,
    claimedOutcome: "ok",
    claimedValue: { objects: 999 },
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "blender/client-claim");
  }
  assert.equal(bridge.invoked.length, 0); // never reached the bridge
});

test("E8: a NESTED client-claim marker is rejected (deep scan)", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cc2", "project.modify", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
    edits: [{ objectName: "Cube", property: "scale", value: { clientClaimed: true, claimedOutcome: "ok" } }],
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "blender/client-claim");
  }
});

test("E8: a bridge value containing a client-claim marker is refused (defense in depth)", async () => {
  const clock = createFakeBlenderClock(10_000);
  const laundering = {
    invoke: async () => ({
        outcome: "ok" as const,
        value: { clientClaimed: true, claimedOutcome: "ok" as const },
        durationMs: 1,
      }),
  };
  const adapter = createBlenderAdapter({ tenant, bridge: laundering, clock });
  adapter.markReady();
  const result = await adapter.dispatch(dispatch("cc3", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "blender/client-claim");
  }
});

// ---------------------------------------------------------------------------
// 5. Wrong lifecycle state
// ---------------------------------------------------------------------------

test("E8: dispatch before markReady is refused with adapter/not-ready", async () => {
  const bridge = createFakeBlenderBridge({ seed: 1 });
  const adapter = createBlenderAdapter({ tenant, bridge, clock: createFakeBlenderClock() });
  assert.equal(adapter.state, "registered");
  const result = await adapter.dispatch(dispatch("lc1", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
  }));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter/not-ready");
  }
});

test("E8: dispatch while degraded is refused with adapter/degraded", async () => {
  const { adapter } = makeAdapter();
  adapter.reportDegraded();
  const result = await adapter.dispatch(dispatch("lc2", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
  }));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter/degraded");
  }
});

test("E8: dispatch after close is refused with adapter/closed", async () => {
  const { adapter } = makeAdapter();
  adapter.close();
  const result = await adapter.dispatch(dispatch("lc3", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
  }));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter/closed");
  }
});

// ---------------------------------------------------------------------------
// 6. Deadline expiry
// ---------------------------------------------------------------------------

test("E8: a deadline already expired at dispatch time is a typed failure", async () => {
  const { adapter, clock } = makeAdapter();
  clock.setTo(50_000);
  const result = await adapter.dispatch(dispatch("dl1", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
  }, { deadline: { atEpochMs: 20_000 } }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "blender/deadline-expired");
    assert.match(result.error.message, /expired/);
  }
});

test("E8: a deadline in the future lets the dispatch through", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("dl2", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
  }, { deadline: { atEpochMs: 20_000 } }));
  assert.equal(result.outcome, "ok");
});

// ---------------------------------------------------------------------------
// 7. Cross-tenant isolation (R20)
// ---------------------------------------------------------------------------

test("E8: a dispatch claiming a foreign tenant is rejected (R20)", async () => {
  const { adapter, bridge } = makeAdapter();
  const result = await adapter.dispatch(dispatch("tn1", "project.inspect", {
    version: 1,
    tenant: "tenant-beta",
    target: "game.blend",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "blender-tenancy/tenant-mismatch");
  }
  assert.equal(bridge.invoked.length, 0);
  // No evidence of execution leaked for the foreign tenant.
  assert.equal(adapter.evidence.records.filter((record) => record.outcome === "ok").length, 0);
});

test("E8: a missing tenant claim is rejected; a malformed claim too", async () => {
  const { adapter } = makeAdapter();
  const missing = await adapter.dispatch(dispatch("tn2", "project.inspect", {
    version: 1,
    target: "game.blend",
  }));
  assert.equal(missing.outcome, "failed");
  if (missing.outcome === "failed") {
    assert.equal(missing.error.code, "blender-tenancy/tenant-not-a-string");
  }
  const malformed = await adapter.dispatch(dispatch("tn3", "project.inspect", {
    version: 1,
    tenant: 123,
    target: "game.blend",
  }));
  assert.equal(malformed.outcome, "failed");
  if (malformed.outcome === "failed") {
    assert.equal(malformed.error.code, "blender-tenancy/tenant-not-a-string");
  }
});

test("E8: tenancy helpers refuse invalid tenants", () => {
  assert.equal(validateBlenderTenantClaim(undefined).outcome, "rejected");
  assert.equal(validateBlenderTenantClaim("BAD ID").outcome, "rejected");
  const check = checkBlenderTenancy(tenant, "tenant-beta");
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    assert.equal(check.rejection.code, "blender-tenancy/tenant-mismatch");
  }
});

// ---------------------------------------------------------------------------
// 8. Duplicate command id with different content
// ---------------------------------------------------------------------------

test("E8: same command id, different content → typed command-id-conflict", async () => {
  const { adapter } = makeAdapter();
  await adapter.dispatch(dispatch("dup1", "scene.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "scene-main",
  }));
  const conflict = await adapter.dispatch(dispatch("dup1", "scene.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "scene-other",
  }));
  assert.equal(conflict.outcome, "failed");
  if (conflict.outcome === "failed") {
    assert.equal(conflict.error.code, "blender/command-id-conflict");
  }
});

// ---------------------------------------------------------------------------
// 9–10. Bridge error passthrough + bridge throwing
// ---------------------------------------------------------------------------

test("E8: scripted bridge failures pass through as typed failures", async () => {
  const { adapter } = makeAdapter({
    unsupportedCapabilities: ["editor.action"],
    mismatchedScriptDigests: [digest("c")],
  });
  const unsupported = await adapter.dispatch(dispatch("br1", "editor.action", {
    version: 1,
    tenant: "tenant-alpha",
    action: "recalculate-normals",
    target: "game.blend",
  }));
  assert.equal(unsupported.outcome, "failed");
  if (unsupported.outcome === "failed") {
    assert.equal(unsupported.error.code, "bridge/unsupported-capability");
  }
  const mismatch = await adapter.dispatch(dispatch("br2", "editor.script", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
    scriptDigest: digest("c"),
  }));
  assert.equal(mismatch.outcome, "failed");
  if (mismatch.outcome === "failed") {
    assert.equal(mismatch.error.code, "bridge/script-digest-mismatch");
  }
});

test("E8: a throwing bridge is contained as a typed failure, never an exception", async () => {
  const clock = createFakeBlenderClock(10_000);
  const throwing = {
    invoke: async (): Promise<never> => {
      throw new Error("bridge exploded");
    },
  };
  const adapter = createBlenderAdapter({ tenant, bridge: throwing, clock });
  adapter.markReady();
  const result = await adapter.dispatch(dispatch("br3", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "game.blend",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "bridge/threw");
    assert.match(result.error.message, /bridge exploded/);
  }
});
