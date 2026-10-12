/**
 * LATTICE — chunk streaming, the R15 core (PL-039; §World, §Scalability).
 *
 * "Chunks can be independently streamed/cached/built when the contract
 * permits" (§World). This module is THE streaming semantics, as pure
 * functions over the world-state record (GameIR value language):
 *
 * - {@link wantedChunkIds}: the deterministic wanted-set derivation from a
 *   moving viewpoint (circle vs chunk bounds, sorted);
 * - {@link admitStreamOp}: the CONTRACT gate — typed refusals when the
 *   chunk's streaming policy forbids the op (E8);
 * - {@link stepStreamingWorld}: one tick of streaming — diff wanted vs
 *   resident, admit, apply. Loads bring entity fields into the live
 *   record (from a dormant CHECKPOINT when the chunk is cacheable, else
 *   freshly re-resolved through the CAS resolver); unloads remove them
 *   (writing the checkpoint for cacheable chunks, discarding state for
 *   non-cacheable ones). Dormant chunks are carried as static + these
 *   checkpoints — exactly the §Scalability discipline;
 * - {@link deriveStreamingSchedule}: the deterministic streaming schedule
 *   over a planned viewpoint path (pure evidence — the same state
 *   machine, driven without a session).
 *
 * Both the simulation binding (inside the Simulation Runtime) and the
 * schedule derivation call the SAME functions — one authority (E1/E2).
 *
 * Pure module: no IO (the resolver is an injected port), no clocks, no
 * randomness.
 */

import { asEntityId } from "../../../packages/game-contracts/src/index.ts";
import type { EntityId, SceneId, WorldId } from "../../../packages/game-contracts/src/index.ts";
import { hashGameIRValue } from "../../../packages/game-ir/src/index.ts";
import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";
import type { LatticeWorldModel } from "./world-model.ts";
import { entityKeyOf } from "./world-model.ts";

/** The view radius (world units) of the streaming wanted-set. */
export const VIEW_RADIUS = 24;

/**
 * The pseudo-entity ids of the two streaming carrier records (never
 * simulated — the ecology system skips them by the documented id
 * convention). The carriers live in the CORE chunk's scene so the session
 * blueprint (`initialWorldState` over entity refs) reproduces the canonical
 * initial world record field-for-field: the world-state key of a carrier is
 * its canonical entity path.
 */
export const STREAMING_STATE_ENTITY = asEntityId("streaming-state")!;
export const STREAMING_DORMANT_ENTITY = asEntityId("streaming-dormant")!;

/** The canonical world-state keys of the two carriers (model-relative). */
export interface CarrierKeys {
  readonly state: string;
  readonly dormant: string;
}

/** Computes the carrier keys for a world model (pure, deterministic). */
export function carrierKeysOf(model: LatticeWorldModel): CarrierKeys {
  const core = model.byChunkId.get(model.coreChunkId);
  if (core === undefined) throw new Error("lattice: core chunk missing from the world model");
  return {
    state: carrierKey(model.world, core.scene, STREAMING_STATE_ENTITY),
    dormant: carrierKey(model.world, core.scene, STREAMING_DORMANT_ENTITY),
  };
}

function carrierKey(world: WorldId, scene: SceneId, entity: EntityId): string {
  return entityKeyOf({ world, scene, entity });
}

/** One planned viewpoint position at a tick (schedule input). */
export interface ViewpointWaypoint {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// Value-language read/write helpers (fail closed)
// ---------------------------------------------------------------------------

function fieldsOf(value: GameIRValue): { [key: string]: GameIRValue } {
  if (value.kind !== "record") throw new Error("lattice: world state must be a record value");
  return { ...value.fields };
}

function readField(value: GameIRValue, field: string): GameIRValue {
  if (value.kind !== "record" || value.fields[field] === undefined) {
    throw new Error(`lattice: expected field ${field}`);
  }
  return value.fields[field]!;
}

/**
 * Reads one carrier record out of a world state by its pseudo-entity id
 * (fail closed: exactly one canonical path must end in the carrier id).
 */
function carrierField(state: GameIRValue, entity: string): GameIRValue {
  if (state.kind !== "record") throw new Error("lattice: world state must be a record value");
  const matches = Object.keys(state.fields).filter((key) => key.endsWith(`/entity/${entity}`));
  if (matches.length !== 1) {
    throw new Error(`lattice: expected exactly one ${entity} carrier record, found ${String(matches.length)}`);
  }
  return state.fields[matches[0]!]!;
}

function readInt(value: GameIRValue, field: string): number {
  const item = readField(value, field);
  if (item.kind !== "int") throw new Error(`lattice: field ${field} must be an int`);
  return Number(item.value);
}

function readStringList(value: GameIRValue, field: string): readonly string[] {
  const item = readField(value, field);
  if (item.kind !== "list" || !item.items.every((entry) => entry.kind === "string")) {
    throw new Error(`lattice: field ${field} must be a list of strings`);
  }
  return item.items.map((entry) => (entry.kind === "string" ? entry.value : ""));
}

function stringValue(value: string): GameIRValue {
  return { kind: "string", value };
}

function intValue(value: number): GameIRValue {
  return { kind: "int", value: BigInt(value) };
}

// ---------------------------------------------------------------------------
// Runtime streaming state (§World: positions/residency are RUNTIME state)
// ---------------------------------------------------------------------------

/** The decoded streaming runtime state. */
export interface StreamingView {
  readonly resident: readonly string[];
  readonly loads: number;
  readonly unloads: number;
  readonly casFetches: number;
  readonly checkpointReloads: number;
}

/** Reads the streaming view out of a world-state record. */
export function readStreamingView(state: GameIRValue): StreamingView {
  const field = carrierField(state, STREAMING_STATE_ENTITY);
  return {
    resident: readStringList(field, "resident"),
    loads: readInt(field, "loads"),
    unloads: readInt(field, "unloads"),
    casFetches: readInt(field, "casFetches"),
    checkpointReloads: readInt(field, "checkpointReloads"),
  };
}

function streamingStateValue(resident: readonly string[], view: StreamingView): GameIRValue {
  return {
    kind: "record",
    fields: {
      resident: { kind: "list", items: [...resident].sort().map(stringValue) },
      loads: intValue(view.loads),
      unloads: intValue(view.unloads),
      casFetches: intValue(view.casFetches),
      checkpointReloads: intValue(view.checkpointReloads),
    },
  };
}

// ---------------------------------------------------------------------------
// Dormant checkpoints (dormant chunks carried as static + checkpoints)
// ---------------------------------------------------------------------------

/** One dormant-chunk checkpoint (the chunk's last live entity states). */
export interface DormantCheckpoint {
  readonly digest: string;
  readonly entities: readonly { readonly key: string; readonly state: GameIRValue }[];
}

function readDormantLedger(state: GameIRValue): Map<string, DormantCheckpoint> {
  const ledger = new Map<string, DormantCheckpoint>();
  const field = carrierField(state, STREAMING_DORMANT_ENTITY);
  if (field.kind !== "record") throw new Error("lattice: dormant ledger must be a record");
  for (const [chunkId, entry] of Object.entries(field.fields)) {
    if (entry === undefined || entry.kind !== "record") continue;
    const digest = readField(entry, "digest");
    const entities = readField(entry, "entities");
    if (digest.kind !== "string" || entities.kind !== "record") continue;
    ledger.set(chunkId, {
      digest: digest.value,
      entities: Object.entries(entities.fields).flatMap(([key, value]) => (value === undefined ? [] : [{ key, state: value }])),
    });
  }
  return ledger;
}

function dormantLedgerValue(ledger: ReadonlyMap<string, DormantCheckpoint>): GameIRValue {
  const fields: { [key: string]: GameIRValue } = {};
  for (const chunkId of [...ledger.keys()].sort()) {
    const checkpoint = ledger.get(chunkId)!;
    const entityFields: { [key: string]: GameIRValue } = {};
    for (const entity of checkpoint.entities) {
      entityFields[entity.key] = entity.state;
    }
    fields[chunkId] = {
      kind: "record",
      fields: { digest: stringValue(checkpoint.digest), entities: { kind: "record", fields: entityFields } },
    };
  }
  return { kind: "record", fields };
}

/** The dormant (checkpoint-carrying) chunk ids of a world state (sorted). */
export function dormantChunkIds(state: GameIRValue): readonly string[] {
  return [...readDormantLedger(state).keys()].sort();
}

// ---------------------------------------------------------------------------
// Wanted-set derivation + contract admission (E8 typed refusals)
// ---------------------------------------------------------------------------

/** The wanted chunk set of a viewpoint position (circle vs chunk bounds, sorted). */
export function wantedChunkIds(model: LatticeWorldModel, x: number, y: number, radius: number = VIEW_RADIUS): readonly string[] {
  const wanted: string[] = [];
  for (const chunk of model.chunks) {
    const bounds = chunk.bounds;
    const nearestX = Math.min(Math.max(x, bounds.min[0]), bounds.max[0]);
    const nearestY = Math.min(Math.max(y, bounds.min[1]), bounds.max[1]);
    const dx = x - nearestX;
    const dy = y - nearestY;
    if (dx * dx + dy * dy <= radius * radius) {
      wanted.push(chunk.id);
    }
  }
  return wanted.sort();
}

/** One streaming operation. */
export type StreamOp = { readonly kind: "load" | "unload"; readonly chunkId: string };

/** The typed refusal codes of the streaming contract (E8). */
export type StreamRefusalCode = "chunk-unknown" | "chunk-not-streamable" | "chunk-already-resident" | "chunk-not-resident";

/** One typed streaming refusal. */
export interface StreamRefusal {
  readonly op: StreamOp;
  readonly code: StreamRefusalCode;
  readonly detail: string;
}

/**
 * The CONTRACT gate: admits a stream op against the chunk's streaming
 * policy and the current residency. Returns `undefined` when admitted.
 */
export function admitStreamOp(model: LatticeWorldModel, resident: ReadonlySet<string>, op: StreamOp): StreamRefusal | undefined {
  const chunk = model.byChunkId.get(op.chunkId);
  if (chunk === undefined) {
    return { op, code: "chunk-unknown", detail: `chunk ${op.chunkId} is not part of the world model` };
  }
  if (!chunk.policy.streamable) {
    return {
      op,
      code: "chunk-not-streamable",
      detail: `chunk ${op.chunkId} declares streamable:false — it is ${op.kind === "unload" ? "always resident" : "statically resident"} and never participates in streaming`,
    };
  }
  if (op.kind === "load" && resident.has(op.chunkId)) {
    return { op, code: "chunk-already-resident", detail: `chunk ${op.chunkId} is already resident` };
  }
  if (op.kind === "unload" && !resident.has(op.chunkId)) {
    return { op, code: "chunk-not-resident", detail: `chunk ${op.chunkId} is not resident` };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Chunk static content resolution (the CAS-backed port)
// ---------------------------------------------------------------------------

/** One statically-defined chunk resolved for a fresh load. */
export interface ChunkStaticContent {
  readonly chunkId: string;
  readonly entities: readonly { readonly key: string; readonly state: GameIRValue }[];
}

/** Typed resolution failures of the chunk-content port. */
export interface ChunkResolutionRefusal {
  readonly code: "chunk-unknown" | "chunk-unpublished" | "chunk-content-corrupt";
  readonly detail: string;
}

/** The port fresh loads resolve through (registry + CAS wiring lives upstream). */
export interface ChunkStaticResolver {
  resolve(chunkId: string): { readonly ok: true; readonly content: ChunkStaticContent } | { readonly ok: false } & ChunkResolutionRefusal;
}

// ---------------------------------------------------------------------------
// The streaming state machine (one authority for session + schedule)
// ---------------------------------------------------------------------------

/** One applied streaming effect. */
export type StreamEffect =
  | { readonly kind: "loaded"; readonly chunkId: string; readonly source: "cas" | "checkpoint" }
  | { readonly kind: "unloaded"; readonly chunkId: string; readonly checkpoint: string | null };

/** The result of one streaming step. */
export interface StreamingStep {
  readonly state: GameIRValue;
  readonly effects: readonly StreamEffect[];
  readonly refusals: readonly StreamRefusal[];
}

/**
 * The initial world-state record: the viewpoint, the core chunk's flora
 * (the core chunk is statically resident) and the two streaming carriers
 * under their canonical pseudo-entity keys. Dormant chunks (and all other
 * entities) are NOT live — they stream in.
 */
export function initialWorldRecord(model: LatticeWorldModel): GameIRValue {
  const keys = carrierKeysOf(model);
  const core = model.byChunkId.get(model.coreChunkId);
  if (core === undefined) throw new Error("lattice: core chunk missing from the world model");
  const fields: { [key: string]: GameIRValue } = {};
  fields[entityKeyOf(model.viewpoint.ref)] = model.viewpoint.state;
  for (const entity of core.entities) {
    fields[entityKeyOf(entity.ref)] = entity.state;
  }
  fields[keys.state] = streamingStateValue([model.coreChunkId], {
    resident: [],
    loads: 0,
    unloads: 0,
    casFetches: 0,
    checkpointReloads: 0,
  });
  fields[keys.dormant] = dormantLedgerValue(new Map());
  return { kind: "record", fields };
}

/** Advances the streaming state machine by one tick at `position`. */
export function stepStreamingWorld(
  model: LatticeWorldModel,
  state: GameIRValue,
  position: readonly [number, number],
  resolver: ChunkStaticResolver,
): StreamingStep {
  const carrierKeys = carrierKeysOf(model);
  const fields = fieldsOf(state);
  const view = readStreamingView(state);
  const residentSet = new Set(view.resident);
  const dormant = readDormantLedger(state);
  const wanted = wantedChunkIds(model, position[0], position[1]);
  const effects: StreamEffect[] = [];
  const refusals: StreamRefusal[] = [];
  let loads = view.loads;
  let unloads = view.unloads;
  let casFetches = view.casFetches;
  let checkpointReloads = view.checkpointReloads;

  // 1. Unload pass: resident chunks that are no longer wanted.
  for (const chunkId of view.resident) {
    if (wanted.includes(chunkId)) continue;
    const op: StreamOp = { kind: "unload", chunkId };
    const refusal = admitStreamOp(model, residentSet, op);
    if (refusal !== undefined) {
      refusals.push(refusal);
      continue;
    }
    const chunk = model.byChunkId.get(chunkId)!;
    const entities: { key: string; state: GameIRValue }[] = [];
    for (const entity of chunk.entities) {
      const key = entityKeyOf(entity.ref);
      const live = fields[key];
      if (live !== undefined) {
        entities.push({ key, state: live });
      }
      delete fields[key];
    }
    let checkpoint: string | null = null;
    if (chunk.policy.cacheable) {
      checkpoint = hashGameIRValue({ kind: "record", fields: Object.fromEntries(entities.map((entity) => [entity.key, entity.state])) });
      dormant.set(chunkId, { digest: checkpoint, entities });
    } else {
      dormant.delete(chunkId);
    }
    residentSet.delete(chunkId);
    unloads += 1;
    effects.push({ kind: "unloaded", chunkId, checkpoint });
  }

  // 2. Load pass: wanted chunks that are not resident.
  for (const chunkId of wanted) {
    if (residentSet.has(chunkId)) continue;
    const op: StreamOp = { kind: "load", chunkId };
    const refusal = admitStreamOp(model, residentSet, op);
    if (refusal !== undefined) {
      refusals.push(refusal);
      continue;
    }
    const checkpoint = dormant.get(chunkId);
    if (checkpoint !== undefined) {
      for (const entity of checkpoint.entities) {
        fields[entity.key] = entity.state;
      }
      // The checkpoint is consumed by the reload: the chunk is LIVE now
      // (dormancy means non-resident, carried as static + checkpoint).
      dormant.delete(chunkId);
      checkpointReloads += 1;
      effects.push({ kind: "loaded", chunkId, source: "checkpoint" });
    } else {
      const resolved = resolver.resolve(chunkId);
      if (!resolved.ok) {
        refusals.push({ op, code: "chunk-unknown", detail: `resolver refused chunk ${chunkId}: ${resolved.code} — ${resolved.detail}` });
        continue;
      }
      for (const entity of resolved.content.entities) {
        fields[entity.key] = entity.state;
      }
      casFetches += 1;
      effects.push({ kind: "loaded", chunkId, source: "cas" });
    }
    residentSet.add(chunkId);
    loads += 1;
  }

  fields[carrierKeys.state] = streamingStateValue([...residentSet], {
    resident: [],
    loads,
    unloads,
    casFetches,
    checkpointReloads,
  });
  fields[carrierKeys.dormant] = dormantLedgerValue(dormant);
  return { state: { kind: "record", fields }, effects, refusals };
}

// ---------------------------------------------------------------------------
// The deterministic streaming schedule (R15 evidence, session-free)
// ---------------------------------------------------------------------------

/** One scheduled step: the planned position, the applied effects, the refusals. */
export interface StreamingScheduleStep {
  readonly tick: number;
  readonly position: readonly [number, number];
  readonly effects: readonly StreamEffect[];
  readonly refusals: readonly StreamRefusal[];
}

/** A derived streaming schedule (pure over the planned path). */
export interface StreamingSchedule {
  readonly steps: readonly StreamingScheduleStep[];
  readonly totalLoads: number;
  readonly totalUnloads: number;
  readonly totalCasFetches: number;
  readonly totalCheckpointReloads: number;
}

/**
 * Derives the deterministic streaming schedule of a planned viewpoint
 * path: the same state machine the simulation runs, driven without a
 * session (pure evidence — R15's "chunks load/unload as the view moves").
 */
export function deriveStreamingSchedule(
  model: LatticeWorldModel,
  waypoints: readonly ViewpointWaypoint[],
  resolver: ChunkStaticResolver,
): StreamingSchedule {
  let state = initialWorldRecord(model);
  const steps: StreamingScheduleStep[] = [];
  let totalLoads = 0;
  let totalUnloads = 0;
  let totalCasFetches = 0;
  let totalCheckpointReloads = 0;
  for (const waypoint of waypoints) {
    const step = stepStreamingWorld(model, state, [waypoint.x, waypoint.y], resolver);
    state = step.state;
    for (const effect of step.effects) {
      if (effect.kind === "loaded") {
        totalLoads += 1;
        if (effect.source === "cas") totalCasFetches += 1;
        else totalCheckpointReloads += 1;
      } else {
        totalUnloads += 1;
      }
    }
    steps.push({ tick: waypoint.tick, position: [waypoint.x, waypoint.y], effects: step.effects, refusals: step.refusals });
  }
  return { steps, totalLoads, totalUnloads, totalCasFetches, totalCheckpointReloads };
}
