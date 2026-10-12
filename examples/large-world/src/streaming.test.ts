/**
 * STREAMING TESTS (PL-039; R15, E8, E9) — the chunk-streaming semantics:
 * wanted-set derivation, the CONTRACT admission gate (typed refusals,
 * never silent), the streaming state machine (loads/unloads, checkpoint
 * vs CAS re-resolution) and the deterministic schedule derivation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { latticeDocument } from "./document.ts";
import { chunkStaticContent, deriveWorldModel } from "./world-model.ts";
import { entityKeyOf } from "./world-model.ts";
import type { LatticeWorldModel } from "./world-model.ts";
import {
  VIEW_RADIUS,
  admitStreamOp,
  deriveStreamingSchedule,
  dormantChunkIds,
  initialWorldRecord,
  readStreamingView,
  stepStreamingWorld,
  wantedChunkIds,
} from "./streaming.ts";
import type { ChunkStaticResolver, StreamOp, ViewpointWaypoint } from "./streaming.ts";

const MODEL = deriveWorldModel(latticeDocument());

/** A pure static resolver over the model (the CAS-backed one is tested in packages.test.ts). */
function modelResolver(model: LatticeWorldModel): ChunkStaticResolver {
  return {
    resolve(chunkId: string) {
      const chunk = model.byChunkId.get(chunkId);
      if (chunk === undefined) {
        return { ok: false, code: "chunk-unknown", detail: `chunk ${chunkId} is not part of the world model` };
      }
      const content = chunkStaticContent(model, chunkId);
      if (content.kind !== "record") throw new Error("chunk content must be a record");
      return {
        ok: true,
        content: {
          chunkId,
          entities: Object.entries(content.fields).flatMap(([key, state]) => (state === undefined ? [] : [{ key, state }])),
        },
      };
    },
  };
}

test("streaming: the wanted-set is the view-radius circle over chunk bounds, sorted", () => {
  const wanted = wantedChunkIds(MODEL, 40.5, 40.5);
  assert.deepEqual(wanted, [...wanted].sort());
  assert.ok(wanted.includes("chunk-2-2"));
  // The viewpoint sits mid-chunk-2-2: radius 24 covers the 3×3 around it
  // plus the two near-axis chunks whose nearest bounds are 23.5 away.
  assert.deepEqual(wanted, [
    "chunk-1-1", "chunk-1-2", "chunk-1-3",
    "chunk-2-1", "chunk-2-2", "chunk-2-3", "chunk-2-4",
    "chunk-3-1", "chunk-3-2", "chunk-3-3",
    "chunk-4-2",
  ]);
  // Far corner: a completely different set.
  const corner = wantedChunkIds(MODEL, 1, 1);
  assert.deepEqual(corner, ["chunk-0-0", "chunk-0-1", "chunk-1-0", "chunk-1-1"]);
  // Deterministic (E9).
  assert.deepEqual(wantedChunkIds(MODEL, 40.5, 40.5), wanted);
  // A tight radius only sees the containing chunk.
  assert.deepEqual(wantedChunkIds(MODEL, 40.5, 40.5, 1), ["chunk-2-2"]);
  assert.ok(VIEW_RADIUS > 0);
});

test("streaming: the contract gate refuses typed, never silently (E8)", () => {
  const resident = new Set(["chunk-2-2", "chunk-2-1"]);
  const expectRefusal = (op: StreamOp, code: string): void => {
    const refusal = admitStreamOp(MODEL, resident, op);
    if (refusal === undefined) throw new Error(`op ${op.kind} ${op.chunkId} was admitted — expected ${code}`);
    assert.equal(refusal.code, code);
    assert.equal(refusal.op, op);
    assert.ok(refusal.detail.length > 0, "refusals carry a human detail");
  };
  // Unknown chunk.
  expectRefusal({ kind: "load", chunkId: "chunk-9-9" }, "chunk-unknown");
  expectRefusal({ kind: "unload", chunkId: "nope" }, "chunk-unknown");
  // The core chunk is not streamable — in EITHER direction.
  expectRefusal({ kind: "unload", chunkId: "chunk-2-2" }, "chunk-not-streamable");
  expectRefusal({ kind: "load", chunkId: "chunk-2-2" }, "chunk-not-streamable");
  // Residency invariants.
  expectRefusal({ kind: "load", chunkId: "chunk-2-1" }, "chunk-already-resident");
  expectRefusal({ kind: "unload", chunkId: "chunk-5-5" }, "chunk-not-resident");
  // Admitted ops return undefined (no result object to ignore).
  assert.equal(admitStreamOp(MODEL, resident, { kind: "load", chunkId: "chunk-5-5" }), undefined);
  assert.equal(admitStreamOp(MODEL, resident, { kind: "unload", chunkId: "chunk-2-1" }), undefined);
});

test("streaming: the initial world record carries only the viewpoint, the core flora and the carriers", () => {
  const state = initialWorldRecord(MODEL);
  const view = readStreamingView(state);
  assert.deepEqual(view.resident, [MODEL.coreChunkId]);
  assert.equal(view.loads, 0);
  assert.equal(view.unloads, 0);
  assert.equal(view.casFetches, 0);
  assert.equal(view.checkpointReloads, 0);
  assert.deepEqual(dormantChunkIds(state), []);
  if (state.kind !== "record") throw new Error("unreachable");
  const keys = Object.keys(state.fields).sort();
  const core = MODEL.byChunkId.get(MODEL.coreChunkId)!;
  const expected = [
    entityKeyOf(MODEL.viewpoint.ref),
    ...core.entities.map((entity) => entityKeyOf(entity.ref)),
  ].sort();
  // The two carrier pseudo-entities ride along (canonical entity paths).
  assert.equal(keys.length, expected.length + 2);
  for (const key of expected) assert.ok(keys.includes(key), `missing ${key}`);
  assert.ok(keys.some((key) => key.endsWith("/entity/streaming-state")));
  assert.ok(keys.some((key) => key.endsWith("/entity/streaming-dormant")));
});

test("streaming: loads bring chunk content in; unloads take it out per contract", () => {
  const resolver = modelResolver(MODEL);
  // Step 1: move east — the wanted set grows, chunks load from the resolver.
  const east = stepStreamingWorld(MODEL, initialWorldRecord(MODEL), [56, 40], resolver);
  let state = east.state;
  const view = readStreamingView(state);
  assert.ok(view.loads > 0);
  assert.equal(view.unloads, 0);
  assert.ok(view.resident.includes("chunk-3-2"));
  assert.ok(view.resident.includes(MODEL.coreChunkId));
  assert.ok(east.effects.some((effect) => effect.kind === "loaded" && effect.chunkId === "chunk-3-2" && effect.source === "cas"));
  assert.equal(east.refusals.length, 0);
  // The loaded chunk's flora are live in the world record now.
  if (state.kind !== "record") throw new Error("unreachable");
  const loaded = MODEL.byChunkId.get("chunk-3-2")!;
  for (const entity of loaded.entities) {
    assert.ok(state.fields[entityKeyOf(entity.ref)] !== undefined, "loaded flora must be live");
  }
  // Step 2: jump to the far corner — the eastern chunks stream out
  // (cacheable → checkpointed) and the core chunk REFUSES to leave (E8).
  const corner = stepStreamingWorld(MODEL, state, [8, 8], resolver);
  state = corner.state;
  const after = readStreamingView(state);
  assert.ok(after.unloads > 0);
  assert.equal(after.resident.includes("chunk-3-2"), false);
  const dormant = dormantChunkIds(state);
  assert.ok(dormant.includes("chunk-3-2"), "cacheable chunks park as checkpoints");
  assert.ok(corner.refusals.some((refusal) => refusal.code === "chunk-not-streamable" && refusal.op.chunkId === MODEL.coreChunkId));
  assert.ok(after.resident.includes(MODEL.coreChunkId), "the core chunk never streams out");
  const unloaded = corner.effects.find((effect) => effect.kind === "unloaded" && effect.chunkId === "chunk-3-2");
  if (unloaded?.kind !== "unloaded") throw new Error("chunk-3-2 did not unload");
  assert.match(unloaded.checkpoint ?? "", /^[0-9a-f]{64}$/);
  // Streamed-out flora are NOT live (dormant partitions do no per-tick work).
  if (state.kind !== "record") throw new Error("unreachable");
  for (const entity of loaded.entities) {
    assert.equal(state.fields[entityKeyOf(entity.ref)], undefined, "unloaded flora must not be live");
  }
});

test("streaming: cacheable chunks restore their RUNTIME state; frontier chunks re-resolve the static content", () => {
  const resolver = modelResolver(MODEL);
  // -- cacheable (interior) chunk: unload parks the RUNTIME state as a checkpoint.
  let state = stepStreamingWorld(MODEL, initialWorldRecord(MODEL), [72, 40], resolver).state;
  const interiorKey = entityKeyOf(MODEL.byChunkId.get("chunk-5-2")!.entities[0]!.ref);
  if (state.kind !== "record") throw new Error("unreachable");
  assert.ok(state.fields[interiorKey] !== undefined, "chunk-5-2 flora must be live before the unload");
  const drifted: GameIRValue = {
    kind: "record",
    fields: {
      ...state.fields,
      [interiorKey]: { kind: "record", fields: { title: { kind: "string", value: "drifted" }, charge: { kind: "int", value: 7n } } },
    },
  };
  // Stream out chunk-5-2 (the checkpoint captures the drifted state)…
  const out = stepStreamingWorld(MODEL, drifted, [40.5, 40.5], resolver);
  assert.ok(out.effects.some((effect) => effect.kind === "unloaded" && effect.chunkId === "chunk-5-2"));
  assert.ok(dormantChunkIds(out.state).includes("chunk-5-2"));
  // …and back in: the checkpoint restores the RUNTIME state.
  const backIn = stepStreamingWorld(MODEL, out.state, [72, 40], resolver);
  const restored = backIn.effects.find((effect) => effect.kind === "loaded" && effect.chunkId === "chunk-5-2");
  if (restored?.kind !== "loaded") throw new Error("chunk-5-2 did not reload");
  assert.equal(restored.source, "checkpoint");
  if (backIn.state.kind !== "record") throw new Error("unreachable");
  assert.deepEqual(backIn.state.fields[interiorKey], {
    kind: "record",
    fields: { title: { kind: "string", value: "drifted" }, charge: { kind: "int", value: 7n } },
  });

  // -- frontier (non-cacheable) chunk: unload DISCARDS state — reload re-resolves
  //    the STATIC content through the resolver (dormant as static only).
  let frontier = stepStreamingWorld(MODEL, initialWorldRecord(MODEL), [4, 60], resolver).state;
  const frontierKey = entityKeyOf(MODEL.byChunkId.get("chunk-0-3")!.entities[1]!.ref);
  if (frontier.kind !== "record") throw new Error("unreachable");
  assert.ok(frontier.fields[frontierKey] !== undefined, "chunk-0-3 flora must be live before the unload");
  const frontierDrifted: GameIRValue = {
    kind: "record",
    fields: {
      ...frontier.fields,
      [frontierKey]: { kind: "record", fields: { charge: { kind: "int", value: 9n } } },
    },
  };
  const frontierOut = stepStreamingWorld(MODEL, frontierDrifted, [40.5, 40.5], resolver);
  const discarded = frontierOut.effects.find((effect) => effect.kind === "unloaded" && effect.chunkId === "chunk-0-3");
  if (discarded?.kind !== "unloaded") throw new Error("chunk-0-3 did not unload");
  assert.equal(discarded.checkpoint, null, "frontier chunks never park a checkpoint");
  assert.equal(dormantChunkIds(frontierOut.state).includes("chunk-0-3"), false);
  const frontierBack = stepStreamingWorld(MODEL, frontierOut.state, [4, 60], resolver);
  const reResolved = frontierBack.effects.find((effect) => effect.kind === "loaded" && effect.chunkId === "chunk-0-3");
  if (reResolved?.kind !== "loaded") throw new Error("chunk-0-3 did not reload");
  assert.equal(reResolved.source, "cas");
  if (frontierBack.state.kind !== "record") throw new Error("unreachable");
  const staticFlora = frontierBack.state.fields[frontierKey];
  if (staticFlora?.kind !== "record") throw new Error("re-resolved flora must be a record");
  const charge = staticFlora.fields.charge;
  if (charge?.kind !== "int") throw new Error("re-resolved flora must carry its static charge");
  assert.equal(charge.value, 0n, "the reload re-resolves the STATIC content, not the discarded runtime state");
});

test("streaming: the state machine is pure — the same inputs replay identically (E9)", () => {
  const resolver = modelResolver(MODEL);
  const path: readonly ViewpointWaypoint[] = [
    { tick: 1, x: 40.5, y: 40.5 },
    { tick: 2, x: 70, y: 40 },
    { tick: 3, x: 24, y: 24 },
    { tick: 4, x: 100, y: 100 },
    { tick: 5, x: 40.5, y: 40.5 },
  ];
  const first = deriveStreamingSchedule(MODEL, path, resolver);
  const second = deriveStreamingSchedule(MODEL, path, resolver);
  assert.deepEqual(first, second);
  assert.ok(first.totalLoads > 0);
  assert.ok(first.totalUnloads > 0);
  assert.ok(first.totalCasFetches > 0);
  assert.ok(first.totalCheckpointReloads > 0);
  // Totals are the sums over the step effects.
  const loads = first.steps.flatMap((step) => step.effects).filter((effect) => effect.kind === "loaded").length;
  const unloads = first.steps.flatMap((step) => step.effects).filter((effect) => effect.kind === "unloaded").length;
  assert.equal(loads, first.totalLoads);
  assert.equal(unloads, first.totalUnloads);
});

test("streaming: the core chunk never streams out — the machine records the typed refusal", () => {
  const resolver = modelResolver(MODEL);
  const far = stepStreamingWorld(MODEL, initialWorldRecord(MODEL), [120, 120], resolver);
  const coreRefusal = far.refusals.find((refusal) => refusal.op.chunkId === MODEL.coreChunkId);
  if (coreRefusal === undefined) throw new Error("the core chunk streamed out without a refusal");
  assert.equal(coreRefusal.code, "chunk-not-streamable");
  assert.ok(readStreamingView(far.state).resident.includes(MODEL.coreChunkId), "the core chunk stays resident");
  // Unloaded cacheable chunks park with a content-derived checkpoint digest (E9).
  for (const effect of far.effects) {
    if (effect.kind !== "unloaded") continue;
    if (effect.chunkId === MODEL.coreChunkId) throw new Error("core chunk unload effect emitted despite refusal");
    assert.match(effect.checkpoint ?? "discarded", /^(?:[0-9a-f]{64}|discarded)$/);
  }
});
