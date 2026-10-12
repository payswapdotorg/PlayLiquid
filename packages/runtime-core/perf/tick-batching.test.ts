/**
 * PL-042 perf suite — TICK BATCHING (packages/runtime-core).
 *
 * WHAT IS MEASURED (E11 honesty): kernel `step(n)` fixed-tick batch
 * execution over the reference counter driver (each tick: one driver
 * tickWorld + one journal event under the per-tick limit). Per-batch
 * wall-clock latency samples are collected at batch sizes 1, 8 and 64
 * (160 batches each; 11,680 ticks total) and reported as mean + p95 plus
 * ticks/sec at each batch size. Determinism: the same small batch
 * program run twice must yield the identical observed-state digest.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTER_WORLD_KIND, DEFAULT_KERNEL_LIMITS } from "../src/index.ts";
import { logMetric, makePerfSession, meanOf, nowMs, percentileOf, shapeDigestOf, stateProjectionOf } from "./perf-kit.ts";
import type { InteractiveRuntimeKernel } from "../src/index.ts";
import type { CounterWorld } from "../src/index.ts";

/** Budgets (ms): generous upper bounds ~10x observed on the 4GB sandbox. */
const BUDGETS = {
  allBatchSizesMs: 600,
} as const;

const BATCHES_PER_SIZE = 160;

/** Drives `batches` step(n) calls, collecting per-batch latency samples (ms). */
function driveBatched(kernel: InteractiveRuntimeKernel<CounterWorld>, ticksPerBatch: number, batches: number): readonly number[] {
  const samples: number[] = [];
  for (let i = 0; i < batches; i += 1) {
    const started = nowMs();
    const result = kernel.step(ticksPerBatch);
    samples.push(nowMs() - started);
    if (result.status !== "stepped") throw new Error(`batch ${i} of ${ticksPerBatch} was not stepped: ${String(result.status)}`);
  }
  return samples;
}

/** The workload shape digest of a tick program (descriptor + observed state). */
function programDigestOf(kernel: InteractiveRuntimeKernel<CounterWorld>, program: readonly { readonly ticksPerBatch: number; readonly batches: number }[]): string {
  return shapeDigestOf({
    suite: "runtime-core/tick-batching",
    driver: COUNTER_WORLD_KIND,
    limits: DEFAULT_KERNEL_LIMITS,
    program,
    observed: stateProjectionOf(kernel),
  });
}

test("tick batching: per-batch latency (mean + p95) at batch sizes 1 / 8 / 64", () => {
  const kernel = makePerfSession("tick-batching-session", { seed: "perf-tick-seed" });
  kernel.load();
  const program = [
    { ticksPerBatch: 1, batches: BATCHES_PER_SIZE },
    { ticksPerBatch: 8, batches: BATCHES_PER_SIZE },
    { ticksPerBatch: 64, batches: BATCHES_PER_SIZE },
  ];
  const suiteStarted = nowMs();
  let totalTicks = 0;
  for (const step of program) {
    const samples = driveBatched(kernel, step.ticksPerBatch, step.batches);
    const elapsed = samples.reduce((total, value) => total + value, 0);
    const ticks = step.ticksPerBatch * step.batches;
    totalTicks += ticks;
    console.log(
      `[perf] tick batch | size ${String(step.ticksPerBatch).padStart(2)} x ${step.batches}` +
        ` | ${ticks.toLocaleString("en-US")} ticks | mean ${meanOf(samples).toFixed(3)} ms/batch | p95 ${percentileOf(samples, 95).toFixed(3)} ms/batch` +
        ` | ticks/s ${((ticks * 1000) / elapsed).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    );
  }
  const suiteElapsed = nowMs() - suiteStarted;
  assert.ok(suiteElapsed < BUDGETS.allBatchSizesMs, `batched stepping took ${suiteElapsed.toFixed(1)}ms (budget ${BUDGETS.allBatchSizesMs}ms)`);
  logMetric("batched tick execution", "3 sizes x 160 batches (11,680 ticks, 1 session)", suiteElapsed, totalTicks);
  console.log(`[perf] tick-batching shape digest: ${programDigestOf(kernel, program)}`);
});

test("tick batching: the workload is deterministic (small repeat)", () => {
  const program = [
    { ticksPerBatch: 4, batches: 10 },
    { ticksPerBatch: 16, batches: 5 },
  ];
  const run = (tag: string): InteractiveRuntimeKernel<CounterWorld> => {
    const kernel = makePerfSession(`${tag}-session`, { seed: "perf-tick-seed" });
    kernel.load();
    for (const step of program) {
      driveBatched(kernel, step.ticksPerBatch, step.batches);
    }
    return kernel;
  };
  const digestA = programDigestOf(run("det-a"), program);
  const digestB = programDigestOf(run("det-b"), program);
  assert.equal(digestA, digestB, "identical fixed-seed tick programs must produce identical observed-state digests");
  console.log(`[perf] tick-batching determinism digest: ${digestA}`);
});
