/**
 * qa/performance — ENGINE PLAYCANVAS suite tests (PL-042).
 *
 * Runs the real measurement (measureEngine) and asserts every metric
 * against its budget from budgets.ts, plus the workload determinism
 * invariants (the same plan reproduces the evidence-ledger digest).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { measureEngine } from "./measure-engine.ts";
import { PERFORMANCE_BUDGETS } from "./budgets.ts";

test("engine playcanvas suite: every measured metric is within its enforced budget", async () => {
  const report = await measureEngine();
  for (const metric of report.metrics) {
    assert.ok(
      metric.measuredMs < metric.budgetMs,
      `${metric.metric} measured ${metric.measuredMs.toFixed(1)} ms against budget ${metric.budgetMs} ms (${metric.scale})`,
    );
    console.log(`[perf] BUDGET OK | ${metric.metric} | ${metric.measuredMs.toFixed(1)} ms < ${metric.budgetMs} ms`);
  }
  assert.equal(report.metrics.length, 2);
  assert.ok(report.determinism.repeated, "the determinism repeat must have run");
});

test("engine playcanvas suite: budgets come from the single source of truth", async () => {
  const report = await measureEngine();
  const byMetric = new Map(report.metrics.map((metric) => [metric.metric, metric]));
  assert.equal(byMetric.get("engine.bindingConstruction")?.budgetMs, PERFORMANCE_BUDGETS.engine.bindingConstructionMs);
  assert.equal(byMetric.get("engine.planApplication")?.budgetMs, PERFORMANCE_BUDGETS.engine.planApplicationMs);
});

test("engine playcanvas suite: the workload shape digest is stable", async () => {
  const first = await measureEngine();
  const second = await measureEngine();
  assert.equal(first.shapeDigest, second.shapeDigest, "the same fixed-shape workload must produce the identical shape digest");
  assert.equal(first.determinism.digest, second.determinism.digest, "the same plan must reproduce the evidence-ledger digest");
  console.log(`[perf] engine shape digest: ${first.shapeDigest}`);
});
