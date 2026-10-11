/**
 * THE E8 NEGATIVE BATTERY, part 3 (PL-024) — trust, lifecycle,
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
import { createGodotAdapter } from "./adapter.ts";
import { createFakeGodotBridge, createFakeGodotClock } from "./fake-bridge.ts";
import { checkGodotTenancy, validateGodotTenantClaim } from "./tenancy.ts";

const tenant = asTenantId("tenant-alpha")!;
const digest = (char: string): string => char.repeat(64);

function makeAdapter(script?: Parameters<typeof createFakeGodotBridge>[0]["script"]) {
  const bridge = createFakeGodotBridge({ seed: 7, script });
  const clock = createFakeGodotClock(10_000);
  const adapter = createGodotAdapter({ tenant, bridge, clock });
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
    version: 1, tenant: "tenant-alpha", target: "MyGame",
    clientClaimed: true, claimedOutcome: "ok", claimedValue: { settings: 999 },
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "godot/client-claim");
  }
  assert.equal(bridge.invoked.length, 0); // never reached the bridge
});

test("E8: a NESTED client-claim marker is rejected (deep scan)", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cc2", "node.modify", {
    version: 1,
    tenant: "tenant-alpha",
    target: "res://scenes/main.tscn",
    nodePath: "Player",
    edits: [{ property: "modulate", value: { clientClaimed: true, claimedOutcome: "ok" } }],
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "godot/client-claim");
  }
});

test("E8: a bridge value containing a client-claim marker is refused (defense in depth)", async () => {
  const clock = createFakeGodotClock(10_000);
  const laundering = {
    invoke: async () => ({
      outcome: "ok" as const,
      value: { clientClaimed: true, claimedOutcome: "ok" as const },
      durationMs: 1,
    }),
  };
  const adapter = createGodotAdapter({ tenant, bridge: laundering, clock });
  adapter.markReady();
  const result = await adapter.dispatch(dispatch("cc3", "project.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "MyGame",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "godot/client-claim");
  }
});

// ---------------------------------------------------------------------------
// 5. Wrong lifecycle state
// ---------------------------------------------------------------------------

test("E8: dispatch before markReady is refused with adapter/not-ready", async () => {
  const bridge = createFakeGodotBridge({ seed: 1 });
  const adapter = createGodotAdapter({ tenant, bridge, clock: createFakeGodotClock() });
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
  const bridge = createFakeGodotBridge({ seed: 1 });
  const adapter = createGodotAdapter({ tenant, bridge, clock: createFakeGodotClock() });
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
    assert.equal(result.error.code, "godot/deadline-expired");
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
    assert.equal(result.error.code, "godot-tenancy/tenant-mismatch");
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
    assert.equal(missing.error.code, "godot-tenancy/tenant-not-a-string");
  }
  const malformed = await adapter.dispatch(dispatch("tn3", "project.inspect", {
    version: 1,
    tenant: 123,
    target: "MyGame",
  }));
  assert.equal(malformed.outcome, "failed");
  if (malformed.outcome === "failed") {
    assert.equal(malformed.error.code, "godot-tenancy/tenant-not-a-string");
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
    assert.equal(result.error.code, "godot-tenancy/tenant-invalid");
  }
});

test("E8: tenancy helpers refuse invalid tenants", () => {
  assert.equal(validateGodotTenantClaim(undefined).outcome, "rejected");
  assert.equal(validateGodotTenantClaim("BAD ID").outcome, "rejected");
  const check = checkGodotTenancy(tenant, "tenant-beta");
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    assert.equal(check.rejection.code, "godot-tenancy/tenant-mismatch");
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
    target: "res://scenes/main.tscn",
  }));
  const conflict = await adapter.dispatch(dispatch("dup1", "scene.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    target: "res://scenes/other.tscn",
  }));
  assert.equal(conflict.outcome, "failed");
  if (conflict.outcome === "failed") {
    assert.equal(conflict.error.code, "godot/command-id-conflict");
  }
});

// ---------------------------------------------------------------------------
// 9–10. Bridge error passthrough + bridge throwing
// ---------------------------------------------------------------------------

test("E8: scripted bridge failures pass through as typed failures", async () => {
  const { adapter } = makeAdapter({
    missingProjects: ["GhostGame"],
    missingScenes: ["res://scenes/ghost.tscn"],
    missingNodes: ["res://scenes/main.tscn|GhostNode"],
    missingAssets: ["res://assets/ghost.png"],
    missingResources: ["res://resources/ghost.tres"],
    mismatchedScriptDigests: [digest("c")],
    missingPresets: ["Ghost Preset"],
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
  const missingScene = await adapter.dispatch(dispatch("br2", "scene.inspect", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/ghost.tscn",
  }));
  assert.equal(missingScene.outcome, "failed");
  if (missingScene.outcome === "failed") {
    assert.equal(missingScene.error.code, "bridge/scene-not-found");
  }
  const missingNode = await adapter.dispatch(dispatch("br3", "node.inspect", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", nodePath: "GhostNode",
  }));
  assert.equal(missingNode.outcome, "failed");
  if (missingNode.outcome === "failed") {
    assert.equal(missingNode.error.code, "bridge/node-not-found");
  }
  const missingAsset = await adapter.dispatch(dispatch("br4", "asset.inspect", {
    version: 1, tenant: "tenant-alpha", target: "res://assets/ghost.png",
  }));
  assert.equal(missingAsset.outcome, "failed");
  if (missingAsset.outcome === "failed") {
    assert.equal(missingAsset.error.code, "bridge/asset-not-found");
  }
  const missingResource = await adapter.dispatch(dispatch("br5", "resource.inspect", {
    version: 1, tenant: "tenant-alpha", target: "res://resources/ghost.tres",
  }));
  assert.equal(missingResource.outcome, "failed");
  if (missingResource.outcome === "failed") {
    assert.equal(missingResource.error.code, "bridge/resource-not-found");
  }
  const mismatch = await adapter.dispatch(dispatch("br6", "editor.script", {
    version: 1, tenant: "tenant-alpha", scriptDigest: digest("c"),
  }));
  assert.equal(mismatch.outcome, "failed");
  if (mismatch.outcome === "failed") {
    assert.equal(mismatch.error.code, "bridge/script-digest-mismatch");
  }
  const missingPreset = await adapter.dispatch(dispatch("br7", "build.export", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", preset: "Ghost Preset", targetPlatform: "web", configuration: "release",
  }));
  assert.equal(missingPreset.outcome, "failed");
  if (missingPreset.outcome === "failed") {
    assert.equal(missingPreset.error.code, "bridge/preset-not-found");
  }
  const unsupportedPlatform = await adapter.dispatch(dispatch("br8", "build.export", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", preset: "macOS", targetPlatform: "macos", configuration: "release",
  }));
  assert.equal(unsupportedPlatform.outcome, "failed");
  if (unsupportedPlatform.outcome === "failed") {
    assert.equal(unsupportedPlatform.error.code, "bridge/target-platform-unsupported");
  }
  const unsupportedConfiguration = await adapter.dispatch(dispatch("br9", "build.export", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", preset: "Linux/X11", targetPlatform: "linux", configuration: "debug",
  }));
  assert.equal(unsupportedConfiguration.outcome, "failed");
  if (unsupportedConfiguration.outcome === "failed") {
    assert.equal(unsupportedConfiguration.error.code, "bridge/configuration-unsupported");
  }
});

test("E8: the fake bridge refuses foreign capabilities with a typed error", async () => {
  const bridge = createFakeGodotBridge({ seed: 3 });
  const outcome = await bridge.invoke({
    kind: "godot-bridge-invocation",
    commandKey: "godot-cmd-00000000000000000000000000000000",
    capability: "unknown.thing",
    payload: { kind: "godot-command-payload", version: 1, subject: "project", target: "MyGame" } as never,
  });
  assert.equal(outcome.outcome, "failed");
  if (outcome.outcome === "failed") {
    assert.equal(outcome.error?.code, "bridge/unsupported-capability");
  }
});

test("E8: a throwing bridge is contained as a typed failure, never an exception", async () => {
  const clock = createFakeGodotClock(10_000);
  const throwing = {
    invoke: async (): Promise<never> => {
      throw new Error("bridge exploded");
    },
  };
  const adapter = createGodotAdapter({ tenant, bridge: throwing, clock });
  adapter.markReady();
  const result = await adapter.dispatch(dispatch("br10", "project.inspect", {
    version: 1, tenant: "tenant-alpha", target: "MyGame",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "bridge/threw");
    assert.match(result.error.message, /bridge exploded/);
  }
});
