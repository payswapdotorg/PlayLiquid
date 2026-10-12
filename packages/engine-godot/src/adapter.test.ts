/**
 * ADAPTER BEHAVIOR TESTS (PL-024) — the golden paths: capability surface
 * fixed at registration, each declared capability executing through the
 * fake bridge with authoritative results, lifecycle transitions through
 * the contract validator, evidence recording, duplicate command-id
 * idempotency, and determinism.
 *
 * Implements: PL-024 acceptance evidence (R13/E4 behind the neutral seam).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import { createGodotAdapter } from "./adapter.ts";
import { createFakeGodotBridge, createFakeGodotClock } from "./fake-bridge.ts";
import {
  GODOT_ADAPTER_ID,
  GODOT_OFFERED_CAPABILITIES,
  GODOT_PAYLOAD_VERSION,
} from "./payload-model.ts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";

const tenant = asTenantId("tenant-alpha")!;

function makeAdapter(script?: Parameters<typeof createFakeGodotBridge>[0]["script"]) {
  const bridge = createFakeGodotBridge({ seed: 42, script });
  const clock = createFakeGodotClock(10_000);
  const adapter = createGodotAdapter({ tenant, bridge, clock });
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
  assert.equal(adapter.id, GODOT_ADAPTER_ID);
  assert.equal(adapter.state, "ready");
  assert.deepEqual(adapter.offeredCapabilities, GODOT_OFFERED_CAPABILITIES);
  assert.ok(adapter.label.length > 0);
  // The label carries the in-memory limitation statement (E11 honesty).
  assert.match(adapter.label, /in-memory bridge/i);
});

test("inspect project through the neutral seam returns an authoritative ok", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-1", "project.inspect", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
  }));
  assert.equal(result.outcome, "ok");
  assert.equal(result.authority.adapterId, "engine.godot");
  assert.equal(result.authority.finishedAt, 10_000);
  if (result.outcome === "ok") {
    assert.equal((result.value as { capability: string }).capability, "project.inspect");
    assert.equal((result.value as { target: string }).target, "MyGame");
  }
});

test("inspect scene, node, asset and resource each return authoritative oks", async () => {
  const { adapter } = makeAdapter();
  const cases: readonly [string, Record<string, unknown>][] = [
    ["scene.inspect", { target: "res://scenes/main.tscn" }],
    ["node.inspect", { target: "res://scenes/main.tscn", nodePath: "Player/Body/Sprite2D" }],
    ["asset.inspect", { target: "res://assets/textures/hero.png" }],
    ["resource.inspect", { target: "res://resources/materials/hero_suit.tres" }],
  ];
  for (const [capability, fields] of cases) {
    const result = await adapter.dispatch(dispatch(`cmd-${capability}`, capability, {
      version: GODOT_PAYLOAD_VERSION,
      tenant: "tenant-alpha",
      ...fields,
    }));
    assert.equal(result.outcome, "ok", capability);
  }
});

test("node.modify applies edits and reports the applied count", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-2", "node.modify", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "res://scenes/main.tscn",
    nodePath: "Player/Body/Sprite2D",
    edits: [
      { property: "position", value: [100, 20] },
      { property: "modulate", value: "#ff0000" },
    ],
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { appliedEdits: number }).appliedEdits, 2);
    assert.equal((result.value as { nodePath: string }).nodePath, "Player/Body/Sprite2D");
  }
});

test("import consumes a content-addressed artifact reference", async () => {
  const { adapter, bridge } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-3", "asset.import", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "res://assets/textures/hero.png",
    format: "png",
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
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "res://scenes/main.tscn",
    format: "gltf",
    mode: "scene",
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
    version: GODOT_PAYLOAD_VERSION,
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
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    scriptDigest: digest("b"),
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { exitCode: number }).exitCode, 0);
  }
});

test("scene.run starts a run-scene session; headless defaults to false", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-7", "scene.run", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "res://scenes/main.tscn",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { headless: boolean }).headless, false);
    assert.equal((result.value as { target: string }).target, "res://scenes/main.tscn");
    assert.match((result.value as { runId: string }).runId, /^run-[a-f0-9]{12}$/);
  }
});

test("scene.run passes the headless flag through when requested", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-7b", "scene.run", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "res://scenes/main.tscn",
    headless: true,
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { headless: boolean }).headless, true);
  }
});

test("build.export reports the export preset, platform and configuration", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-8", "build.export", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
    preset: "Web (HTML5)",
    targetPlatform: "web",
    configuration: "release",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { targetPlatform: string }).targetPlatform, "web");
    assert.equal((result.value as { configuration: string }).configuration, "release");
    assert.equal((result.value as { preset: string }).preset, "Web (HTML5)");
    assert.match((result.value as { exportId: string }).exportId, /^export-[a-f0-9]{12}$/);
  }
});

test("build.export desktop platforms (windows/macos/linux) each export", async () => {
  const { adapter } = makeAdapter();
  for (const targetPlatform of ["windows", "macos", "linux"]) {
    const result = await adapter.dispatch(dispatch(`cmd-9-${targetPlatform}`, "build.export", {
      version: GODOT_PAYLOAD_VERSION,
      tenant: "tenant-alpha",
      target: "MyGame",
      preset: "Windows Desktop",
      targetPlatform,
      configuration: "debug",
    }));
    assert.equal(result.outcome, "ok", targetPlatform);
  }
});

test("build.export mints a packaged artifact the bridge tracks", async () => {
  const { adapter, bridge } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-9", "build.export", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
    preset: "Linux/X11",
    targetPlatform: "linux",
    configuration: "release",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    const artifact = (result.value as { artifact: { kind: string } }).artifact;
    assert.equal(artifact.kind, "artifact-ref");
  }
  assert.equal(bridge.exportedBuilds.length, 1);
});

test("duplicate command id with identical content replays the recorded result", async () => {
  const { adapter, bridge } = makeAdapter();
  const first = await adapter.dispatch(dispatch("cmd-10", "scene.inspect", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "res://scenes/main.tscn",
  }));
  const replay = await adapter.dispatch(dispatch("cmd-10", "scene.inspect", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "res://scenes/main.tscn",
  }));
  assert.equal(first.outcome, "ok");
  assert.deepEqual(replay, first);
  // The bridge executed ONCE; the replay came from the recorded result (E10).
  assert.equal(bridge.invoked.filter((item) => item.capability === "scene.inspect").length, 1);
});

test("evidence ledger records every dispatch/outcome pair (E10)", async () => {
  const { adapter } = makeAdapter();
  await adapter.dispatch(dispatch("cmd-11", "project.inspect", {
    version: GODOT_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
  }));
  const records = adapter.evidence.records;
  assert.ok(records.length >= 1);
  for (const record of records) {
    assert.equal(record.kind, "godot-exchange-record");
    assert.match(record.recordDigest, /^[a-f0-9]{64}$/);
    assert.match(record.authorityDigest, /^[a-f0-9]{64}$/);
  }
  assert.ok(records.some((item) => item.commandId === "cmd-11" && item.outcome === "ok"));
});

test("determinism (E9): same seed + same inputs reproduce identical values", async () => {
  const first = makeAdapter();
  const second = makeAdapter();
  const payload = {
    version: GODOT_PAYLOAD_VERSION,
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
