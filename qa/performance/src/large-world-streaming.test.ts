/**
 * qa/performance — LARGE-WORLD suite tests (PL-042).
 *
 * Runs the real measurement (measureLargeWorld) and asserts every metric
 * against its budget from budgets.ts, plus the workload determinism
 * invariants (the same schedule derived twice agrees exactly).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { measureLargeWorld } from "./measure-large-world.ts";
import { PERFORMANCE_BUDGETS } from "./budgets.ts";

test("large-world streaming suite: every measured metric is within its enforced budget", async () => {
  const report = await measureLargeWorld();
  for (const metric of report.metrics) {
    assert.ok(
      metric.measuredMs < metric.budgetMs,
      `${metric.metric} measured ${metric.measuredMs.toFixed(1)} ms against budget ${metric.budgetMs} ms (${metric.scale})`,
    );
    console.log(`[perf] BUDGET OK | ${metric.metric} | ${metric.measuredMs.toFixed(1)} ms < ${metric.budgetMs} ms`);
  }
  assert.equal(report.metrics.length, 3);
  assert.ok(report.determinism.repeated, "the determinism repeat must have run");
});

test("large-world streaming suite: budgets come from the single source of truth", async () => {
  const report = await measureLargeWorld();
  const byMetric = new Map(report.metrics.map((metric) => [metric.metric, metric]));
  assert.equal(byMetric.get("largeWorld.composition")?.budgetMs, PERFORMANCE_BUDGETS.largeWorld.compositionMs);
  assert.equal(byMetric.get("largeWorld.streamingSchedule")?.budgetMs, PERFORMANCE_BUDGETS.largeWorld.streamingScheduleMs);
  assert.equal(byMetric.get("largeWorld.wantedSetScan")?.budgetMs, PERFORMANCE_BUDGETS.largeWorld.wantedSetScanMs);
});

test("large-world streaming suite: the workload shape digest is stable", async () => {
  const first = await measureLargeWorld();
  const second = await measureLargeWorld();
  assert.equal(first.shapeDigest, second.shapeDigest, "the same fixed-shape workload must produce the identical shape digest");
  assert.equal(first.determinism.digest, second.determinism.digest);
  console.log(`[perf] large-world shape digest: ${first.shapeDigest}`);
});
