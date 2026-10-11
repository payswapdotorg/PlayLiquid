/**
 * THE E8 NEGATIVE BATTERY, part 3 (PL-022) — trust, lifecycle,
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
 * Part 1 (negative-capabilities.test.ts) covers capability and
 * dispatch-shape codes; part 2 (negative-payload.test.ts) the payload
 * rejection codes; part 4 (binding.test.ts) the typed engine-binding
 * compatibility refusals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";
import { createUnrealAdapter } from "./adapter.ts";
import { createFakeUnrealBridge, createFakeUnrealClock } from "./fake-bridge.ts";
import { checkUnrealTenancy, validateUnrealTenantClaim } from "./tenancy.ts";

const tenant = asTenantId("tenant-alpha")!;
const digest = (char: string): string => char.repeat(64);

function makeAdapter(script?: Parameters<typeof createFakeUnrealBridge>[0]["script"]) {
  const bridge = createFakeUnrealBridge({ seed: 7, script });
  const clock = createFakeUnrealClock(10_000);
  const adapter = createUnrealAdapter({ tenant, bridge, clock });
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
    target: "MyGame",
    clientClaimed: true,
    claimedOutcome: "ok",
    claimedValue: { modules: 999 },
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "unreal/client-claim");
  }
  assert.equal(bridge.invoked.length, 0); // never reached the bridge
});

test("E8: a NESTED client-claim marker is rejected (deep scan)", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cc2", "actor.modify", {
    version: 1,
    tenant: "tenant-alpha",
    target: "/Game/Maps/L_Sandbox",
    actorName: "BP_Player_C_1",
    edits: [{ property: "mobility", value: { clientClaimed: true, claimedOutcome: "ok" } }],
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "unreal/client-claim");
  }
});

test("E8: a bridge value containing a client-claim marker is refused (defense in depth)", async () => {
  const clock = createFakeUnrealClock(10_000);
  const laundering = {
    invoke: async () => ({
      outcome: "ok" as const,
      value: { clientClaimed: true, claimedOutcome: "ok" as const },
      durationMs: 1,
    }),
  };
  const adapter = createUnrealAdapter({ tenant, bridge: laundering, clock });
  adapter.markReady();
  const result = await adapter.dispatch(dispatch("cc3", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "MyGame",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "unreal/client-claim");
  }
});

// ---------------------------------------------------------------------------
// 5. Wrong lifecycle state
// ---------------------------------------------------------------------------

test("E8: dispatch before markReady is refused with adapter/not-ready", async () => {
  const bridge = createFakeUnrealBridge({ seed: 1 });
  const adapter = createUnrealAdapter({ tenant, bridge, clock: createFakeUnrealClock() });
  assert.equal(adapter.state, "registered");
  const result = await adapter.dispatch(dispatch("lc1", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "MyGame",
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
    target: "MyGame",
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
    target: "MyGame",
  }));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter/closed");
  }
});

test("E8: lifecycle transitions outside the contract table are typed rejections", () => {
  const bridge = createFakeUnrealBridge({ seed: 1 });
  const adapter = createUnrealAdapter({ tenant, bridge, clock: createFakeUnrealClock() });
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
    target: "MyGame",
  }, { deadline: { atEpochMs: 20_000 } }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "unreal/deadline-expired");
    assert.match(result.error.message, /expired/);
  }
});

test("E8: a deadline in the future lets the dispatch through", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("dl2", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "MyGame",
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
    target: "MyGame",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "unreal-tenancy/tenant-mismatch");
  }
  assert.equal(bridge.invoked.length, 0);
  // No evidence of execution leaked for the foreign tenant.
  assert.equal(adapter.evidence.records.filter((record) => record.outcome === "ok").length, 0);
});

test("E8: a missing tenant claim is rejected; a malformed claim too", async () => {
  const { adapter } = makeAdapter();
  const missing = await adapter.dispatch(dispatch("tn2", "project.inspect", {
    version: 1,
    target: "MyGame",
  }));
  assert.equal(missing.outcome, "failed");
  if (missing.outcome === "failed") {
    assert.equal(missing.error.code, "unreal-tenancy/tenant-not-a-string");
  }
  const malformed = await adapter.dispatch(dispatch("tn3", "project.inspect", {
    version: 1,
    tenant: 123,
    target: "MyGame",
  }));
  assert.equal(malformed.outcome, "failed");
  if (malformed.outcome === "failed") {
    assert.equal(malformed.error.code, "unreal-tenancy/tenant-not-a-string");
  }
});

test("E8: an invalid tenant grammar is a typed tenancy rejection", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("tn4", "project.inspect", {
    version: 1,
    tenant: "NOT A TENANT",
    target: "MyGame",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "unreal-tenancy/tenant-invalid");
  }
});

test("E8: tenancy helpers refuse invalid tenants", () => {
  assert.equal(validateUnrealTenantClaim(undefined).outcome, "rejected");
  assert.equal(validateUnrealTenantClaim("BAD ID").outcome, "rejected");
  const check = checkUnrealTenancy(tenant, "tenant-beta");
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    assert.equal(check.rejection.code, "unreal-tenancy/tenant-mismatch");
  }
});

// ---------------------------------------------------------------------------
// 8. Duplicate command id with different content
// ---------------------------------------------------------------------------

test("E8: same command id, different content → typed command-id-conflict", async () => {
  const { adapter } = makeAdapter();
  await adapter.dispatch(dispatch("dup1", "level.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "/Game/Maps/L_Sandbox",
  }));
  const conflict = await adapter.dispatch(dispatch("dup1", "level.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "/Game/Maps/L_OTHER",
  }));
  assert.equal(conflict.outcome, "failed");
  if (conflict.outcome === "failed") {
    assert.equal(conflict.error.code, "unreal/command-id-conflict");
  }
});

// ---------------------------------------------------------------------------
// 9–10. Bridge error passthrough + bridge throwing
// ---------------------------------------------------------------------------

test("E8: scripted bridge failures pass through as typed failures", async () => {
  const { adapter } = makeAdapter({
    missingProjects: ["GhostGame"],
    missingLevels: ["/Game/Maps/L_Ghost"],
    missingActors: ["/Game/Maps/L_Sandbox|BP_Phantom_C_1"],
    missingComponents: ["/Game/Maps/L_Sandbox|BP_Player_C_1|GhostComponent_0"],
    missingAssets: ["/Game/Ghost/SK_Ghost"],
    mismatchedScriptDigests: [digest("c")],
    unsupportedPlatforms: ["macos"],
    unsupportedConfigurations: ["debug"],
  });
  const missingProject = await adapter.dispatch(dispatch("br1", "project.inspect", {
    version: 1, tenant: "tenant-alpha", target: "GhostGame",
  }));
  assert.equal(missingProject.outcome, "failed");
  if (missingProject.outcome === "failed") {
    assert.equal(missingProject.error.code, "bridge/project-not-found");
  }
  const missingLevel = await adapter.dispatch(dispatch("br2", "level.inspect", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Ghost",
  }));
  assert.equal(missingLevel.outcome, "failed");
  if (missingLevel.outcome === "failed") {
    assert.equal(missingLevel.error.code, "bridge/level-not-found");
  }
  const missingActor = await adapter.dispatch(dispatch("br3", "actor.inspect", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", actorName: "BP_Phantom_C_1",
  }));
  assert.equal(missingActor.outcome, "failed");
  if (missingActor.outcome === "failed") {
    assert.equal(missingActor.error.code, "bridge/actor-not-found");
  }
  const missingComponent = await adapter.dispatch(dispatch("br4", "component.inspect", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1", componentName: "GhostComponent_0",
  }));
  assert.equal(missingComponent.outcome, "failed");
  if (missingComponent.outcome === "failed") {
    assert.equal(missingComponent.error.code, "bridge/component-not-found");
  }
  const missingAsset = await adapter.dispatch(dispatch("br5", "asset.inspect", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Ghost/SK_Ghost",
  }));
  assert.equal(missingAsset.outcome, "failed");
  if (missingAsset.outcome === "failed") {
    assert.equal(missingAsset.error.code, "bridge/asset-not-found");
  }
  const mismatch = await adapter.dispatch(dispatch("br6", "editor.script", {
    version: 1, tenant: "tenant-alpha", scriptDigest: digest("c"),
  }));
  assert.equal(mismatch.outcome, "failed");
  if (mismatch.outcome === "failed") {
    assert.equal(mismatch.error.code, "bridge/script-digest-mismatch");
  }
  const unsupportedPlatform = await adapter.dispatch(dispatch("br7", "build.cook", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", targetPlatform: "macos", configuration: "development",
  }));
  assert.equal(unsupportedPlatform.outcome, "failed");
  if (unsupportedPlatform.outcome === "failed") {
    assert.equal(unsupportedPlatform.error.code, "bridge/target-platform-unsupported");
  }
  const unsupportedConfiguration = await adapter.dispatch(dispatch("br8", "build.package", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", targetPlatform: "linux", configuration: "debug",
  }));
  assert.equal(unsupportedConfiguration.outcome, "failed");
  if (unsupportedConfiguration.outcome === "failed") {
    assert.equal(unsupportedConfiguration.error.code, "bridge/configuration-unsupported");
  }
});

test("E8: the fake bridge refuses foreign capabilities with a typed error", async () => {
  const bridge = createFakeUnrealBridge({ seed: 3 });
  const outcome = await bridge.invoke({
    kind: "unreal-bridge-invocation",
    commandKey: "unreal-cmd-00000000000000000000000000000000",
    capability: "unknown.thing",
    payload: { kind: "unreal-command-payload", version: 1, subject: "project", target: "MyGame" } as never,
  });
  assert.equal(outcome.outcome, "failed");
  if (outcome.outcome === "failed") {
    assert.equal(outcome.error?.code, "bridge/unsupported-capability");
  }
});

test("E8: a throwing bridge is contained as a typed failure, never an exception", async () => {
  const clock = createFakeUnrealClock(10_000);
  const throwing = {
    invoke: async (): Promise<never> => {
      throw new Error("bridge exploded");
    },
  };
  const adapter = createUnrealAdapter({ tenant, bridge: throwing, clock });
  adapter.markReady();
  const result = await adapter.dispatch(dispatch("br9", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "MyGame",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "bridge/threw");
    assert.match(result.error.message, /bridge exploded/);
  }
});
