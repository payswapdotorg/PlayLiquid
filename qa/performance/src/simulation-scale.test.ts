/**
 * qa/performance — SIMULATION suite tests (PL-042).
 *
 * Runs the real measurement (measureSimulation) and asserts every metric
 * against its budget from budgets.ts (the single source of truth), plus
 * the workload determinism invariants.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { measureSimulation } from "./measure-simulation.ts";
import { PERFORMANCE_BUDGETS } from "./budgets.ts";

test("simulation scale suite: every measured metric is within its enforced budget", () => {
  const report = measureSimulation();
  for (const metric of report.metrics) {
    assert.ok(
      metric.measuredMs < metric.budgetMs,
      `${metric.metric} measured ${metric.measuredMs.toFixed(1)} ${metric.unit ?? "ms"} against budget ${metric.budgetMs} ${metric.unit ?? "ms"} (${metric.scale})`,
    );
    console.log(`[perf] BUDGET OK | ${metric.metric} | ${metric.measuredMs.toFixed(1)} ${metric.unit ?? "ms"} < ${metric.budgetMs} ${metric.unit ?? "ms"}`);
  }
  assert.equal(report.metrics.length, 3);
  assert.ok(report.determinism.repeated, "the determinism repeat must have run");
});

test("simulation scale suite: budgets come from the single source of truth", () => {
  const report = measureSimulation();
  const byMetric = new Map(report.metrics.map((metric) => [metric.metric, metric]));
  assert.equal(byMetric.get("simulation.sessionScale")?.budgetMs, PERFORMANCE_BUDGETS.simulation.sessionScaleMs);
  assert.equal(byMetric.get("simulation.deepSteps")?.budgetMs, PERFORMANCE_BUDGETS.simulation.deepStepsMs);
  assert.equal(byMetric.get("simulation.sessionHeap")?.budgetMs, PERFORMANCE_BUDGETS.simulation.sessionHeapMb);
});

test("simulation scale suite: the workload shape digest is stable", () => {
  const first = measureSimulation();
  const second = measureSimulation();
  assert.equal(first.shapeDigest, second.shapeDigest, "the same fixed-seed workload must produce the identical shape digest");
  assert.equal(first.determinism.digest, second.determinism.digest);
  console.log(`[perf] simulation shape digest: ${first.shapeDigest}`);
});
