/**
 * LATTICE — the Simulation Runtime binding (PL-039; §Runtime).
 *
 * The headless execution path (lock rule 12: shared contracts, distinct
 * execution path): a `SimulationGameBinding` over
 * `@playliquid/simulation` whose systems implement the streaming world:
 *
 * - `viewpoint-motion`: applies `lattice.view.move` commands (the
 *   recorded, replayable trajectory) to the viewpoint agent;
 * - `chunk-streaming`: runs the shared streaming state machine
 *   (streaming.ts) at the viewpoint's position — chunks load/unload as
 *   the view moves, dormant chunks park as checkpoints;
 * - `ecology-drift`: simulates ONLY the live (resident-chunk) entities —
 *   spatial partitioning means dormant partitions do no per-tick work
 *   (§Scalability).
 *
 * The blueprint is STATIC (the document is the entity authority); the
 * world record the session evolves is RUNTIME state (§World). The
 * blueprint carries the viewpoint + the core chunk's flora (the core
 * chunk is statically resident) plus the two streaming carrier records
 * under pseudo-entity ids (`streaming-state`, `streaming-dormant`) —
 * systems skip them by the documented id convention.
 *
 * Determinism (E9): systems are pure functions of (state, commands,
 * tick, seeded RNG); the same seed always produces the same trajectory.
 */

import { asCapabilityGrantId, asCapabilityId, asIntentKind, asSessionEpoch, asSessionId } from "../../../packages/runtime-contracts/src/index.ts";
import type { CapabilityGrant, DeterminismSeed, GameRefSummary, RuntimeCommandEnvelope } from "../../../packages/runtime-contracts/src/index.ts";
import { asGameIrDigest, asDigest } from "../../../packages/runtime-contracts/src/index.ts";
import type { CommandTypeId, GameEvent, GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { asEventTypeId } from "../../../packages/game-ir/src/index.ts";
import { asCommandId } from "../../../packages/runtime-contracts/src/index.ts";
import { canonicalJsonString, encodeGameIRValue, initialWorldState } from "../../../packages/simulation/src/index.ts";
import type { SimulationGameBinding, WorldBlueprint, WorldSystem } from "../../../packages/simulation/src/index.ts";
import type { WorldEntityBlueprint } from "../../../packages/simulation/src/index.ts";
import { WORLD_BOUNDS } from "./layout.ts";
import { COMMAND_KINDS, EVENT_TYPES, VIEWPOINT_CAPABILITY, VIEWPOINT_GRANT_ID, chunkLoadedPayload, chunkUnloadedPayload, entityDriftedPayload, positionValue, readPositionValue, viewMovedPayload } from "./events.ts";
import { STREAMING_DORMANT_ENTITY, STREAMING_STATE_ENTITY, carrierKeysOf, initialWorldRecord, readStreamingView, stepStreamingWorld } from "./streaming.ts";
import type { StreamEffect } from "./streaming.ts";
import { entityKeyOf } from "./world-model.ts";
import type { LatticeWorldModel } from "./world-model.ts";
import { SESSION_ID, VIEWPOINT_ACTOR } from "./ids.ts";
import type { LatticeComposition } from "./composition.ts";

/** The world identity recorded in snapshot payloads. */
export const LATTICE_WORLD_KIND = "examples.large-world/lattice@1";

/** The system ids, in declared execution order. */
export const LATTICE_SYSTEM_IDS = ["viewpoint-motion", "chunk-streaming", "ecology-drift"] as const;

const MOVED = asEventTypeId(EVENT_TYPES.viewMoved)!;
const LOADED = asEventTypeId(EVENT_TYPES.chunkLoaded)!;
const UNLOADED = asEventTypeId(EVENT_TYPES.chunkUnloaded)!;
const DRIFTED = asEventTypeId(EVENT_TYPES.entityDrifted)!;
const MOVE_COMMAND_TYPE = COMMAND_KINDS.viewMove as CommandTypeId;

/** The capability/intent bridge (the broker's coverage table input). */
const VIEWPOINT_INTENT_KIND = asIntentKind(COMMAND_KINDS.viewMove);

/** True for world-state keys that belong to simulated flora entities. */
function isFloraKey(key: string): boolean {
  const parts = key.split("/");
  const entity = parts[5];
  return parts[0] === "world" && parts[2] === "scene" && parts[4] === "entity" && /^entity-\d+-\d+-\d+$/.test(entity ?? "");
}

function eventOf(type: GameEvent["type"], payload: GameIRValue, tick: number): GameEvent {
  return { type, payload, tick: tick as GameEvent["tick"] };
}

/** The digest-pinned GameRefSummary of the composition (bare-hex bridge). */
export function gameRefSummaryOf(composition: LatticeComposition): GameRefSummary {
  return {
    gameDigest: asGameIrDigest(composition.game.gameDigest),
    world: {
      worldId: composition.game.worldId,
      revisionDigest: asDigest(composition.game.worldRevisionDigest),
    },
    policy: {
      policyId: composition.game.policyId,
      revisionDigest: asDigest(composition.game.policyRevisionDigest),
    },
  };
}

/** Clamps a world-plane position into the world bounds (half-open). */
function clampPosition(x: number, y: number): readonly [number, number] {
  const minX = WORLD_BOUNDS.min[0] + 0.5;
  const minY = WORLD_BOUNDS.min[1] + 0.5;
  const maxX = WORLD_BOUNDS.max[0] - 0.5;
  const maxY = WORLD_BOUNDS.max[1] - 0.5;
  return [Math.min(Math.max(x, minX), maxX), Math.min(Math.max(y, minY), maxY)];
}

function readFloatField(value: GameIRValue, field: string): number {
  if (value.kind !== "record") throw new Error("lattice: expected a record payload");
  const item = value.fields[field];
  if (item === undefined || item.kind !== "float") throw new Error(`lattice: expected float field ${field}`);
  return item.value;
}

/** Reads the viewpoint position out of the world record (fail closed). */
function viewpointPosition(state: GameIRValue): readonly [number, number] {
  const viewpoint = stateOfKey(state, viewpointKeyOf(state));
  const position = readPositionValue(viewpoint);
  return [position[0], position[1]];
}

/** Reads one record field by key (fail closed). */
function stateOfKey(state: GameIRValue, key: string): GameIRValue {
  if (state.kind !== "record") throw new Error("lattice: world state must be a record");
  const value = state.fields[key];
  if (value === undefined) throw new Error(`lattice: world state field ${key} missing`);
  return value;
}

/** The record member of the value language (the world-state shape). */
type WorldRecord = Extract<GameIRValue, { kind: "record" }>;

/** Replaces one world-record field (pure). */
function withField(state: WorldRecord, key: string, next: GameIRValue): WorldRecord {
  return { kind: "record", fields: { ...state.fields, [key]: next } };
}

function viewpointKeyOf(state: GameIRValue): string {
  if (state.kind !== "record") throw new Error("lattice: world state must be a record");
  const key = Object.keys(state.fields).find((candidate) => candidate.endsWith("/entity/entity-viewpoint"));
  if (key === undefined) throw new Error("lattice: viewpoint entity missing from the world state");
  return key;
}

/**
 * The lattice world systems, in declared execution order. The static
 * world model and the chunk-content resolver are captured in the closure
 * (static wiring); all mutable state lives in the world the session owns.
 */
export function latticeSystems(model: LatticeWorldModel, composition: LatticeComposition): readonly WorldSystem[] {
  const resolver = composition.graph.resolver;

  const viewpointMotion: WorldSystem = {
    systemId: "viewpoint-motion",
    tick: (input) => {
      let state = input.state;
      const events: { event: GameEvent; cause: { kind: "command"; commandId: ReturnType<typeof asCommandId> } }[] = [];
      for (const command of input.commands) {
        if (String(command.kind) !== MOVE_COMMAND_TYPE) continue;
        const payload = command.payload;
        const [x, y] = viewpointPosition(state);
        const [nextX, nextY] = clampPosition(x + readFloatField(payload, "dx"), y + readFloatField(payload, "dy"));
        state = withViewpointPosition(state, [nextX, nextY, 2]);
        events.push({
          event: eventOf(MOVED, viewMovedPayload(nextX, nextY, Number(input.tick)), input.tick),
          cause: { kind: "command", commandId: asCommandId(command.commandId) },
        });
      }
      return { state, events };
    },
  };

  const chunkStreaming: WorldSystem = {
    systemId: "chunk-streaming",
    tick: (input) => {
      const [x, y] = viewpointPosition(input.state);
      const step = stepStreamingWorld(model, input.state, [x, y], resolver);
      const events: { event: GameEvent; cause: { kind: "system" } }[] = [];
      for (const effect of step.effects) {
        for (const event of eventsOfEffect(model, effect, Number(input.tick))) {
          events.push({ event, cause: { kind: "system" } });
        }
      }
      return { state: step.state, events };
    },
  };

  const ecologyDrift: WorldSystem = {
    systemId: "ecology-drift",
    tick: (input) => {
      let state = input.state;
      const events: { event: GameEvent; cause: { kind: "system" } }[] = [];
      if (state.kind !== "record") throw new Error("lattice: world state must be a record");
      // Keys are computed once: the drift system only replaces field
      // VALUES, never adds or removes entities (streaming does that).
      const keys = Object.keys(state.fields).sort();
      for (const key of keys) {
        if (!isFloraKey(key)) continue;
        const current = state.fields[key];
        if (current === undefined || current.kind !== "record") continue;
        const position = readPositionValue(current);
        const charge: GameIRValue | undefined = current.fields.charge;
        const nextCharge: bigint = charge !== undefined && charge.kind === "int" ? charge.value + 1n : 0n;
        const next: GameIRValue = {
          kind: "record",
          fields: {
            ...current.fields,
            position: positionValue([
              position[0] + (input.rng.nextUniform() - 0.5) * 0.2,
              position[1] + (input.rng.nextUniform() - 0.5) * 0.2,
              position[2],
            ]),
            charge: { kind: "int", value: nextCharge },
          },
        };
        state = withField(state, key, next);
        const nextPosition = readPositionValue(next);
        events.push({
          event: eventOf(DRIFTED, entityDriftedPayload(key.split("/")[5]!, nextPosition[0], nextPosition[1], Number(input.tick)), input.tick),
          cause: { kind: "system" },
        });
      }
      return { state, events };
    },
  };

  return [viewpointMotion, chunkStreaming, ecologyDrift];
}

/** Maps one streaming effect to its declared event payload. */
function eventsOfEffect(model: LatticeWorldModel, effect: StreamEffect, tick: number): readonly GameEvent[] {
  if (effect.kind === "loaded") {
    const chunk = model.byChunkId.get(effect.chunkId);
    if (chunk === undefined) return [];
    return [eventOf(LOADED, chunkLoadedPayload(effect.chunkId, chunk.regionId, chunk.zoneId, effect.source, tick), tick)];
  }
  return [eventOf(UNLOADED, chunkUnloadedPayload(effect.chunkId, effect.checkpoint ?? "discarded", tick), tick)];
}

/** Replaces the viewpoint position field (pure; the world record is preserved). */
function withViewpointPosition(state: GameIRValue, position: readonly [number, number, number]): GameIRValue {
  if (state.kind !== "record") throw new Error("lattice: world state must be a record");
  const key = viewpointKeyOf(state);
  const current = state.fields[key];
  if (current === undefined || current.kind !== "record") throw new Error("lattice: viewpoint state must be a record");
  return withField(state, key, { kind: "record", fields: { ...current.fields, position: positionValue(position) } });
}
/**
 * The blueprint of the streamed session start: the viewpoint, the core
 * chunk's flora and the two streaming carrier records (pseudo-entity ids
 * the systems never simulate). `initialWorldState` over this equals
 * `initialWorldRecord` (the streaming module's canonical initial state).
 */
export function latticeBlueprint(model: LatticeWorldModel): WorldBlueprint {
  const core = model.byChunkId.get(model.coreChunkId);
  if (core === undefined) throw new Error("lattice: core chunk missing from the world model");
  const entities: WorldEntityBlueprint[] = [
    { ref: model.viewpoint.ref, state: model.viewpoint.state },
    ...core.entities.map((entity) => ({ ref: entity.ref, state: entity.state })),
    { ref: { world: model.world, scene: core.scene, entity: STREAMING_STATE_ENTITY }, state: initialStreamingCarrier(model) },
    { ref: { world: model.world, scene: core.scene, entity: STREAMING_DORMANT_ENTITY }, state: { kind: "record", fields: {} } },
  ];
  return { entities, partitioning: model.partitioning };
}

function initialStreamingCarrier(model: LatticeWorldModel): GameIRValue {
  const initial = initialWorldRecord(model);
  if (initial.kind !== "record") throw new Error("lattice: initial record must be a record");
  return initial.fields[carrierKeysOf(model).state]!;
}

/**
 * The full simulation game binding of the streamed lattice world. The
 * blueprint's initial state equals {@link initialWorldRecord}; the
 * systems are {@link latticeSystems}.
 */
export function buildLatticeBinding(composition: LatticeComposition, options: { readonly sessionId?: string } = {}): SimulationGameBinding {
  const model = composition.model;
  const blueprint = latticeBlueprint(model);
  const seededForm = canonicalJsonString(encodeGameIRValue(initialWorldState(blueprint)));
  const canonicalForm = canonicalJsonString(encodeGameIRValue(initialWorldRecord(model)));
  if (seededForm !== canonicalForm) {
    throw new Error("lattice: blueprint initial state diverges from the canonical streaming record");
  }
  return {
    game: gameRefSummaryOf(composition),
    blueprint,
    systems: latticeSystems(model, composition),
    commandPolicy: { [COMMAND_KINDS.viewMove]: ["ready", "running"] },
    capabilityIntentKinds: { [VIEWPOINT_CAPABILITY]: [VIEWPOINT_INTENT_KIND] },
    grants: [viewpointGrant(options.sessionId ?? SESSION_ID, 1)],
  };
}

/** The host game policy's per-epoch viewpoint grant (lock rule 14). */
export function viewpointGrant(sessionId: string, epoch: number): CapabilityGrant {
  return {
    grantId: asCapabilityGrantId(VIEWPOINT_GRANT_ID),
    holder: { actorClass: "avatar-agent", actorId: VIEWPOINT_ACTOR },
    capability: asCapabilityId(VIEWPOINT_CAPABILITY),
    scope: { sessionId: asSessionId(sessionId) },
    constraints: [],
    issuedBy: "host-game-policy",
    epoch: asSessionEpoch(epoch),
  };
}

/** Reads the streaming view out of a live session world state. */
export function streamingViewOf(world: GameIRValue): ReturnType<typeof readStreamingView> {
  return readStreamingView(world);
}

/** The streaming carrier pseudo-entity ids (test surface). */
export const CARRIER_ENTITY_IDS = { state: STREAMING_STATE_ENTITY, dormant: STREAMING_DORMANT_ENTITY } as const;

/** Entity-key projection helper (canonical key of the viewpoint). */
export function viewpointEntityKey(model: LatticeWorldModel): string {
  return entityKeyOf(model.viewpoint.ref);
}

/** A determinism seed of this example (E9 helper). */
export function latticeSeed(variant = 1): DeterminismSeed {
  return `lattice-seed-v${String(variant)}` as DeterminismSeed;
}

/** Applies one recorded command envelope's payload to compute the next planned viewpoint position (pure, schedule input). */
export function plannedPositionAfter(position: readonly [number, number], command: RuntimeCommandEnvelope<GameIRValue>): readonly [number, number] {
  return clampPosition(position[0] + readFloatField(command.payload, "dx"), position[1] + readFloatField(command.payload, "dy"));
}
