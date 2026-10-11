/**
 * THE E8 NEGATIVE BATTERY, part 2 (PL-021) — trust, lifecycle,
 * isolation and bridge-failure refusals:
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
 * and payload rejection codes; part 3 (binding.test.ts) covers the typed
 * engine-binding compatibility refusals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";
import { createPlayCanvasAdapter } from "./adapter.ts";
import { createFakePlayCanvasBridge, createFakePlayCanvasClock } from "./fake-bridge.ts";
import { checkPlayCanvasTenancy, validatePlayCanvasTenantClaim } from "./tenancy.ts";

const tenant = asTenantId("tenant-alpha")!;
const digest = (char: string): string => char.repeat(64);

function makeAdapter(script?: Parameters<typeof createFakePlayCanvasBridge>[0]["script"]) {
  const bridge = createFakePlayCanvasBridge({ seed: 7, script });
  const clock = createFakePlayCanvasClock(10_000);
  const adapter = createPlayCanvasAdapter({ tenant, bridge, clock });
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
    target: "projects/game",
    clientClaimed: true,
    claimedOutcome: "ok",
    claimedValue: { entities: 999 },
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "playcanvas/client-claim");
  }
  assert.equal(bridge.invoked.length, 0); // never reached the bridge
});

test("E8: a NESTED client-claim marker is rejected (deep scan)", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cc2", "project.modify", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
    edits: [{ entityName: "Entity-Cube", property: "scale", value: { clientClaimed: true, claimedOutcome: "ok" } }],
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "playcanvas/client-claim");
  }
});

test("E8: a bridge value containing a client-claim marker is refused (defense in depth)", async () => {
  const clock = createFakePlayCanvasClock(10_000);
  const laundering = {
    invoke: async () => ({
      outcome: "ok" as const,
      value: { clientClaimed: true, claimedOutcome: "ok" as const },
      durationMs: 1,
    }),
  };
  const adapter = createPlayCanvasAdapter({ tenant, bridge: laundering, clock });
  adapter.markReady();
  const result = await adapter.dispatch(dispatch("cc3", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "playcanvas/client-claim");
  }
});

// ---------------------------------------------------------------------------
// 5. Wrong lifecycle state
// ---------------------------------------------------------------------------

test("E8: dispatch before markReady is refused with adapter/not-ready", async () => {
  const bridge = createFakePlayCanvasBridge({ seed: 1 });
  const adapter = createPlayCanvasAdapter({ tenant, bridge, clock: createFakePlayCanvasClock() });
  assert.equal(adapter.state, "registered");
  const result = await adapter.dispatch(dispatch("lc1", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
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
    target: "projects/game",
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
    target: "projects/game",
  }));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter/closed");
  }
});

test("E8: lifecycle transitions outside the contract table are typed rejections", () => {
  const bridge = createFakePlayCanvasBridge({ seed: 1 });
  const adapter = createPlayCanvasAdapter({ tenant, bridge, clock: createFakePlayCanvasClock() });
  // registered → closed is allowed; closed → ready must be rejected (terminal).
  const closed = adapter.close();
  assert.equal(closed.outcome, "ok");
  const resurrect = adapter.markReady();
  assert.equal(resurrect.outcome, "rejected");
  if (resurrect.outcome === "rejected") {
    assert.equal(resurrect.code, "adapter-lifecycle/closed-is-terminal");
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
    target: "projects/game",
  }, { deadline: { atEpochMs: 20_000 } }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "playcanvas/deadline-expired");
    assert.match(result.error.message, /expired/);
  }
});

test("E8: a deadline in the future lets the dispatch through", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("dl2", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
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
    target: "projects/game",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "playcanvas-tenancy/tenant-mismatch");
  }
  assert.equal(bridge.invoked.length, 0);
  // No evidence of execution leaked for the foreign tenant.
  assert.equal(adapter.evidence.records.filter((record) => record.outcome === "ok").length, 0);
});

test("E8: a missing tenant claim is rejected; a malformed claim too", async () => {
  const { adapter } = makeAdapter();
  const missing = await adapter.dispatch(dispatch("tn2", "project.inspect", {
    version: 1,
    target: "projects/game",
  }));
  assert.equal(missing.outcome, "failed");
  if (missing.outcome === "failed") {
    assert.equal(missing.error.code, "playcanvas-tenancy/tenant-not-a-string");
  }
  const malformed = await adapter.dispatch(dispatch("tn3", "project.inspect", {
    version: 1,
    tenant: 123,
    target: "projects/game",
  }));
  assert.equal(malformed.outcome, "failed");
  if (malformed.outcome === "failed") {
    assert.equal(malformed.error.code, "playcanvas-tenancy/tenant-not-a-string");
  }
});

test("E8: an invalid tenant grammar is a typed tenancy rejection", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("tn4", "project.inspect", {
    version: 1,
    tenant: "NOT A TENANT",
    target: "projects/game",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "playcanvas-tenancy/tenant-invalid");
  }
});

test("E8: tenancy helpers refuse invalid tenants", () => {
  assert.equal(validatePlayCanvasTenantClaim(undefined).outcome, "rejected");
  assert.equal(validatePlayCanvasTenantClaim("BAD ID").outcome, "rejected");
  const check = checkPlayCanvasTenancy(tenant, "tenant-beta");
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    assert.equal(check.rejection.code, "playcanvas-tenancy/tenant-mismatch");
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
    assert.equal(conflict.error.code, "playcanvas/command-id-conflict");
  }
});

// ---------------------------------------------------------------------------
// 9–10. Bridge error passthrough + bridge throwing
// ---------------------------------------------------------------------------

test("E8: scripted bridge failures pass through as typed failures", async () => {
  const { adapter } = makeAdapter({
    missingTargets: ["projects/ghost"],
    missingEntities: ["Entity-Phantom"],
    mismatchedScriptDigests: [digest("c")],
    unsupportedChannels: ["spark"],
  });
  const missingTarget = await adapter.dispatch(dispatch("br1", "project.inspect", {
    version: 1, tenant: "tenant-alpha", target: "projects/ghost",
  }));
  assert.equal(missingTarget.outcome, "failed");
  if (missingTarget.outcome === "failed") {
    assert.equal(missingTarget.error.code, "bridge/target-not-found");
  }
  const missingEntity = await adapter.dispatch(dispatch("br2", "entity.inspect", {
    version: 1, tenant: "tenant-alpha", target: "Entity-Phantom",
  }));
  assert.equal(missingEntity.outcome, "failed");
  if (missingEntity.outcome === "failed") {
    assert.equal(missingEntity.error.code, "bridge/entity-not-found");
  }
  const mismatch = await adapter.dispatch(dispatch("br3", "scene.script", {
    version: 1, tenant: "tenant-alpha", target: "scene-main", scriptDigest: digest("c"),
  }));
  assert.equal(mismatch.outcome, "failed");
  if (mismatch.outcome === "failed") {
    assert.equal(mismatch.error.code, "bridge/script-digest-mismatch");
  }
  const unsupportedChannel = await adapter.dispatch(dispatch("br4", "build.publish", {
    version: 1, tenant: "tenant-alpha", target: "projects/game", channel: "spark",
  }));
  assert.equal(unsupportedChannel.outcome, "failed");
  if (unsupportedChannel.outcome === "failed") {
    assert.equal(unsupportedChannel.error.code, "bridge/channel-unsupported");
  }
});

test("E8: playing a build id this bridge never published fails typed", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("br5", "build.play", {
    version: 1, tenant: "tenant-alpha", target: "projects/game", buildId: "build-neverpublished",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "bridge/build-not-published");
  }
});

test("E8: the fake bridge refuses foreign capabilities with a typed error", async () => {
  const bridge = createFakePlayCanvasBridge({ seed: 3 });
  const outcome = await bridge.invoke({
    kind: "playcanvas-bridge-invocation",
    commandKey: "playcanvas-cmd-00000000000000000000000000000000",
    capability: "unknown.thing",
    payload: { kind: "playcanvas-command-payload", version: 1, subject: "project", target: "projects/game" } as never,
  });
  assert.equal(outcome.outcome, "failed");
  if (outcome.outcome === "failed") {
    assert.equal(outcome.error?.code, "bridge/unsupported-capability");
  }
});

test("E8: a throwing bridge is contained as a typed failure, never an exception", async () => {
  const clock = createFakePlayCanvasClock(10_000);
  const throwing = {
    invoke: async (): Promise<never> => {
      throw new Error("bridge exploded");
    },
  };
  const adapter = createPlayCanvasAdapter({ tenant, bridge: throwing, clock });
  adapter.markReady();
  const result = await adapter.dispatch(dispatch("br6", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "bridge/threw");
    assert.match(result.error.message, /bridge exploded/);
  }
});

