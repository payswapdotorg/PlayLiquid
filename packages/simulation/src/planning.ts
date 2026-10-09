/**
 * PARTITION-AWARE STEP PLANNING (scalability-by-construction, R15).
 *
 * "Use a federated package graph, CAS artifacts, incremental builds,
 * spatial world partitions and scalable headless simulation"
 * (spec/architecture.md "Scalability").
 *
 * This module is a PURE QUERY/PLANNING LAYER over the GameIR spatial types
 * (game-contracts spatial.ts): it projects entity placements onto the
 * world's partitioning descriptor and plans step batches with an explicit
 * work budget. No actual threading, no worker pools, no IO — the plan is
 * data that a driver (or a later distributed runtime Work Order) may
 * execute however it likes; executing the whole plan sequentially here is
 * always correct because the kernel is deterministic and order-stable.
 *
 * Supported schemes: `uniform-grid` is fully computed (cell math over
 * Bounds3/cellSize). `quadtree`, `octree` and `explicit` currently plan as
 * a single whole-world cell with a typed reason — an explicit, honest
 * limitation recorded in the plan itself, never a silent fallback.
 *
 * Pure module.
 */

import type { Bounds3, SpatialPartitionDescriptor, Vec3 } from "@playliquid/game-contracts";
import type { WorldState } from "./world.ts";
import { entityKey, entityPosition } from "./world.ts";
import type { EntityRef } from "@playliquid/game-contracts";

/** One entity placed in space for planning purposes. */
export interface EntityPlacement {
  /** Canonical entity key (world/scene/entity path). */
  readonly entityKey: string;
  readonly position: Vec3;
}

/** A resolved partition cell with the entities that landed in it. */
export interface PartitionCellPlan {
  /** Deterministic cell key: `cell:<x>:<y>:<z>`. */
  readonly cellKey: string;
  readonly index: readonly [number, number, number];
  readonly bounds: Bounds3;
  readonly entityKeys: readonly string[];
}

/** Result of partition planning. */
export type PartitionPlanResult =
  | {
      readonly kind: "uniform-grid";
      readonly cells: readonly PartitionCellPlan[];
      readonly outOfBounds: readonly { readonly entityKey: string; readonly position: Vec3 }[];
    }
  | {
      readonly kind: "single-cell";
      readonly reason: "unsupported-scheme" | "no-partitioning";
      readonly entityKeys: readonly string[];
    };

interface GridSpec {
  readonly cellSize: Vec3;
  readonly bounds: Bounds3;
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/**
 * Resolves the grid cell index containing `position` for a uniform-grid
 * spec. The world bounds are treated as HALF-OPEN ([min, max)): a position
 * exactly at max belongs to no cell. Positions outside the world bounds
 * are typed out-of-bounds — they are never silently clamped into an edge
 * cell.
 */
export function resolveGridCell(
  spec: GridSpec,
  position: Vec3,
): { readonly ok: true; readonly index: readonly [number, number, number]; readonly bounds: Bounds3 } | { readonly ok: false } {
  if (!isFiniteVec3(position) || !isFiniteVec3(spec.cellSize) || spec.cellSize[0] <= 0 || spec.cellSize[1] <= 0 || spec.cellSize[2] <= 0) {
    return { ok: false };
  }
  const inside =
    position[0] >= spec.bounds.min[0] &&
    position[0] < spec.bounds.max[0] &&
    position[1] >= spec.bounds.min[1] &&
    position[1] < spec.bounds.max[1] &&
    position[2] >= spec.bounds.min[2] &&
    position[2] < spec.bounds.max[2];
  if (!inside) {
    return { ok: false };
  }
  const x = Math.floor((position[0] - spec.bounds.min[0]) / spec.cellSize[0]);
  const y = Math.floor((position[1] - spec.bounds.min[1]) / spec.cellSize[1]);
  const z = Math.floor((position[2] - spec.bounds.min[2]) / spec.cellSize[2]);
  return {
    ok: true,
    index: [x, y, z],
    bounds: {
      min: [
        spec.bounds.min[0] + x * spec.cellSize[0],
        spec.bounds.min[1] + y * spec.cellSize[1],
        spec.bounds.min[2] + z * spec.cellSize[2],
      ],
      max: [
        spec.bounds.min[0] + (x + 1) * spec.cellSize[0],
        spec.bounds.min[1] + (y + 1) * spec.cellSize[1],
        spec.bounds.min[2] + (z + 1) * spec.cellSize[2],
      ],
    },
  };
}

/**
 * Plans world partitions for the given placements under the descriptor.
 * Cells are returned in deterministic (x, y, z) index order; entity lists
 * per cell are in sorted entity-key order.
 */
export function planPartitions(
  descriptor: SpatialPartitionDescriptor | undefined,
  placements: readonly EntityPlacement[],
): PartitionPlanResult {
  if (descriptor === undefined) {
    return { kind: "single-cell", reason: "no-partitioning", entityKeys: placements.map((p) => p.entityKey).sort() };
  }
  if (descriptor.scheme !== "uniform-grid") {
    return { kind: "single-cell", reason: "unsupported-scheme", entityKeys: placements.map((p) => p.entityKey).sort() };
  }
  const spec: GridSpec = { cellSize: descriptor.cellSize, bounds: descriptor.bounds };
  const byCell = new Map<string, PartitionCellPlan>();
  const outOfBounds: { readonly entityKey: string; readonly position: Vec3 }[] = [];
  for (const placement of placements) {
    const cell = resolveGridCell(spec, placement.position);
    if (!cell.ok) {
      outOfBounds.push({ entityKey: placement.entityKey, position: placement.position });
      continue;
    }
    const cellKey = `cell:${cell.index[0]}:${cell.index[1]}:${cell.index[2]}`;
    const existing = byCell.get(cellKey);
    if (existing === undefined) {
      byCell.set(cellKey, {
        cellKey,
        index: cell.index,
        bounds: cell.bounds,
        entityKeys: [placement.entityKey],
      });
    } else {
      byCell.set(cellKey, { ...existing, entityKeys: [...existing.entityKeys, placement.entityKey] });
    }
  }
  const cells = [...byCell.values()]
    .map((cell) => ({ ...cell, entityKeys: [...cell.entityKeys].sort() }))
    .sort((a, b) => {
      const [ax, ay, az] = a.index;
      const [bx, by, bz] = b.index;
      if (ax !== bx) return ax - bx;
      if (ay !== by) return ay - by;
      return az - bz;
    });
  outOfBounds.sort((a, b) => a.entityKey.localeCompare(b.entityKey));
  return { kind: "uniform-grid", cells, outOfBounds };
}

/** Extracts placements from a world state's `position` fields (3 floats). */
export function extractEntityPlacements(
  state: WorldState,
  refs: readonly EntityRef[],
): readonly EntityPlacement[] {
  const placements: EntityPlacement[] = [];
  for (const ref of refs) {
    const position = entityPosition(state, ref);
    if (position !== undefined) {
      placements.push({ entityKey: entityKey(ref), position });
    }
  }
  return placements;
}

/**
 * One planned batch of ticks: consecutive ticks, the partition cells
 * involved, and the estimated work units.
 */
export interface StepBatchPlanItem {
  readonly fromTick: number;
  readonly toTick: number;
  readonly cellKeys: readonly string[];
  readonly estimatedWorkUnits: number;
}

/** A full step-batch plan over a tick span. */
export interface StepBatchPlan {
  readonly items: readonly StepBatchPlanItem[];
  readonly totalTicks: number;
}

/** Work estimation: one unit per (tick, cell) pair plus one per entity. */
export function estimateTickWork(cells: readonly PartitionCellPlan[]): number {
  return cells.reduce((sum, cell) => sum + 1 + cell.entityKeys.length, 0);
}

/**
 * Plans tick batches under an explicit work budget per batch. Batches are
 * consecutive tick ranges; a single tick exceeding the budget forms its own
 * batch (never split mid-tick — ticks are the atomic determinism unit).
 * Pure and deterministic.
 */
export function planStepBatches(
  fromTick: number,
  ticks: number,
  cells: readonly PartitionCellPlan[],
  options: { readonly maxWorkUnitsPerBatch: number },
): StepBatchPlan {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError("ticks must be a non-negative integer");
  }
  if (!Number.isInteger(fromTick) || fromTick < 0) {
    throw new RangeError("fromTick must be a non-negative integer");
  }
  if (options.maxWorkUnitsPerBatch < 1) {
    throw new RangeError("maxWorkUnitsPerBatch must be >= 1");
  }
  const perTick = estimateTickWork(cells);
  const cellKeys = cells.map((cell) => cell.cellKey);
  const items: StepBatchPlanItem[] = [];
  let tick = fromTick + 1;
  const endTick = fromTick + ticks;
  while (tick <= endTick) {
    let batchTicks = 0;
    let work = 0;
    while (tick + batchTicks <= endTick) {
      const nextWork = work + perTick;
      if (batchTicks > 0 && nextWork > options.maxWorkUnitsPerBatch) {
        break;
      }
      work = nextWork;
      batchTicks += 1;
    }
    items.push({
      fromTick: tick,
      toTick: tick + batchTicks - 1,
      cellKeys,
      estimatedWorkUnits: work,
    });
    tick += batchTicks;
  }
  return { items, totalTicks: ticks };
}
