/**
 * Partition-aware planning tests (R15): uniform-grid cell resolution,
 * deterministic partition plans, typed out-of-bounds entities, honest
 * unsupported-scheme fallbacks, and budget-bounded step batches.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTickWork,
  extractEntityPlacements,
  planPartitions,
  planStepBatches,
  resolveGridCell,
} from "./planning.ts";
import { initialWorldState } from "./world.ts";
import { demoBlueprint, demoEntityRefs } from "./demo.ts";

const grid = {
  cellSize: [16, 16, 16] as const,
  bounds: { min: [0, 0, 0] as const, max: [64, 64, 64] as const },
};

test("planning: uniform-grid cells resolve deterministically", () => {
  const origin = resolveGridCell(grid, [0, 0, 0]);
  assert.equal(origin.ok, true);
  if (origin.ok) assert.deepEqual(origin.index, [0, 0, 0]);

  const mid = resolveGridCell(grid, [15.99, 16, 33.3]);
  assert.equal(mid.ok, true);
  if (mid.ok) assert.deepEqual(mid.index, [0, 1, 2]);

  const top = resolveGridCell(grid, [63.999, 63.999, 63.999]);
  assert.equal(top.ok, true);
  if (top.ok) assert.deepEqual(top.index, [3, 3, 3]);
});

test("planning: out-of-bounds positions are typed, never clamped", () => {
  const below = resolveGridCell(grid, [-0.001, 0, 0]);
  assert.equal(below.ok, false);
  const above = resolveGridCell(grid, [64, 0, 0]);
  assert.equal(above.ok, false);
  const nan = resolveGridCell(grid, [Number.NaN, 0, 0]);
  assert.equal(nan.ok, false);
});

test("planning: partition plans are deterministic and sorted", () => {
  const placements = [
    { entityKey: "world/w/scene/s/entity/e-b", position: [20, 4, 4] as const },
    { entityKey: "world/w/scene/s/entity/e-a", position: [4, 4, 4] as const },
    { entityKey: "world/w/scene/s/entity/e-c", position: [21, 5, 5] as const },
  ];
  const first = planPartitions({ scheme: "uniform-grid", cellSize: [16, 16, 16], bounds: { min: [0, 0, 0], max: [64, 64, 64] } }, placements);
  const second = planPartitions({ scheme: "uniform-grid", cellSize: [16, 16, 16], bounds: { min: [0, 0, 0], max: [64, 64, 64] } }, [
    placements[2]!,
    placements[0]!,
    placements[1]!,
  ]);
  assert.equal(first.kind, "uniform-grid");
  assert.equal(second.kind, "uniform-grid");
  if (first.kind === "uniform-grid" && second.kind === "uniform-grid") {
    // Input order never matters: same cells, same sorted entity lists.
    assert.deepEqual(first.cells, second.cells);
    assert.deepEqual(first.cells[0]?.entityKeys, ["world/w/scene/s/entity/e-a"]);
    assert.deepEqual(first.cells[1]?.entityKeys, [
      "world/w/scene/s/entity/e-b",
      "world/w/scene/s/entity/e-c",
    ]);
    // Cells in (x, y, z) order.
    assert.ok(first.cells[0]!.index[0] <= first.cells[1]!.index[0]);
  }
});

test("planning: out-of-bounds entities are reported, not dropped silently", () => {
  const placements = [
    { entityKey: "world/w/scene/s/entity/e-in", position: [4, 4, 4] as const },
    { entityKey: "world/w/scene/s/entity/e-out", position: [128, 0, 0] as const },
  ];
  const plan = planPartitions({ scheme: "uniform-grid", cellSize: [16, 16, 16], bounds: { min: [0, 0, 0], max: [64, 64, 64] } }, placements);
  assert.equal(plan.kind, "uniform-grid");
  if (plan.kind === "uniform-grid") {
    assert.equal(plan.cells.length, 1);
    assert.deepEqual(plan.outOfBounds.map((e) => e.entityKey), ["world/w/scene/s/entity/e-out"]);
  }
});

test("planning: unsupported schemes and absent descriptors plan single-cell with typed reasons", () => {
  const explicit = planPartitions({ scheme: "explicit" }, [{ entityKey: "e", position: [0, 0, 0] }]);
  assert.equal(explicit.kind, "single-cell");
  if (explicit.kind === "single-cell") assert.equal(explicit.reason, "unsupported-scheme");

  const octree = planPartitions({ scheme: "octree", bounds: { min: [0, 0, 0], max: [64, 64, 64] }, maxDepth: 4 }, [
    { entityKey: "e", position: [0, 0, 0] },
  ]);
  assert.equal(octree.kind, "single-cell");
  if (octree.kind === "single-cell") assert.equal(octree.reason, "unsupported-scheme");

  const none = planPartitions(undefined, [{ entityKey: "e", position: [0, 0, 0] }]);
  assert.equal(none.kind === "single-cell", true);
  if (none.kind === "single-cell") assert.equal(none.reason, "no-partitioning");
});

test("planning: step batches respect the work budget and never split mid-tick", () => {
  const cells = [
    { cellKey: "cell:0:0:0", index: [0, 0, 0] as const, bounds: { min: [0, 0, 0] as const, max: [16, 16, 16] as const }, entityKeys: ["a", "b", "c"] },
    { cellKey: "cell:1:0:0", index: [1, 0, 0] as const, bounds: { min: [16, 0, 0] as const, max: [32, 16, 16] as const }, entityKeys: ["d"] },
  ];
  // per-tick work = (1+3) + (1+1) = 6
  assert.equal(estimateTickWork(cells), 6);
  const plan = planStepBatches(0, 10, cells, { maxWorkUnitsPerBatch: 12 });
  // Batches of 2 ticks each (12 units), 5 batches, consecutive.
  assert.equal(plan.totalTicks, 10);
  assert.equal(plan.items.length, 5);
  assert.deepEqual(
    plan.items.map((item) => [item.fromTick, item.toTick]),
    [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]],
  );
  assert.ok(plan.items.every((item) => item.estimatedWorkUnits <= 12));
});

test("planning: a single oversized tick forms its own batch", () => {
  const cells = [
    { cellKey: "cell:0:0:0", index: [0, 0, 0] as const, bounds: { min: [0, 0, 0] as const, max: [16, 16, 16] as const }, entityKeys: Array.from({ length: 20 }, (_, i) => `e-${i}`) },
  ];
  const plan = planStepBatches(0, 2, cells, { maxWorkUnitsPerBatch: 5 });
  assert.equal(plan.items.length, 2);
  assert.ok(plan.items.every((item) => item.toTick - item.fromTick === 0));
});

test("planning: zero ticks plan zero batches; invalid budgets throw", () => {
  assert.deepEqual(planStepBatches(7, 0, [], { maxWorkUnitsPerBatch: 5 }).items, []);
  assert.throws(() => planStepBatches(0, 1, [], { maxWorkUnitsPerBatch: 0 }));
  assert.throws(() => planStepBatches(0, -1, [], { maxWorkUnitsPerBatch: 5 }));
});

test("planning: placements extract from demo world positions", () => {
  const state = initialWorldState(demoBlueprint());
  const placements = extractEntityPlacements(state, demoEntityRefs());
  assert.equal(placements.length, 3);
  const hero = placements.find((p) => p.entityKey.endsWith("entity-hero"));
  assert.deepEqual(hero?.position, [2, 2, 2]);
  const companion = placements.find((p) => p.entityKey.endsWith("entity-companion"));
  assert.deepEqual(companion?.position, [18, 2, 2]);
});
