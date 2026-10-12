/**
 * LATTICE — the GameIR document (PL-039).
 *
 * The STATIC world definition as engine-independent semantic data
 * (§World): world topology (the uniform-grid partitioning + the world
 * streaming contract), 16 zone scenes, 193 entities (one viewpoint agent
 * plus three flora entities per chunk, initial states in the value
 * language), the mechanics (rule nodes), the event declarations with
 * payload shapes and the platform capability declaration (replay — R8:
 * the world DECLARES it; the platform owns it).
 *
 * This is a LARGE world as data: the document is generated
 * deterministically from the layout module (pure function, no
 * randomness), so the same document bytes always derive.
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { asNodeId } from "../../../packages/game-ir/src/index.ts";
import type { GameIRDocument, GameIRNode, GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { asEntityId, asWorldId } from "../../../packages/game-contracts/src/index.ts";
import type { EntityId, SceneId, StreamingPolicy } from "../../../packages/game-contracts/src/index.ts";
import { LATTICE_COMMIT, LATTICE_ID, LATTICE_REPO } from "./ids.ts";
import { EVENT_TYPE_IDS, INTENT_TYPE_IDS, PAYLOAD_SHAPES, positionValue } from "./events.ts";
import { CHUNK_PARTITIONING, SPAWN, deriveLayout } from "./layout.ts";
import type { ChunkCell } from "./layout.ts";

/** The entry world. */
export const LATTICE_WORLD = asWorldId("world-lattice")!;
/** The viewpoint entity (the moving agent the streaming schedule follows). */
export const VIEWPOINT_ENTITY = asEntityId("entity-viewpoint")!;

/** The world-level streaming contract (chunk-level refinements live in the world model). */
export const WORLD_STREAMING: StreamingPolicy = { streamable: true, cacheable: true, independentlyBuilt: false };

const node = asNodeId;
const layout = deriveLayout();

/** The core chunk (contains the spawn; never streams out). */
export const CORE_CHUNK_ID = "chunk-2-2" as const;

/** Flora entity ids of one chunk (three per chunk, deterministic). */
export function floraEntityIds(chunkId: string): readonly EntityId[] {
  const [cx, cy] = chunkId.split("-").slice(1).map((part) => Number(part));
  return [1, 2, 3].map((n) => asEntityId(`entity-${String(cx)}-${String(cy)}-${String(n)}`)!) as readonly EntityId[];
}

/** The initial flora state of one entity inside `chunk` (pure data). */
function floraState(chunk: ChunkCell, n: number): GameIRValue {
  const [cx, cy] = chunk.index;
  const baseX = chunk.bounds.min[0];
  const baseY = chunk.bounds.min[1];
  return {
    kind: "record",
    fields: {
      position: positionValue([baseX + 4 + n * 3 + ((cx + cy + n) % 2), baseY + 5 + n * 2 + ((cy + n) % 2), 2]),
      charge: { kind: "int", value: 0n },
      title: { kind: "string", value: `flora-${String(n)}` },
    },
  };
}

/** The viewpoint's initial state (spawn; the core chunk is its home). */
export function viewpointState(): GameIRValue {
  return {
    kind: "record",
    fields: {
      position: positionValue(SPAWN),
      charge: { kind: "int", value: 0n },
      title: { kind: "string", value: "viewpoint" },
    },
  };
}

/** The scene id of the core zone (the entry scene). */
export function entryScene(): SceneId {
  const core = layout.chunks.find((chunk) => chunk.id === CORE_CHUNK_ID);
  if (core === undefined) throw new Error("lattice: core chunk missing from layout");
  return core.scene;
}

/**
 * The lattice document. Node order is authored (and preserved by every
 * digest derived from it).
 */
export function latticeDocument(): GameIRDocument {
  const nodes: GameIRNode[] = [
    // -- world topology (§World: partitioning + the streaming contract) ----
    {
      id: node("world-lattice-node")!,
      kind: "world",
      world: LATTICE_WORLD,
      scenes: layout.zones.map((zone) => zone.scene),
      partitioning: CHUNK_PARTITIONING,
      streaming: WORLD_STREAMING,
    },
    // -- zone scenes (16) + entities (193) ----------------------------------
    ...layout.zones.map(
      (zone): GameIRNode => ({
        id: node(`scene-${zone.id}-node`)!,
        kind: "scene",
        world: LATTICE_WORLD,
        scene: zone.scene,
        entities: entityIdsOfZone(zone.id),
      }),
    ),
    ...layout.chunks.flatMap((chunk): GameIRNode[] =>
      floraEntityIds(chunk.id).map((entity, index): GameIRNode => ({
        id: node(`entity-${entity}-node`)!,
        kind: "entity",
        scene: chunk.scene,
        entity,
        state: floraState(chunk, index + 1),
        behaviors: [node("rule-ecology-drift")!],
      })),
    ),
    {
      id: node("entity-viewpoint-node")!,
      kind: "entity",
      scene: entryScene(),
      entity: VIEWPOINT_ENTITY,
      state: viewpointState(),
      behaviors: [node("rule-view-motion")!],
    },
    // -- mechanics -----------------------------------------------------------
    {
      id: node("rule-view-motion")!,
      kind: "rule",
      on: [EVENT_TYPE_IDS.viewMoved],
      handles: [INTENT_TYPE_IDS.viewMove],
      emits: [EVENT_TYPE_IDS.viewMoved],
    },
    {
      id: node("rule-chunk-streaming")!,
      kind: "rule",
      on: [EVENT_TYPE_IDS.viewMoved],
      handles: [],
      emits: [EVENT_TYPE_IDS.chunkLoaded, EVENT_TYPE_IDS.chunkUnloaded],
    },
    {
      id: node("rule-ecology-drift")!,
      kind: "rule",
      on: [EVENT_TYPE_IDS.chunkLoaded],
      handles: [],
      emits: [EVENT_TYPE_IDS.entityDrifted],
    },
    // -- event declarations ----------------------------------------------------
    { id: node("event-view-moved")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.viewMoved, payload: PAYLOAD_SHAPES["lattice.view.moved"]! },
    { id: node("event-chunk-loaded")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.chunkLoaded, payload: PAYLOAD_SHAPES["lattice.chunk.loaded"]! },
    { id: node("event-chunk-unloaded")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.chunkUnloaded, payload: PAYLOAD_SHAPES["lattice.chunk.unloaded"]! },
    { id: node("event-entity-drifted")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.entityDrifted, payload: PAYLOAD_SHAPES["lattice.entity.drifted"]! },
    // -- platform declarations (lock 18: the world DECLARES, never owns) -------
    {
      id: node("capability-replay")!,
      kind: "capability-declaration",
      requirement: {
        capability: "replay",
        required: true,
        policy: { capture: "intent-log", determinismRequired: true, consumers: ["player", "qa", "integrity", "simulation"] },
      },
    },
    // -- avatar binding (the viewpoint scout role, R5 host restrictions) ------
    {
      id: node("avatar-binding-viewpoint")!,
      kind: "avatar-binding",
      role: "viewpoint-scout",
      restrictions: { denied: ["manipulation", "speech"], approvalRequired: ["gaze"], sandboxed: true },
    },
  ];
  return {
    irVersion: "1",
    identity: {
      id: LATTICE_ID,
      displayName: "Lattice",
      kind: "demo",
      repository: { ...LATTICE_REPO },
      revision: { kind: "commit", commit: LATTICE_COMMIT },
      lineage: { head: LATTICE_COMMIT, ancestors: [] },
    },
    lifecycle: "active",
    entry: { world: LATTICE_WORLD, scene: entryScene() },
    nodes,
  };
}

/** The entity ids of one zone's scene (deterministic order). */
function entityIdsOfZone(zoneId: string): readonly EntityId[] {
  const zone = layout.zones.find((candidate) => candidate.id === zoneId);
  if (zone === undefined) throw new Error(`lattice: unknown zone ${zoneId}`);
  const entities = layout.chunks
    .filter((chunk) => chunk.zoneId === zoneId)
    .flatMap((chunk) => [...floraEntityIds(chunk.id)]);
  if (zone.chunkIds.includes(CORE_CHUNK_ID)) {
    entities.push(VIEWPOINT_ENTITY);
  }
  return entities;
}
