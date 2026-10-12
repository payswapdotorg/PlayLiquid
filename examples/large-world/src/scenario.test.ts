/**
 * SCENARIO TESTS (PL-039; R15, static/runtime) — the canonical streaming
 * scenario end-to-end: the SESSION's streaming counters must equal the
 * pure SCHEDULE's totals (one state machine, two drivers), the planned
 * path is the recorded path, and the STATIC definition never moves while
 * the RUNTIME record does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { latticeDocument } from "./document.ts";
import { deriveWorldModel } from "./world-model.ts";
import { chunkStaticContent } from "./world-model.ts";
import { carrierKeysOf, dormantChunkIds, initialWorldRecord, readStreamingView } from "./streaming.ts";
import { plannedWaypoints, runCanonicalScenario } from "./scenario.ts";
import type { LatticeScenario } from "./scenario.ts";
import { BOUNDARY_TICK, FINAL_TICK, POST_MOVES, PRE_MOVES } from "./replay.ts";

/** Runs the canonical scenario once and caches it for the whole file. */
let cached: LatticeScenario | undefined;
async function scenario(): Promise<LatticeScenario> {
  cached ??= await runCanonicalScenario();
  return cached;
}

test("scenario: the session's streaming counters equal the pure schedule's totals (one authority)", async () => {
  const run = await scenario();
  const { stats, schedule } = run;
  assert.equal(stats.loads, schedule.totalLoads);
  assert.equal(stats.unloads, schedule.totalUnloads);
  assert.equal(stats.casFetches, schedule.totalCasFetches);
  assert.equal(stats.checkpointReloads, schedule.totalCheckpointReloads);
  // The schedule covers exactly the ticks the session ran.
  assert.equal(schedule.steps.length, FINAL_TICK);
  assert.equal(stats.tick, FINAL_TICK);
  assert.ok(stats.loads > 0);
  assert.ok(stats.unloads > 0);
  assert.ok(stats.casFetches > 0);
  assert.ok(stats.checkpointReloads > 0);
  // The schedule derivation is deterministic (E9).
  assert.deepEqual(run.schedule, {
    ...run.schedule,
    steps: run.schedule.steps.map((step) => ({ tick: step.tick, position: step.position, effects: step.effects, refusals: step.refusals })),
  });
});

test("scenario: the planned path is the recorded path (the moved-events match the waypoints)", async () => {
  const run = await scenario();
  const waypoints = plannedWaypoints();
  assert.equal(waypoints.length, FINAL_TICK);
  const moved = run.allEvents.filter((event) => String(event.kind) === "lattice.view.moved");
  assert.equal(moved.length, PRE_MOVES.length + POST_MOVES.length);
  // Every move event's payload position equals the planned waypoint of its tick.
  for (const event of moved) {
    const waypoint = waypoints[Number(event.tick) - 1];
    if (waypoint === undefined) throw new Error(`no waypoint at tick ${Number(event.tick)}`);
    const payload = event.payload;
    if (payload.kind !== "record") throw new Error("unreachable");
    const x = payload.fields.x;
    const y = payload.fields.y;
    if (x?.kind !== "float" || y?.kind !== "float") throw new Error("malformed moved payload");
    assert.equal(x.value, waypoint.x, `tick ${Number(event.tick)} x`);
    assert.equal(y.value, waypoint.y, `tick ${Number(event.tick)} y`);
  }
  // The scripted moves are exactly the recorded ones, boundary-ordered.
  assert.deepEqual(
    run.commands.map((command) => ({ seq: command.admissionSeq, due: command.dueTick })),
    [...PRE_MOVES, ...POST_MOVES].map((move, index) => ({ seq: index + 1, due: move.dueTick })),
  );
  assert.equal(run.boundary.tick, BOUNDARY_TICK);
});

test("scenario: the core chunk stays resident; dormant chunks park as checkpoints", async () => {
  const run = await scenario();
  const world = run.session.worldState;
  if (world === undefined) throw new Error("no world state");
  const view = readStreamingView(world);
  assert.ok(view.resident.includes(run.composition.model.coreChunkId), "the core chunk never streams out");
  const dormant = dormantChunkIds(world);
  assert.ok(dormant.length > 0);
  assert.equal(dormant.length, run.stats.dormantCount);
  // Dormant chunks are not resident (dormancy is a distinct state).
  for (const chunkId of dormant) {
    assert.equal(view.resident.includes(chunkId), false, `${chunkId} cannot be dormant AND resident`);
  }
  assert.equal(view.resident.length, run.stats.finalResidentCount);
});

test("scenario: static definition vs runtime state are never conflated", async () => {
  const run = await scenario();
  const model = run.composition.model;
  // The static side (document → model) is untouched by the run.
  assert.deepEqual(run.composition.document, latticeDocument());
  assert.deepEqual(model, deriveWorldModel(latticeDocument()));
  // The runtime side DID move: the live record diverged from the initial one.
  const world = run.session.worldState!;
  const view = readStreamingView(world);
  assert.ok(view.loads > 0 || view.checkpointReloads > 0);
  if (world.kind !== "record") throw new Error("unreachable");
  const initial = initialWorldRecord(model);
  assert.notDeepEqual(world, initial);
  // A dormant checkpoint carries RUNTIME state (drifted charge), while the
  // model's static content for the same entity is still the authored state.
  const dormantKey = carrierKeysOf(model).dormant;
  const dormantCarrier = world.fields[dormantKey];
  if (dormantCarrier?.kind !== "record") throw new Error("dormant carrier missing");
  const dormantId = dormantChunkIds(world).find((chunkId) => !view.resident.includes(chunkId));
  if (dormantId === undefined) throw new Error("no truly dormant chunk");
  const checkpoint = dormantCarrier.fields[dormantId];
  if (checkpoint?.kind !== "record") throw new Error("checkpoint missing");
  const entities = checkpoint.fields.entities;
  if (entities?.kind !== "record") throw new Error("checkpoint entities missing");
  const staticContent = chunkStaticContent(model, dormantId);
  if (staticContent.kind !== "record") throw new Error("unreachable");
  for (const [key, runtimeState] of Object.entries(entities.fields)) {
    const staticState = staticContent.fields[key];
    if (staticState === undefined || runtimeState === undefined) throw new Error("checkpoint/entity mismatch");
    if (runtimeState.kind !== "record" || staticState.kind !== "record") throw new Error("unreachable");
    const runtimeCharge = runtimeState.fields.charge;
    const staticCharge = staticState.fields.charge;
    if (runtimeCharge?.kind !== "int" || staticCharge?.kind !== "int") throw new Error("charge missing");
    assert.ok(runtimeCharge.value > staticCharge.value, "the checkpoint carries RUNTIME drift the static content never sees");
  }
});

test("scenario: the run leaves typed refusal evidence (the core chunk, every far tick)", async () => {
  const run = await scenario();
  const refusals = run.schedule.steps.flatMap((step) => step.refusals.map((refusal) => `${String(step.tick)}:${refusal.code}`));
  assert.ok(refusals.length > 0, "the far ticks must refuse the core-chunk unload");
  assert.ok(refusals.every((entry) => entry.endsWith(":chunk-not-streamable")));
});
