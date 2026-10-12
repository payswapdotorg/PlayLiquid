/**
 * LATTICE — the derived world model (PL-039; §World, R15).
 *
 * The STATIC side of the large world, derived once from the GameIR
 * document: the World → Region → Zone → Chunk hierarchy (typed spatial
 * refs from game-contracts), the per-chunk streaming contracts, each
 * chunk's entity placements (initial states read from the document's
 * entity nodes) and the package coordinates the chunk content publishes
 * under. STATIC definition and RUNTIME state are distinct (§World):
 * nothing in this module is mutable — positions, charge, checkpoints and
 * resident sets live in the simulation world state only.
 *
 * The runtime side (resident sets, dormant checkpoints, entity charge)
 * is owned by streaming.ts + the simulation binding.
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { hashGameIRValue } from "../../../packages/game-ir/src/index.ts";
import type { GameIRDocument, GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { canonicalRefPath } from "../../../packages/game-contracts/src/index.ts";
import type { Bounds3, EntityRef, SceneId, StreamingPolicy } from "../../../packages/game-contracts/src/index.ts";
import { CORE_CHUNK_ID, VIEWPOINT_ENTITY, floraEntityIds } from "./document.ts";
import { CHUNK_COUNT, CHUNK_PARTITIONING, SPAWN, chunkIdOf, deriveLayout } from "./layout.ts";
import type { ChunkCell, LatticeLayout } from "./layout.ts";
import { WORLD_ID } from "./ids.ts";

/** The package scope every lattice package publishes under. */
export const PACKAGE_SCOPE = "@lattice" as const;

/** The world package id (the composition root of the package graph). */
export const WORLD_PACKAGE_ID = `${PACKAGE_SCOPE}/world` as const;
/** The shared mechanics package id (rule nodes). */
export const RULES_PACKAGE_ID = `${PACKAGE_SCOPE}/rules` as const;
/** The viewpoint avatar package id (R5). */
export const VIEWPOINT_PACKAGE_ID = `${PACKAGE_SCOPE}/viewpoint-avatar` as const;

/** The chunk package id of a chunk id. */
export function chunkPackageId(chunkId: string): string {
  return `${PACKAGE_SCOPE}/${chunkId}`;
}

/** The zone package id of a zone id. */
export function zonePackageId(zoneId: string): string {
  return `${PACKAGE_SCOPE}/${zoneId}`;
}

/** The region package id of a region id. */
export function regionPackageId(regionId: string): string {
  return `${PACKAGE_SCOPE}/${regionId}`;
}

/**
 * The per-chunk streaming contract (R15: "when the contract permits"),
 * authored as a deterministic policy table:
 *
 * - the CORE chunk (contains the spawn) is NOT streamable — it is always
 *   resident and never streams out;
 * - chunks in the core zone are NOT independently built (they cook as one
 *   zone unit); every other chunk builds independently;
 * - FRONTIER chunks (the outermost ring of the world) are NOT cacheable —
 *   streaming out discards their state and a later load re-resolves the
 *   static content through the CAS.
 */
export function chunkPolicyOf(cx: number, cy: number): StreamingPolicy {
  const isCore = chunkIdOf(cx, cy) === CORE_CHUNK_ID;
  const coreZone = Math.floor(cx / 2) === 1 && Math.floor(cy / 2) === 1;
  const frontier = cx === 0 || cy === 0 || cx === 7 || cy === 7;
  return { streamable: !isCore, cacheable: !frontier, independentlyBuilt: !coreZone };
}

/** One chunk of the static world model. */
export interface ChunkDescriptor {
  readonly id: string;
  readonly cell: ChunkCell;
  readonly ref: ChunkCell["ref"];
  readonly bounds: Bounds3;
  readonly zoneId: string;
  readonly regionId: string;
  readonly scene: SceneId;
  readonly packageId: string;
  readonly policy: StreamingPolicy;
  readonly entities: readonly { readonly ref: EntityRef; readonly state: GameIRValue }[];
}

/** The viewpoint placement (static; the agent lives in the core chunk). */
export interface ViewpointPlacement {
  readonly ref: EntityRef;
  readonly state: GameIRValue;
  readonly spawn: readonly [number, number, number];
}

/** The derived static model of the whole lattice. */
export interface LatticeWorldModel {
  readonly world: typeof WORLD_ID;
  readonly layout: LatticeLayout;
  readonly partitioning: typeof CHUNK_PARTITIONING;
  readonly chunks: readonly ChunkDescriptor[];
  readonly chunkCount: number;
  readonly coreChunkId: string;
  readonly viewpoint: ViewpointPlacement;
  readonly byChunkId: ReadonlyMap<string, ChunkDescriptor>;
}

function entityStateOf(document: GameIRDocument, entity: string, scene: SceneId): GameIRValue {
  const node = document.nodes.find(
    (candidate) => candidate.kind === "entity" && candidate.entity === entity && candidate.scene === scene,
  );
  if (node?.kind !== "entity") {
    throw new Error(`lattice: entity ${entity} missing from scene ${String(scene)} in the document`);
  }
  return node.state;
}

/**
 * Derives the static world model from the document: the layout is
 * recomputed deterministically and cross-checked against the document's
 * partitioning descriptor; per-chunk entity placements are READ from the
 * document's entity nodes (the document is the entity authority).
 */
export function deriveWorldModel(document: GameIRDocument): LatticeWorldModel {
  const layout = deriveLayout();
  const worldNode = document.nodes.find((node) => node.kind === "world");
  if (worldNode?.kind !== "world") throw new Error("lattice: document has no world node");
  if (JSON.stringify(worldNode.partitioning) !== JSON.stringify(CHUNK_PARTITIONING)) {
    throw new Error("lattice: document partitioning does not match the lattice layout");
  }
  const core = layout.chunks.find((chunk) => chunk.id === CORE_CHUNK_ID);
  if (core === undefined) throw new Error("lattice: core chunk missing from layout");

  const chunks: ChunkDescriptor[] = layout.chunks.map((cell) => {
    const flora = floraEntityIds(cell.id).map((entity) => ({
      ref: { world: WORLD_ID, scene: cell.scene, entity },
      state: entityStateOf(document, entity, cell.scene),
    }));
    return {
      id: cell.id,
      cell,
      ref: cell.ref,
      bounds: cell.bounds,
      zoneId: cell.zoneId,
      regionId: cell.regionId,
      scene: cell.scene,
      packageId: chunkPackageId(cell.id),
      policy: chunkPolicyOf(cell.index[0]!, cell.index[1]!),
      entities: flora,
    };
  });

  return {
    world: WORLD_ID,
    layout,
    partitioning: CHUNK_PARTITIONING,
    chunks,
    chunkCount: CHUNK_COUNT,
    coreChunkId: CORE_CHUNK_ID,
    viewpoint: {
      ref: { world: WORLD_ID, scene: core.scene, entity: VIEWPOINT_ENTITY },
      state: entityStateOf(document, VIEWPOINT_ENTITY, core.scene),
      spawn: SPAWN,
    },
    byChunkId: new Map(chunks.map((chunk) => [chunk.id, chunk])),
  };
}

/**
 * The static chunk content of one chunk: a GameIR record value mapping
 * canonical entity keys to initial states. This is the value that gets
 * content-addressed into the CAS (E7) and re-resolved on fresh loads.
 */
export function chunkStaticContent(model: LatticeWorldModel, chunkId: string): GameIRValue {
  const chunk = model.byChunkId.get(chunkId);
  if (chunk === undefined) throw new Error(`lattice: unknown chunk ${chunkId}`);
  const fields: { [key: string]: GameIRValue } = {};
  for (const entity of chunk.entities) {
    fields[entityKeyOf(entity.ref)] = entity.state;
  }
  return { kind: "record", fields };
}

/** The canonical entity key (game-contracts canonical ref path). */
export function entityKeyOf(ref: EntityRef): string {
  return canonicalRefPath(ref);
}

/** Content digest (bare sha256 hex) of a chunk's static content value. */
export function chunkContentDigest(content: GameIRValue): string {
  return hashGameIRValue(content);
}

/** True when the chunk id is the always-resident core chunk. */
export function isCoreChunk(model: LatticeWorldModel, chunkId: string): boolean {
  return chunkId === model.coreChunkId;
}
