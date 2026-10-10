/**
 * ADAPTER BEHAVIOR TESTS (PL-025) — the golden paths: capability surface
 * fixed at registration, each declared capability executing through the
 * fake bridge with authoritative results, lifecycle transitions through
 * the contract validator, evidence recording, duplicate command-id
 * idempotency, and determinism.
 *
 * Implements: PL-025 acceptance evidence (R13/E4 behind the neutral seam).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import { createBlenderAdapter } from "./adapter.ts";
import { createFakeBlenderBridge, createFakeBlenderClock } from "./fake-bridge.ts";
import {
  BLENDER_ADAPTER_ID,
  BLENDER_OFFERED_CAPABILITIES,
  BLENDER_PAYLOAD_VERSION,
} from "./payload-model.ts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";

const tenant = asTenantId("tenant-alpha")!;

function makeAdapter(script?: Parameters<typeof createFakeBlenderBridge>[0]["script"]) {
  const bridge = createFakeBlenderBridge({ seed: 42, script });
  const clock = createFakeBlenderClock(10_000);
  const adapter = createBlenderAdapter({ tenant, bridge, clock });
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
  assert.equal(adapter.id, BLENDER_ADAPTER_ID);
  assert.equal(adapter.state, "ready");
  assert.deepEqual(adapter.offeredCapabilities, BLENDER_OFFERED_CAPABILITIES);
  assert.ok(adapter.label.length > 0);
  // The label carries the in-memory limitation statement (E11 honesty).
  assert.match(adapter.label, /in-memory bridge/i);
});

test("inspect project through the neutral seam returns an authoritative ok", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-1", "project.inspect", {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "game.blend",
  }));
  assert.equal(result.outcome, "ok");
  assert.equal(result.authority.adapterId, "tool.blender");
  assert.equal(result.authority.finishedAt, 10_000);
  if (result.outcome === "ok") {
    assert.equal((result.value as { capability: string }).capability, "project.inspect");
    assert.equal((result.value as { target: string }).target, "game.blend");
  }
});

test("modify applies edits and reports the applied count", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-2", "project.modify", {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "game.blend",
    edits: [
      { objectName: "Cube", property: "location", value: [1, 2, 3] },
      { objectName: "Cube", property: "scale", value: [2, 2, 2] },
    ],
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.equal((result.value as { appliedEdits: number }).appliedEdits, 2);
  }
});

test("import consumes a content-addressed artifact reference", async () => {
  const { adapter, bridge } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-3", "asset.import", {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "assets/hero",
    format: "glb",
    into: "scene",
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
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "assets/hero",
    format: "gltf",
    mode: "object",
    objectName: "Cube",
  }));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    const artifact = (result.value as { artifact: { kind: string; digest: string; bytes: number } }).artifact;
    assert.equal(artifact.kind, "artifact-ref");
    assert.match(artifact.digest, /^[a-f0-9]{64}$/);
    assert.ok(artifact.bytes > 0);
  }
});

test("editor action and editor script execute with typed payloads", async () => {
  const { adapter } = makeAdapter();
  const action = await adapter.dispatch(dispatch("cmd-5", "editor.action", {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    action: "recalculate-normals",
    target: "game.blend",
  }));
  assert.equal(action.outcome, "ok");
  const script = await adapter.dispatch(dispatch("cmd-6", "editor.script", {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "game.blend",
    scriptDigest: digest("b"),
  }));
  assert.equal(script.outcome, "ok");
  if (script.outcome === "ok") {
    assert.equal((script.value as { exitCode: number }).exitCode, 0);
  }
});

test("lifecycle: transitions go through the contract validator; closed is terminal", () => {
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
  const reclosed = adapter.close();
  assert.equal(reclosed.outcome, "ok"); // idempotent re-close
  const resurrect = adapter.markReady();
  assert.equal(resurrect.outcome, "rejected");
  assert.equal(resurrect.code, "adapter-lifecycle/closed-is-terminal");
});

test("duplicate command id with identical content returns the recorded result", async () => {
  const { adapter, bridge } = makeAdapter();
  const payload = {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "game.blend",
  };
  const first = await adapter.dispatch(dispatch("cmd-dup", "scene.inspect", payload));
  const second = await adapter.dispatch(dispatch("cmd-dup", "scene.inspect", payload));
  assert.equal(first.outcome, "ok");
  assert.equal(second.outcome, "ok");
  // The bridge executed ONCE; the replay is served from the record (E10).
  assert.equal(bridge.invoked.length, 1);
  assert.deepEqual(second.value, first.value);
  assert.equal(second.authority.finishedAt, first.authority.finishedAt);
});

test("evidence: every dispatch/outcome pair is recorded append-only", async () => {
  const { adapter } = makeAdapter();
  await adapter.dispatch(dispatch("cmd-e1", "project.inspect", {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "game.blend",
  }));
  await adapter.dispatch(dispatch("cmd-e2", "scene.inspect", {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "scene-main",
  }));
  const records = adapter.evidence.records;
  assert.equal(records.length, 2);
  assert.equal(records[0]?.commandId, "cmd-e1");
  assert.equal(records[0]?.outcome, "ok");
  assert.equal(records[1]?.sequence, 1);
  for (const record of records) {
    assert.match(record.recordDigest, /^[a-f0-9]{64}$/);
    assert.match(record.payloadDigest, /^[a-f0-9]{64}$/);
    assert.match(record.authorityDigest, /^[a-f0-9]{64}$/);
    const found = adapter.evidence.findByDigest(record.recordDigest);
    assert.equal(found?.recordDigest, record.recordDigest);
  }
  // Record content never changes: re-reading gives identical digests.
  const again = adapter.evidence.records;
  assert.deepEqual(again.map((r) => r.recordDigest), records.map((r) => r.recordDigest));
});

test("determinism (E9): same seed + same inputs → same outcomes and command keys", async () => {
  const runA = makeAdapter();
  const runB = makeAdapter();
  const payload = {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "game.blend",
    format: "gltf",
    mode: "whole-scene",
  };
  const a = await runA.adapter.dispatch(dispatch("cmd-d", "asset.export", payload));
  const b = await runB.adapter.dispatch(dispatch("cmd-d", "asset.export", payload));
  assert.equal(a.outcome, "ok");
  assert.equal(b.outcome, "ok");
  if (a.outcome === "ok" && b.outcome === "ok") {
    assert.deepEqual(b.value, a.value);
    assert.equal(b.authority.finishedAt, a.authority.finishedAt);
  }
  assert.deepEqual(
    runA.bridge.invoked.map((invocation) => invocation.commandKey),
    runB.bridge.invoked.map((invocation) => invocation.commandKey),
  );
});

test("bridge failures surface as typed failed results (not exceptions)", async () => {
  const { adapter } = makeAdapter({ missingTargets: ["scene-missing"] });
  const result = await adapter.dispatch(dispatch("cmd-f", "scene.inspect", {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "scene-missing",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "bridge/target-not-found");
  }
});

test("the adapter satisfies the neutral Adapter interface contract", () => {
  const { adapter } = makeAdapter();
  assert.equal(typeof adapter.dispatch, "function");
  assert.equal(typeof adapter.markReady, "function");
  assert.equal(typeof adapter.reportDegraded, "function");
  assert.equal(typeof adapter.close, "function");
});
