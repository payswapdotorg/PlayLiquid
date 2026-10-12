/**
 * PL-042 perf suite — SESSION SCALE (packages/runtime-core).
 *
 * WHAT IS MEASURED (E11 honesty): creating + loading N interactive
 * sessions over the package's public fakes (each session = kernel +
 * manual clock + volatile snapshot store + grant-table capability seam +
 * reference counter driver), then driving a fixed per-session workload
 * (2 player commands + 4 ticks). Metrics: sessions/sec at N=500 and
 * N=2000, and the heapUsed delta across the N=2000 allocation
 * (informational: no forced GC — a footprint indicator, not a residency
 * bound). The workload is fixed-seed and its shape digest is asserted
 * stable across a small repeat (deterministic workload, machine-dependent
 * timings).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTER_WORLD_KIND, DEFAULT_KERNEL_LIMITS } from "../src/index.ts";
import {
  heapMb,
  logMetric,
  makePerfSession,
  nowMs,
  playerIncrementAct,
  shapeDigestOf,
  stateProjectionOf,
} from "./perf-kit.ts";
import type { InteractiveRuntimeKernel } from "../src/index.ts";
import type { CounterWorld } from "../src/index.ts";

/** Budgets (ms): generous upper bounds ~10x observed on the 4GB sandbox. */
const BUDGETS = {
  sessions500Ms: 250,
  sessions2000Ms: 900,
  heapDelta2000Mb: 256,
} as const;

const ACTS_PER_SESSION = 2;
const TICKS_PER_SESSION = 4;

function buildBatch(count: number, tag: string): readonly InteractiveRuntimeKernel<CounterWorld>[] {
  const sessions: InteractiveRuntimeKernel<CounterWorld>[] = [];
  for (let i = 0; i < count; i += 1) {
    const kernel = makePerfSession(`${tag}-s-${i}`, { seed: `perf-seed-${i % 8}` });
    const loaded = kernel.load();
    if (loaded.status !== "loaded") throw new Error(`session ${i} did not load: ${String(loaded.status)}`);
    for (let a = 0; a < ACTS_PER_SESSION; a += 1) {
      const result = kernel.act(playerIncrementAct(a + 1));
      if (result.status !== "committed") throw new Error(`act ${a} not committed: ${String(result.status)}`);
    }
    const stepped = kernel.step(TICKS_PER_SESSION);
    if (stepped.status !== "stepped") throw new Error(`step not admitted: ${String(stepped.status)}`);
    sessions.push(kernel);
  }
  return sessions;
}

/** The workload shape digest of a built batch (descriptor + observed state). */
function digestOfBatch(sessions: readonly InteractiveRuntimeKernel<CounterWorld>[], count: number): string {
  return shapeDigestOf({
    suite: "runtime-core/session-scale",
    driver: COUNTER_WORLD_KIND,
    limits: DEFAULT_KERNEL_LIMITS,
    sessions: count,
    actsPerSession: ACTS_PER_SESSION,
    ticksPerSession: TICKS_PER_SESSION,
    seedCycle: 8,
    intentKind: "world.increment",
    observed: sessions.map((kernel) => stateProjectionOf(kernel)),
  });
}

test("session scale: create + load + drive 500 sessions", () => {
  const started = nowMs();
  const sessions = buildBatch(500, "scale500");
  const elapsed = nowMs() - started;
  assert.ok(elapsed < BUDGETS.sessions500Ms, `500 sessions took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.sessions500Ms}ms)`);
  assert.equal(sessions.length, 500);
  logMetric("session create+load+drive", "500 sessions x (load + 2 acts + 4 ticks)", elapsed, 500);
  const digest = digestOfBatch(sessions, 500);
  console.log(`[perf] session-scale shape digest (500): ${digest}`);
});

test("session scale: create + load + drive 2000 sessions (heap footprint)", () => {
  const before = heapMb();
  const started = nowMs();
  const sessions = buildBatch(2000, "scale2000");
  const elapsed = nowMs() - started;
  const heapDelta = heapMb() - before;
  assert.ok(elapsed < BUDGETS.sessions2000Ms, `2000 sessions took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.sessions2000Ms}ms)`);
  assert.ok(heapDelta < BUDGETS.heapDelta2000Mb, `heap delta ${heapDelta.toFixed(1)}MB exceeded the ${BUDGETS.heapDelta2000Mb}MB footprint bound`);
  assert.equal(sessions.length, 2000);
  logMetric("session create+load+drive", "2000 sessions x (load + 2 acts + 4 ticks)", elapsed, 2000, `heapUsed delta ${heapDelta.toFixed(1)}MB (informational, no forced GC)`);
  console.log(`[perf] session-scale shape digest (2000): ${digestOfBatch(sessions.slice(0, 50), 50)}`);
});

test("session scale: the workload is deterministic (small repeat)", () => {
  const runA = buildBatch(32, "det-a");
  const runB = buildBatch(32, "det-b");
  const digestA = digestOfBatch(runA, 32);
  const digestB = digestOfBatch(runB, 32);
  assert.equal(digestA, digestB, "the same fixed-seed workload must produce the identical observed-state digest");
  assert.equal(digestA, shapeDigestOf({
    suite: "runtime-core/session-scale",
    driver: COUNTER_WORLD_KIND,
    limits: DEFAULT_KERNEL_LIMITS,
    sessions: 32,
    actsPerSession: ACTS_PER_SESSION,
    ticksPerSession: TICKS_PER_SESSION,
    seedCycle: 8,
    intentKind: "world.increment",
    observed: runA.map((kernel) => stateProjectionOf(kernel)),
  }));
  console.log(`[perf] session-scale determinism digest: ${digestA}`);
});
