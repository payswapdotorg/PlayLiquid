/**
 * ADAPTER BEHAVIOR TESTS (PL-023) — the golden paths: capability surface
 * fixed at registration, each declared capability executing through the
 * fake bridge with authoritative results, lifecycle transitions through
 * the contract validator, evidence recording, duplicate command-id
 * idempotency, and determinism.
 *
 * Implements: PL-023 acceptance evidence (R13/E4 behind the neutral seam).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import { createUnityAdapter } from "./adapter.ts";
import { createFakeUnityBridge, createFakeUnityClock } from "./fake-bridge.ts";
import {
  UNITY_ADAPTER_ID,
  UNITY_OFFERED_CAPABILITIES,
  UNITY_PAYLOAD_VERSION,
} from "./payload-model.ts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";

const tenant = asTenantId("tenant-alpha")!;
const guid = (char: string): string => char.repeat(32);
const digest = (char: string): string => char.repeat(64);

function makeAdapter(script?: Parameters<typeof createFakeUnityBridge>[0]["script"]) {
  const bridge = createFakeUnityBridge({ seed: 42, script });
  const clock = createFakeUnityClock(10_000);
  const adapter = createUnityAdapter({ tenant, bridge, clock });
  adapter.markReady();
  return { adapter, bridge, clock };
}

function dispatch(
  commandId: string,
  capability: string,
  payload: unknown,
  overrides: Partial<AdapterCommandDispatch> = {},
): AdapterCommandDispatch {
  return {
    kind: "adapter-command-dispatch",
    commandId,
    capability,
    payload,
    ...overrides,
  };
}

test("identity: id, neutral label, fixed capability surface at registration", () => {
  const { adapter } = makeAdapter();
  assert.equal(adapter.id, UNITY_ADAPTER_ID);
  assert.equal(adapter.state, "ready");
  assert.deepEqual(adapter.offeredCapabilities, UNITY_OFFERED_CAPABILITIES);
  assert.ok(adapter.label.length > 0);
  // The label carries the in-memory limitation statement (E11 honesty).
  assert.match(adapter.label, /in-memory bridge/i);
});

test("inspect project through the neutral seam returns an authoritative ok", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-1", "project.inspect", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    projectName: "MyGame",
  }));
  assert.equal(result.outcome, "ok");
  assert.equal(result.authority.adapterId, "engine.unity");
  assert.equal(result.authority.finishedAt, 10_000);
  if (result.outcome === "ok") {
    assert.equal((result.value as { capability: string }).capability, "project.inspect");
    assert.equal((result.value as { projectName: string }).projectName, "MyGame");
  }
});

test("inspect scene, gameobject, component, prefab and asset each return authoritative oks", async () => {
  const { adapter } = makeAdapter();
  const cases: readonly [string, Record<string, unknown>][] = [
    ["scene.inspect", { scenePath: "Assets/Scenes/Sandbox.unity" }],
    ["gameobject.inspect", { scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera" }],
    ["component.inspect", { scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera", componentType: "Rigidbody" }],
    ["prefab.inspect", { assetGuid: guid("a") }],
    ["asset.inspect", { assetGuid: guid("b") }],
  ];
  for (const [capability, fields] of cases) {
    const result = await adapter.dispatch(dispatch(`cmd-${capability}`, capability, {
      version: UNITY_PAYLOAD_VERSION,
      tenant: "tenant-alpha",
      ...fields,
    }));
    assert.equal(result.outcome, "ok", capability);
  }
});

test("gameobject.modify applies edits and reports the applied count", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-2", "gameobject.modify", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    scenePath: "Assets/Scenes/Sandbox.unity",
    objectPath: "Player/Main Camera",
    edits: [
      { property: "position", value: [100, 20, 300] },
      { property: "active", value: false },
    ],
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { appliedEdits: number }).appliedEdits, 2);
    assert.equal((result.value as { objectPath: string }).objectPath, "Player/Main Camera");
  }
});

test("import consumes a content-addressed artifact reference", async () => {
  const { adapter, bridge } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-3", "asset.import", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    destinationPath: "Assets/Imported/Hero.fbx",
    format: "fbx",
    artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 2048 },
  }));
  assert.equal(result.outcome, "ok");
  assert.equal(bridge.invoked.length, 1);
  if (result.outcome === "ok") {
    assert.equal((result.value as { importedDigest: string }).importedDigest, digest("a"));
    assert.equal((result.value as { importedBytes: number }).importedBytes, 2048);
  }
});

test("export produces a fresh content-addressed artifact reference", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-4", "asset.export", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    assetGuid: guid("b"),
    format: "gltf",
    mode: "asset",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    const artifact = (result.value as { artifact: { kind: string; digest: string; bytes: number } }).artifact;
    assert.equal(artifact.kind, "artifact-ref");
    assert.match(artifact.digest, /^[a-f0-9]{64}$/);
    assert.ok(artifact.bytes > 0);
  }
});

test("editor action executes through the bridge", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-5", "editor.action", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    action: "save-all",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { action: string }).action, "save-all");
  }
});

test("editor script returns a deterministic exit code", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-6", "editor.script", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    scriptDigest: digest("b"),
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { exitCode: number }).exitCode, 0);
  }
});

test("scene.play enters play mode for the requested scene", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-7", "scene.play", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    scenePath: "Assets/Scenes/Sandbox.unity",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { scenePath: string }).scenePath, "Assets/Scenes/Sandbox.unity");
    assert.match((result.value as { playSessionId: string }).playSessionId, /^play-[a-f0-9]{12}$/);
  }
});

test("build.player reports the platform, configuration and a build id", async () => {
  const { adapter, bridge } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-8", "build.player", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    scenePaths: ["Assets/Scenes/Sandbox.unity"],
    targetPlatform: "android",
    configuration: "development",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { targetPlatform: string }).targetPlatform, "android");
    assert.equal((result.value as { configuration: string }).configuration, "development");
    assert.match((result.value as { buildId: string }).buildId, /^build-[a-f0-9]{12}$/);
    const artifact = (result.value as { artifact: { kind: string } }).artifact;
    assert.equal(artifact.kind, "artifact-ref");
  }
  assert.equal(bridge.builtPlayers.length, 1);
});

test("duplicate command id with identical content replays the recorded result", async () => {
  const { adapter, bridge } = makeAdapter();
  const first = await adapter.dispatch(dispatch("cmd-10", "scene.inspect", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    scenePath: "Assets/Scenes/Sandbox.unity",
  }));
  const replay = await adapter.dispatch(dispatch("cmd-10", "scene.inspect", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    scenePath: "Assets/Scenes/Sandbox.unity",
  }));
  assert.equal(first.outcome, "ok");
  assert.deepEqual(replay, first);
  // The bridge executed ONCE; the replay came from the recorded result (E10).
  assert.equal(bridge.invoked.filter((item) => item.capability === "scene.inspect").length, 1);
});

test("evidence ledger records every dispatch/outcome pair (E10)", async () => {
  const { adapter } = makeAdapter();
  await adapter.dispatch(dispatch("cmd-11", "project.inspect", {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    projectName: "MyGame",
  }));
  const records = adapter.evidence.records;
  assert.ok(records.length >= 1);
  for (const record of records) {
    assert.equal(record.kind, "unity-exchange-record");
    assert.match(record.recordDigest, /^[a-f0-9]{64}$/);
    assert.match(record.authorityDigest, /^[a-f0-9]{64}$/);
  }
  assert.ok(records.some((item) => item.commandId === "cmd-11" && item.outcome === "ok"));
});

test("determinism (E9): same seed + same inputs reproduce identical values", async () => {
  const first = makeAdapter();
  const second = makeAdapter();
  const payload = {
    version: UNITY_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    projectName: "MyGame",
  };
  const one = await first.adapter.dispatch(dispatch("cmd-det", "project.inspect", payload));
  const two = await second.adapter.dispatch(dispatch("cmd-det", "project.inspect", payload));
  assert.deepEqual(one, two);
  assert.equal(first.adapter.evidence.ledgerDigest, second.adapter.evidence.ledgerDigest);
});

test("lifecycle transitions go through the contract validator", () => {
  const { adapter } = makeAdapter();
  assert.equal(adapter.state, "ready");
  const degraded = adapter.reportDegraded();
  assert.equal(degraded.outcome, "ok");
  assert.equal(adapter.state, "degraded");
  const recovered = adapter.markReady();
  assert.equal(recovered.outcome, "ok");
  assert.equal(adapter.state, "ready");
  const closed = adapter.close();
  assert.equal(closed.outcome, "ok");
  assert.equal(adapter.state, "closed");
  // Re-close is an idempotent no-op.
  const reclosed = adapter.close();
  assert.equal(reclosed.outcome, "ok");
  assert.equal(adapter.state, "closed");
});
