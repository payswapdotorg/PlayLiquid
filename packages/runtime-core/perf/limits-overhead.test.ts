/**
 * PL-042 perf suite — LIMITS OVERHEAD (packages/runtime-core).
 *
 * WHAT IS MEASURED (E11 honesty): the cost of DEFAULT_KERNEL_LIMITS
 * enforcement, in two comparisons over the public kernel surface:
 *
 * 1. ADMITTED-WORK OVERHEAD — the identical in-bounds workload (step(8)
 *    x 400 + 4,000 unique commands) run on a default-limits kernel and
 *    on a kernel whose caps are relaxed to 2^20. The rate delta between
 *    the two is the enforcement overhead of the limit checks themselves
 *    (validation, per-step tick bound, per-tick/per-command event caps
 *    and flood detection).
 *
 * 2. REJECTED-OVERLOAD RATE — the same 200 overload-shaped step(1025)
 *    calls issued to a DEFAULT_KERNEL_LIMITS kernel (cap 1024 -> every
 *    call is a TYPED `invalid-ticks` refusal, counted, never swallowed)
 *    and to a kernel whose cap is raised to 2048 (the same calls EXECUTE
 *    205,000 ticks). A larger 5,000-call refusal run measures the
 *    typed-refusal rate itself.
 *
 * Determinism: the workload shape digest of the admitted program is
 * asserted stable across a repeat.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_KERNEL_LIMITS } from "../src/index.ts";
import { logMetric, makePerfSession, nowMs, playerIncrementAct, shapeDigestOf, stateProjectionOf } from "./perf-kit.ts";
import type { KernelLimits } from "../src/index.ts";

/** Budgets (ms): generous upper bounds ~10x observed on the 4GB sandbox. */
const BUDGETS = {
  admittedWorkloadMs: 800,
  overloadExecutedMs: 2_000,
  refusalRunMs: 100,
} as const;

const RELAXED_LIMITS: KernelLimits = {
  maxTicksPerStep: 1 << 20,
  maxEventsPerTick: 1 << 20,
  maxEventsPerCommand: 1 << 20,
};

/** The identical admitted workload on any limits configuration. */
function admittedWorkload(tag: string, limits?: Partial<KernelLimits>) {
  const kernel = makePerfSession(`${tag}-session`, { seed: "perf-limits-seed", ...(limits === undefined ? {} : { limits }) });
  kernel.load();
  const started = nowMs();
  let ticks = 0;
  for (let i = 0; i < 400; i += 1) {
    const stepped = kernel.step(8);
    if (stepped.status !== "stepped") throw new Error(`step 8 refused: ${String(stepped.status)}`);
    ticks += 8;
  }
  for (let i = 0; i < 4_000; i += 1) {
    const result = kernel.act(playerIncrementAct(i + 1));
    if (result.status !== "committed") throw new Error(`act ${i} not committed: ${String(result.status)}`);
  }
  return { kernel, elapsed: nowMs() - started, ticks };
}

test("limits overhead: admitted-work rate with DEFAULT_KERNEL_LIMITS vs relaxed caps", () => {
  const withDefaults = admittedWorkload("lim-default");
  const relaxed = admittedWorkload("lim-relaxed", RELAXED_LIMITS);
  assert.ok(withDefaults.elapsed < BUDGETS.admittedWorkloadMs, `default-limits workload took ${withDefaults.elapsed.toFixed(1)}ms (budget ${BUDGETS.admittedWorkloadMs}ms)`);
  assert.ok(relaxed.elapsed < BUDGETS.admittedWorkloadMs, `relaxed-limits workload took ${relaxed.elapsed.toFixed(1)}ms (budget ${BUDGETS.admittedWorkloadMs}ms)`);
  const overhead = (withDefaults.elapsed - relaxed.elapsed) / relaxed.elapsed;
  console.log(
    `[perf] limits overhead | default ${withDefaults.elapsed.toFixed(1)}ms vs relaxed ${relaxed.elapsed.toFixed(1)}ms` +
      ` over 3,200 ticks + 4,000 commands | rate delta ${(overhead * 100).toFixed(1)}% (machine-dependent, informational)`,
  );
  logMetric("admitted work under limits", "step(8) x 400 + 4,000 commands (DEFAULT_KERNEL_LIMITS)", withDefaults.elapsed, withDefaults.ticks + 4_000);
  assert.deepEqual(stateProjectionOf(withDefaults.kernel), stateProjectionOf(relaxed.kernel));
});

test("limits overhead: overload-shaped step(1025) — typed refusals (counted) vs executed ticks", () => {
  // With DEFAULT_KERNEL_LIMITS every call is a typed refusal.
  const refusing = makePerfSession("lim-refusing", { seed: "perf-limits-seed" });
  refusing.load();
  const refusalStarted = nowMs();
  let refusals = 0;
  let executed = 0;
  for (let i = 0; i < 200; i += 1) {
    const result = refusing.step(DEFAULT_KERNEL_LIMITS.maxTicksPerStep + 1);
    if (result.status === "rejected") {
      assert.equal(result.code, "invalid-ticks");
      refusals += 1;
    } else {
      executed += 1;
    }
  }
  const refusalElapsed = nowMs() - refusalStarted;
  assert.equal(refusals, 200, "every overload call must be refused");
  assert.equal(executed, 0, "no overload call may execute under the default cap");
  assert.equal(refusing.view().tick, 0, "refused overloads must not advance the tick");
  logMetric("typed overload refusals", "200 x step(1025) vs cap 1024 (E8 counted)", refusalElapsed, 200);

  // With the cap raised to 2048 the SAME calls execute 205,000 ticks.
  const executing = makePerfSession("lim-executing", { seed: "perf-limits-seed", limits: { maxTicksPerStep: 2048 } });
  executing.load();
  const executionStarted = nowMs();
  let ticks = 0;
  for (let i = 0; i < 200; i += 1) {
    const result = executing.step(1025);
    if (result.status === "stepped") ticks += 1025;
    else throw new Error(`unexpected refusal under raised cap: ${String(result.status)}`);
  }
  const executionElapsed = nowMs() - executionStarted;
  assert.equal(ticks, 205_000);
  assert.ok(executionElapsed < BUDGETS.overloadExecutedMs, `executed overload took ${executionElapsed.toFixed(1)}ms (budget ${BUDGETS.overloadExecutedMs}ms)`);
  logMetric("executed overload (cap 2048)", "200 x step(1025) = 205,000 ticks", executionElapsed, 205_000);
});

test("limits overhead: typed-refusal rate at 5,000 overload calls (E8 never swallowed)", () => {
  const kernel = makePerfSession("lim-refusal-rate", { seed: "perf-limits-seed" });
  kernel.load();
  const started = nowMs();
  let refusals = 0;
  const codes = new Map<string, number>();
  for (let i = 0; i < 5_000; i += 1) {
    const result = kernel.step(DEFAULT_KERNEL_LIMITS.maxTicksPerStep + 1);
    if (result.status === "rejected") {
      refusals += 1;
      codes.set(result.code, (codes.get(result.code) ?? 0) + 1);
    }
  }
  const elapsed = nowMs() - started;
  assert.equal(refusals, 5_000, "every overload must be counted");
  assert.deepEqual([...codes.entries()], [["invalid-ticks", 5_000]]);
  assert.ok(elapsed < BUDGETS.refusalRunMs, `5,000 refusals took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.refusalRunMs}ms)`);
  logMetric("typed refusal throughput", "5,000 x step(1025) refusals (1 session)", elapsed, 5_000);
});

test("limits overhead: the workload is deterministic (small repeat)", () => {
  const program = (kernel: ReturnType<typeof makePerfSession>) => {
    kernel.load();
    for (let i = 0; i < 20; i += 1) kernel.step(8);
    for (let i = 0; i < 100; i += 1) kernel.act(playerIncrementAct(i + 1));
    return kernel;
  };
  const digestOf = (kernel: ReturnType<typeof makePerfSession>): string =>
    shapeDigestOf({
      suite: "runtime-core/limits-overhead",
      limits: DEFAULT_KERNEL_LIMITS,
      program: [{ ticks: 20, tickSize: 8 }, { commands: 100 }],
      observed: stateProjectionOf(kernel),
    });
  const digestA = digestOf(program(makePerfSession("det-a", { seed: "perf-limits-seed" })));
  const digestB = digestOf(program(makePerfSession("det-b", { seed: "perf-limits-seed" })));
  assert.equal(digestA, digestB, "identical fixed-seed limit workloads must produce identical observed-state digests");
  console.log(`[perf] limits-overhead determinism digest: ${digestA}`);
});
