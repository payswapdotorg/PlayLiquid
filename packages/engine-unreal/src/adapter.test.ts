/**
 * ADAPTER BEHAVIOR TESTS (PL-022) — the golden paths: capability surface
 * fixed at registration, each declared capability executing through the
 * fake bridge with authoritative results, lifecycle transitions through
 * the contract validator, evidence recording, duplicate command-id
 * idempotency, and determinism.
 *
 * Implements: PL-022 acceptance evidence (R13/E4 behind the neutral seam).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import { createUnrealAdapter } from "./adapter.ts";
import { createFakeUnrealBridge, createFakeUnrealClock } from "./fake-bridge.ts";
import {
  UNREAL_ADAPTER_ID,
  UNREAL_OFFERED_CAPABILITIES,
  UNREAL_PAYLOAD_VERSION,
} from "./payload-model.ts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";

const tenant = asTenantId("tenant-alpha")!;

function makeAdapter(script?: Parameters<typeof createFakeUnrealBridge>[0]["script"]) {
  const bridge = createFakeUnrealBridge({ seed: 42, script });
  const clock = createFakeUnrealClock(10_000);
  const adapter = createUnrealAdapter({ tenant, bridge, clock });
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

const digest = (char: string): string => char.repeat(64);

test("identity: id, neutral label, fixed capability surface at registration", () => {
  const { adapter } = makeAdapter();
  assert.equal(adapter.id, UNREAL_ADAPTER_ID);
  assert.equal(adapter.state, "ready");
  assert.deepEqual(adapter.offeredCapabilities, UNREAL_OFFERED_CAPABILITIES);
  assert.ok(adapter.label.length > 0);
  // The label carries the in-memory limitation statement (E11 honesty).
  assert.match(adapter.label, /in-memory bridge/i);
});

test("inspect project through the neutral seam returns an authoritative ok", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-1", "project.inspect", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
  }));
  assert.equal(result.outcome, "ok");
  assert.equal(result.authority.adapterId, "engine.unreal");
  assert.equal(result.authority.finishedAt, 10_000);
  if (result.outcome === "ok") {
    assert.equal((result.value as { capability: string }).capability, "project.inspect");
    assert.equal((result.value as { target: string }).target, "MyGame");
  }
});

test("inspect level, actor, component and asset each return authoritative oks", async () => {
  const { adapter } = makeAdapter();
  const cases: readonly [string, Record<string, unknown>][] = [
    ["level.inspect", { target: "/Game/Maps/L_Sandbox" }],
    ["actor.inspect", { target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1" }],
    ["component.inspect", { target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1", componentName: "StaticMeshComponent_0" }],
    ["asset.inspect", { target: "/Game/Characters/Hero/Mesh/SK_Hero" }],
  ];
  for (const [capability, fields] of cases) {
    const result = await adapter.dispatch(dispatch(`cmd-${capability}`, capability, {
      version: UNREAL_PAYLOAD_VERSION,
      tenant: "tenant-alpha",
      ...fields,
    }));
    assert.equal(result.outcome, "ok", capability);
  }
});

test("actor.modify applies edits and reports the applied count", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-2", "actor.modify", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "/Game/Maps/L_Sandbox",
    actorName: "BP_Player_C_1",
    edits: [
      { property: "location", value: [100, 20, 300] },
      { property: "mobility", value: "static" },
    ],
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { appliedEdits: number }).appliedEdits, 2);
    assert.equal((result.value as { actorName: string }).actorName, "BP_Player_C_1");
  }
});

test("import consumes a content-addressed artifact reference", async () => {
  const { adapter, bridge } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-3", "asset.import", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "/Game/Imported/Hero",
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
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "/Game/Characters/Hero/Mesh/SK_Hero",
    format: "usd",
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
    version: UNREAL_PAYLOAD_VERSION,
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
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    scriptDigest: digest("b"),
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { exitCode: number }).exitCode, 0);
  }
});

test("level.pie starts a play-in-editor session with the requested players", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-7", "level.pie", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "/Game/Maps/L_Sandbox",
    players: 3,
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { players: number }).players, 3);
    assert.match((result.value as { sessionId: string }).sessionId, /^pie-[a-f0-9]{12}$/);
  }
});

test("build.cook reports the cooked platform and configuration", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-8", "build.cook", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
    targetPlatform: "windows",
    configuration: "development",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { targetPlatform: string }).targetPlatform, "windows");
    assert.equal((result.value as { configuration: string }).configuration, "development");
    assert.ok((result.value as { cookedPackages: number }).cookedPackages > 0);
  }
});

test("build.package mints a build id and a packaged artifact", async () => {
  const { adapter, bridge } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-9", "build.package", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
    targetPlatform: "linux",
    configuration: "shipping",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { targetPlatform: string }).targetPlatform, "linux");
    assert.match((result.value as { buildId: string }).buildId, /^build-[a-f0-9]{12}$/);
    const artifact = (result.value as { artifact: { kind: string } }).artifact;
    assert.equal(artifact.kind, "artifact-ref");
  }
  assert.equal(bridge.packagedBuilds.length, 1);
});

test("duplicate command id with identical content replays the recorded result", async () => {
  const { adapter, bridge } = makeAdapter();
  const first = await adapter.dispatch(dispatch("cmd-10", "level.inspect", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "/Game/Maps/L_Sandbox",
  }));
  const replay = await adapter.dispatch(dispatch("cmd-10", "level.inspect", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "/Game/Maps/L_Sandbox",
  }));
  assert.equal(first.outcome, "ok");
  assert.deepEqual(replay, first);
  // The bridge executed ONCE; the replay came from the recorded result (E10).
  assert.equal(bridge.invoked.filter((item) => item.capability === "level.inspect").length, 1);
});

test("evidence ledger records every dispatch/outcome pair (E10)", async () => {
  const { adapter } = makeAdapter();
  await adapter.dispatch(dispatch("cmd-11", "project.inspect", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
  }));
  const records = adapter.evidence.records;
  assert.ok(records.length >= 1);
  for (const record of records) {
    assert.equal(record.kind, "unreal-exchange-record");
    assert.match(record.recordDigest, /^[a-f0-9]{64}$/);
    assert.match(record.authorityDigest, /^[a-f0-9]{64}$/);
  }
  assert.ok(records.some((item) => item.commandId === "cmd-11" && item.outcome === "ok"));
});

test("determinism (E9): same seed + same inputs reproduce identical values", async () => {
  const first = makeAdapter();
  const second = makeAdapter();
  const payload = {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
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
