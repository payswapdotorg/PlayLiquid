/**
 * qa/performance — REPLAY suite tests (PL-042).
 *
 * Runs the real measurement (measureReplay) and asserts every metric
 * against its budget from budgets.ts, plus the workload determinism
 * invariants (sealing the same stream twice is byte-identical).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { measureReplay } from "./measure-replay.ts";
import { PERFORMANCE_BUDGETS } from "./budgets.ts";

test("replay verification suite: every measured metric is within its enforced budget", () => {
  const report = measureReplay();
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

test("replay verification suite: budgets come from the single source of truth", () => {
  const report = measureReplay();
  const byMetric = new Map(report.metrics.map((metric) => [metric.metric, metric]));
  assert.equal(byMetric.get("replay.sealArtifacts")?.budgetMs, PERFORMANCE_BUDGETS.replay.sealArtifactsMs);
  assert.equal(byMetric.get("replay.verifyArtifacts")?.budgetMs, PERFORMANCE_BUDGETS.replay.verifyArtifactsMs);
  assert.equal(byMetric.get("replay.tamperedVerify")?.budgetMs, PERFORMANCE_BUDGETS.replay.tamperedVerifyMs);
});

test("replay verification suite: the workload shape digest is stable", () => {
  const first = measureReplay();
  const second = measureReplay();
  assert.equal(first.shapeDigest, second.shapeDigest, "the same fixed-shape workload must produce the identical shape digest");
  assert.equal(first.determinism.digest, second.determinism.digest, "sealing the same stream twice must be identical");
  console.log(`[perf] replay shape digest: ${first.shapeDigest}`);
});
