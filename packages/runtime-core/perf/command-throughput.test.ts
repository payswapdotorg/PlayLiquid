/**
 * PL-042 perf suite — COMMAND THROUGHPUT (packages/runtime-core).
 *
 * WHAT IS MEASURED (E11 honesty): the SessionCommandPath `act` pipeline
 * (idempotency pre-check over the intent fingerprint -> command
 * derivation -> contract admission -> driver application -> journal
 * append -> receipt) driven by M player-origin `world.increment`
 * commands against ONE loaded session, at M=5,000 and M=25,000. Every
 * command carries a unique nonce (first-encounter idempotency); the
 * results are counted by status — committed counts are asserted, no
 * result is ever swallowed. Timings are wall-clock on this box; the
 * workload shape digest is asserted stable across a repeat.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTER_WORLD_KIND, DEFAULT_KERNEL_LIMITS } from "../src/index.ts";
import { logMetric, makePerfSession, nowMs, playerIncrementAct, shapeDigestOf, stateProjectionOf } from "./perf-kit.ts";

/** Budgets (ms): generous upper bounds ~10x observed on the 4GB sandbox. */
const BUDGETS = {
  commands5000Ms: 600,
  commands25000Ms: 1_800,
  duplicateRetriesMs: 250,
} as const;

/** Drives M unique-nonce commands through one session; returns status counts. */
function driveCommands(count: number, tag: string) {
  const kernel = makePerfSession(`${tag}-session`, { seed: "perf-throughput-seed" });
  const loaded = kernel.load();
  if (loaded.status !== "loaded") throw new Error("throughput session did not load");
  const started = nowMs();
  let committed = 0;
  let other = 0;
  for (let i = 0; i < count; i += 1) {
    const result = kernel.act(playerIncrementAct(i + 1));
    if (result.status === "committed") committed += 1;
    else other += 1;
  }
  const elapsed = nowMs() - started;
  return { kernel, elapsed, committed, other };
}

function digestOf(kernel: ReturnType<typeof makePerfSession>, count: number): string {
  return shapeDigestOf({
    suite: "runtime-core/command-throughput",
    commands: count,
    driver: COUNTER_WORLD_KIND,
    limits: DEFAULT_KERNEL_LIMITS,
    intentKind: "world.increment",
    payload: { by: 1 },
    observed: stateProjectionOf(kernel),
  });
}

test("command throughput: 5,000 commands through the command path", () => {
  const { kernel, elapsed, committed, other } = driveCommands(5_000, "m5k");
  assert.equal(committed, 5_000);
  assert.equal(other, 0);
  assert.ok(elapsed < BUDGETS.commands5000Ms, `5k commands took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.commands5000Ms}ms)`);
  logMetric("command path throughput", "5,000 player-origin acts (1 session)", elapsed, 5_000);
  console.log(`[perf] command-throughput shape digest (5k): ${digestOf(kernel, 5_000)}`);
});

test("command throughput: 25,000 commands through the command path", () => {
  const { elapsed, committed, other } = driveCommands(25_000, "m25k");
  assert.equal(committed, 25_000);
  assert.equal(other, 0);
  assert.ok(elapsed < BUDGETS.commands25000Ms, `25k commands took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.commands25000Ms}ms)`);
  logMetric("command path throughput", "25,000 player-origin acts (1 session)", elapsed, 25_000);
});

test("command throughput: idempotent retries return the first receipt without double-commit", () => {
  const kernel = makePerfSession("retry-session", { seed: "perf-throughput-seed" });
  kernel.load();
  const first = kernel.act(playerIncrementAct(1, 7));
  assert.equal(first.status, "committed");
  const started = nowMs();
  let duplicates = 0;
  for (let i = 0; i < 10_000; i += 1) {
    const retry = kernel.act(playerIncrementAct(1, 7));
    if (retry.status === "duplicate") duplicates += 1;
    else throw new Error(`retry ${i} was not a duplicate: ${String(retry.status)}`);
  }
  const elapsed = nowMs() - started;
  assert.equal(duplicates, 10_000);
  // Only ONE command was admitted; the world advanced by the single by=7.
  assert.equal(kernel.view().admittedCommandSeq, 1);
  assert.ok(elapsed < BUDGETS.duplicateRetriesMs, `10k retries took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.duplicateRetriesMs}ms)`);
  logMetric("idempotent retry throughput", "10,000 duplicate re-submits (1 session)", elapsed, 10_000);
});

test("command throughput: the workload is deterministic (small repeat)", () => {
  const runA = driveCommands(400, "det-a");
  const runB = driveCommands(400, "det-b");
  const digestA = digestOf(runA.kernel, 400);
  const digestB = digestOf(runB.kernel, 400);
  assert.equal(digestA, digestB, "identical fixed-seed command workloads must produce identical observed-state digests");
  assert.equal(runA.committed, 400);
  assert.equal(runB.committed, 400);
  console.log(`[perf] command-throughput determinism digest: ${digestA}`);
});
