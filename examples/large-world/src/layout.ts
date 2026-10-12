/**
 * LATTICE — the spatial layout (PL-039; §World, R15).
 *
 * The canonical spatial hierarchy is World → Region → Zone → Chunk
 * (spec/architecture.md "World"; game-contracts spatial.ts owns the
 * reference types). This module is the PURE GRID MATH of the lattice
 * world: the world is a uniform grid of 8×8 chunks (128×128 world units,
 * 16-unit cells) grouped 2×2 into 16 zones, grouped 2×2 again into 4
 * regions. Chunk cell math mirrors `@playliquid/simulation`'s
 * `resolveGridCell` semantics (half-open bounds) so the partition plans
 * the simulation derives are the SAME cells the streaming scheduler
 * streams.
 *
 * The partitioning descriptor declared here is the ONE the GameIR
 * document's world node carries (single declaration site).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { asChunkId, asRegionId, asSceneId, asZoneId } from "../../../packages/game-contracts/src/index.ts";
import type {
  Bounds3,
  ChunkRef,
  RegionRef,
  SceneId,
  SpatialPartitionDescriptor,
  WorldId,
  ZoneRef,
} from "../../../packages/game-contracts/src/index.ts";
import { WORLD_ID } from "./ids.ts";

/** World units per chunk axis (and per partition cell). */
export const CHUNK_SPAN = 16;
/** Chunks per axis: 8×8 = 64 chunks. */
export const CHUNKS_PER_AXIS = 8;
/** Zones per axis: 4×4 = 16 zones of 2×2 chunks. */
export const ZONES_PER_AXIS = 4;
/** Regions per axis: 2×2 = 4 regions of 2×2 zones. */
export const REGIONS_PER_AXIS = 2;
/** Total chunk count of the lattice (the streaming domain). */
export const CHUNK_COUNT = CHUNKS_PER_AXIS * CHUNKS_PER_AXIS;

/** The whole-world bounds (x/y in [0,128), z in [0,16) — one z layer). */
export const WORLD_BOUNDS: Bounds3 = { min: [0, 0, 0], max: [128, 128, 16] };

/** The world's spatial partition descriptor (the document declares THIS). */
export const CHUNK_PARTITIONING: SpatialPartitionDescriptor = {
  scheme: "uniform-grid",
  cellSize: [CHUNK_SPAN, CHUNK_SPAN, CHUNK_SPAN],
  bounds: WORLD_BOUNDS,
};

/** The viewpoint spawn (inside the core chunk `chunk-2-2`). */
export const SPAWN: readonly [number, number, number] = [40.5, 40.5, 2];

/** Deterministic chunk id of grid coordinates (`chunk-<cx>-<cy>`). */
export function chunkIdOf(cx: number, cy: number): string {
  return `chunk-${String(cx)}-${String(cy)}`;
}

/** Deterministic zone id of grid coordinates (`zone-<zx>-<zy>`). */
export function zoneIdOf(zx: number, zy: number): string {
  return `zone-${String(zx)}-${String(zy)}`;
}

/** Deterministic region id of grid coordinates (`region-<rx>-<ry>`). */
export function regionIdOf(rx: number, ry: number): string {
  return `region-${String(rx)}-${String(ry)}`;
}

/** The scene id of a zone (GameIR scenes are the zone containers). */
export function sceneIdOfZone(zx: number, zy: number): SceneId {
  return asSceneId(`scene-zone-${String(zx)}-${String(zy)}`)!;
}

/** The zone grid coordinates containing chunk (`cx`, `cy`). */
export function zoneIndexOfChunk(cx: number, cy: number): readonly [number, number] {
  return [Math.floor(cx / (CHUNKS_PER_AXIS / ZONES_PER_AXIS)), Math.floor(cy / (CHUNKS_PER_AXIS / ZONES_PER_AXIS))];
}

/** The region grid coordinates containing zone (`zx`, `zy`). */
export function regionIndexOfZone(zx: number, zy: number): readonly [number, number] {
  return [Math.floor(zx / (ZONES_PER_AXIS / REGIONS_PER_AXIS)), Math.floor(zy / (ZONES_PER_AXIS / REGIONS_PER_AXIS))];
}

/** The chunk-ref of grid coordinates (typed spatial vocabulary, R15). */
export function chunkRefOf(cx: number, cy: number): ChunkRef {
  const [zx, zy] = zoneIndexOfChunk(cx, cy);
  const [rx, ry] = regionIndexOfZone(zx, zy);
  return {
    world: WORLD_ID,
    region: asRegionId(regionIdOf(rx, ry))!,
    zone: asZoneId(zoneIdOf(zx, zy))!,
    chunk: asChunkId(chunkIdOf(cx, cy))!,
  };
}

/** The zone-ref of grid coordinates. */
export function zoneRefOf(zx: number, zy: number): ZoneRef {
  const [rx, ry] = regionIndexOfZone(zx, zy);
  return { world: WORLD_ID, region: asRegionId(regionIdOf(rx, ry))!, zone: asZoneId(zoneIdOf(zx, zy))! };
}

/** The region-ref of grid coordinates. */
export function regionRefOf(rx: number, ry: number): RegionRef {
  return { world: WORLD_ID, region: asRegionId(regionIdOf(rx, ry))! };
}

/** The half-open bounds of chunk (`cx`, `cy`). */
export function chunkBoundsOf(cx: number, cy: number): Bounds3 {
  return {
    min: [cx * CHUNK_SPAN, cy * CHUNK_SPAN, WORLD_BOUNDS.min[2]],
    max: [(cx + 1) * CHUNK_SPAN, (cy + 1) * CHUNK_SPAN, WORLD_BOUNDS.max[2]],
  };
}

/** The center of chunk (`cx`, `cy`). */
export function chunkCenterOf(cx: number, cy: number): readonly [number, number, number] {
  return [(cx + 0.5) * CHUNK_SPAN, (cy + 0.5) * CHUNK_SPAN, (WORLD_BOUNDS.min[2] + WORLD_BOUNDS.max[2]) / 2];
}

/** Typed out-of-bounds result of {@link chunkIndexOfPosition}. */
export type ChunkIndexLookup =
  | { readonly ok: true; readonly index: readonly [number, number] }
  | { readonly ok: false };

/**
 * Resolves the chunk grid cell containing a world-plane position. The
 * world bounds are HALF-OPEN: a position exactly at max belongs to no
 * chunk (mirrors simulation planning; out-of-bounds is typed, never
 * clamped).
 */
export function chunkIndexOfPosition(x: number, y: number): ChunkIndexLookup {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };
  if (x < WORLD_BOUNDS.min[0] || x >= WORLD_BOUNDS.max[0]) return { ok: false };
  if (y < WORLD_BOUNDS.min[1] || y >= WORLD_BOUNDS.max[1]) return { ok: false };
  return { ok: true, index: [Math.floor(x / CHUNK_SPAN), Math.floor(y / CHUNK_SPAN)] };
}

/** One derived chunk cell of the layout. */
export interface ChunkCell {
  readonly id: string;
  readonly index: readonly [number, number];
  readonly ref: ChunkRef;
  readonly bounds: Bounds3;
  readonly center: readonly [number, number, number];
  readonly zoneId: string;
  readonly regionId: string;
  readonly scene: SceneId;
}

/** One derived zone cell of the layout. */
export interface ZoneCell {
  readonly id: string;
  readonly index: readonly [number, number];
  readonly ref: ZoneRef;
  readonly chunkIds: readonly string[];
  readonly regionId: string;
  readonly scene: SceneId;
}

/** One derived region cell of the layout. */
export interface RegionCell {
  readonly id: string;
  readonly index: readonly [number, number];
  readonly ref: RegionRef;
  readonly zoneIds: readonly string[];
}

/** The derived layout of the whole lattice (deterministic, pure data). */
export interface LatticeLayout {
  readonly world: WorldId;
  readonly chunks: readonly ChunkCell[];
  readonly zones: readonly ZoneCell[];
  readonly regions: readonly RegionCell[];
}

/**
 * Derives the full World → Region → Zone → Chunk layout. Chunks are
 * ordered x-major (cx outer, cy inner); every list is deterministic.
 */
export function deriveLayout(): LatticeLayout {
  const chunks: ChunkCell[] = [];
  for (let cx = 0; cx < CHUNKS_PER_AXIS; cx += 1) {
    for (let cy = 0; cy < CHUNKS_PER_AXIS; cy += 1) {
      const [zx, zy] = zoneIndexOfChunk(cx, cy);
      const [rx, ry] = regionIndexOfZone(zx, zy);
      chunks.push({
        id: chunkIdOf(cx, cy),
        index: [cx, cy],
        ref: chunkRefOf(cx, cy),
        bounds: chunkBoundsOf(cx, cy),
        center: chunkCenterOf(cx, cy),
        zoneId: zoneIdOf(zx, zy),
        regionId: regionIdOf(rx, ry),
        scene: sceneIdOfZone(zx, zy),
      });
    }
  }
  const zones: ZoneCell[] = [];
  for (let zx = 0; zx < ZONES_PER_AXIS; zx += 1) {
    for (let zy = 0; zy < ZONES_PER_AXIS; zy += 1) {
      const [rx, ry] = regionIndexOfZone(zx, zy);
      zones.push({
        id: zoneIdOf(zx, zy),
        index: [zx, zy],
        ref: zoneRefOf(zx, zy),
        regionId: regionIdOf(rx, ry),
        chunkIds: chunks.filter((chunk) => chunk.zoneId === zoneIdOf(zx, zy)).map((chunk) => chunk.id),
        scene: sceneIdOfZone(zx, zy),
      });
    }
  }
  const regions: RegionCell[] = [];
  for (let rx = 0; rx < REGIONS_PER_AXIS; rx += 1) {
    for (let ry = 0; ry < REGIONS_PER_AXIS; ry += 1) {
      regions.push({
        id: regionIdOf(rx, ry),
        index: [rx, ry],
        ref: regionRefOf(rx, ry),
        zoneIds: zones.filter((zone) => zone.regionId === regionIdOf(rx, ry)).map((zone) => zone.id),
      });
    }
  }
  return { world: WORLD_ID, chunks, zones, regions };
}
