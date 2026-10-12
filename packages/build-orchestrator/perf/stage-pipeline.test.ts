/**
 * PL-042 perf suite — STAGE PIPELINE (packages/build-orchestrator).
 *
 * WHAT IS MEASURED (E11 honesty): the per-stage cost and end-to-end build
 * latency of the staged pipeline at two fan-out scales (10 and 50 builds),
 * driven through the public service doors. Per-arc wall-clock samples are
 * collected per phase (resolve / plan / emit / verify / succeeded) and the
 * end-to-end latency (intake -> terminal) per build; the suite reports
 * per-stage means and the end-to-end mean/p95 + builds/sec at each scale.
 * The fabric is the package's deterministic in-memory fake (synthetic
 * artifacts — no toolchain binaries, E11); the timings therefore bound the
 * ORCHESTRATION cost, not any real tool execution.
 *
 * Determinism: the phase sequence of every build is the frozen machine
 * (asserted) and the workload shape digest is stable across a repeat.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BuildOrchestratorService,
  asTenantId,
  createFakeBuildSource,
  createFakeToolFabric,
  createManualClock,
  createMemoryBuildStore,
} from "../src/index.ts";
import type { TenantId } from "../src/index.ts";
import {
  FANOUT_TARGETS,
  logMetric,
  meanOf,
  nowMs,
  percentileOf,
  perfBuildInputs,
  perfBuildRequest,
  perfLock,
  perfLockFingerprint,
  perfPackageRecord,
  resolvableDigestsOf,
  shapeDigestOf,
} from "./perf-fixtures.ts";

/** Budgets (ms): generous upper bounds ~10x observed on the 4GB sandbox. */
const BUDGETS = {
  scale10Ms: 300,
  scale50Ms: 600,
} as const;

const TENANT: TenantId = asTenantId("perf-pipeline-tenant");

/** One orchestrator over the deterministic fixture graph (in-memory, E11). */
function makeOrchestrator(slots: number) {
  const records = [
    perfPackageRecord("perf-pipe-base"),
    perfPackageRecord("perf-pipe-a", { dependsOn: ["perf-pipe-base"] }),
    perfPackageRecord("perf-pipe-b", { dependsOn: ["perf-pipe-base"] }),
  ];
  const lock = perfLock(records);
  const fingerprint = perfLockFingerprint(lock);
  const resolvable = new Set<string>([fingerprint]);
  const inputsBySlot = new Map<number, ReturnType<typeof perfBuildInputs>>();
  for (let slot = 0; slot < slots; slot += 1) {
    const inputs = perfBuildInputs(lock, { target: FANOUT_TARGETS[slot % FANOUT_TARGETS.length] as string, slot });
    inputsBySlot.set(slot, inputs);
    for (const digest of resolvableDigestsOf(inputs)) resolvable.add(digest);
  }
  const service = new BuildOrchestratorService({
    sources: createFakeBuildSource({ records, locks: new Map([[fingerprint, lock]]), resolvableContent: resolvable }),
    fabric: createFakeToolFabric({ operations: ["build", "test", "package"].map((operation) => operation as never) }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });
  return { service, inputsBySlot };
}

/** One build's per-arc samples + end-to-end latency + observed phase order. */
async function pipelineOneBuild(service: BuildOrchestratorService, inputs: ReturnType<typeof perfBuildInputs>, nonce: string) {
  const started = nowMs();
  const intake = service.requestBuild(TENANT, perfBuildRequest(inputs, nonce));
  if (!intake.ok) throw new Error(`intake refused: ${intake.code} — ${intake.message}`);
  const phases: string[] = [];
  const arcSamples: number[] = [];
  for (let arc = 0; arc < 12; arc += 1) {
    const arcStarted = nowMs();
    const step = await service.drive(TENANT, intake.buildId);
    arcSamples.push(nowMs() - arcStarted);
    if (!step.ok) throw new Error(`drive refused: ${step.code} — ${step.message}`);
    phases.push(step.phase);
    if (step.terminal) {
      if (step.phase !== "succeeded") throw new Error(`build ended in phase ${step.phase}`);
      return { phases, arcSamples, latencyMs: nowMs() - started, manifestDigest: step.manifestDigest ?? "" };
    }
  }
  throw new Error("no terminal phase within 12 arcs");
}

/** Runs `count` builds through one orchestrator, collecting per-arc samples. */
async function runScale(count: number, tag: string) {
  const { service, inputsBySlot } = makeOrchestrator(count + 4);
  const endToEnd: number[] = [];
  const arcsByPhase = new Map<string, number[]>();
  const phaseOrders: string[][] = [];
  const started = nowMs();
  for (let i = 0; i < count; i += 1) {
    const inputs = inputsBySlot.get(i);
    if (inputs === undefined) throw new Error("missing pipeline inputs");
    const outcome = await pipelineOneBuild(service, inputs, `${tag}-${i}`);
    endToEnd.push(outcome.latencyMs);
    phaseOrders.push(outcome.phases);
    outcome.phases.forEach((phase, index) => {
      const bucket = arcsByPhase.get(phase) ?? [];
      bucket.push(outcome.arcSamples[index] as number);
      arcsByPhase.set(phase, bucket);
    });
  }
  return { elapsed: nowMs() - started, endToEnd, arcsByPhase, phaseOrders };
}

function report(scale: string, elapsed: number, endToEnd: readonly number[], arcsByPhase: ReadonlyMap<string, readonly number[]>): void {
  for (const phase of [...arcsByPhase.keys()].sort()) {
    const samples = arcsByPhase.get(phase) ?? [];
    console.log(`[perf] stage arc | ${phase.padEnd(9)} | mean ${meanOf(samples).toFixed(3)} ms | p95 ${percentileOf(samples, 95).toFixed(3)} ms | n ${samples.length}`);
  }
  logMetric("staged pipeline end-to-end", scale, elapsed, endToEnd.length, `mean ${meanOf(endToEnd).toFixed(1)} ms/build | p95 ${percentileOf(endToEnd, 95).toFixed(1)} ms/build`);
}

test("stage pipeline: per-stage cost + end-to-end latency at scale 10", async () => {
  const { elapsed, endToEnd, arcsByPhase, phaseOrders } = await runScale(10, "pipe10");
  assert.ok(elapsed < BUDGETS.scale10Ms, `10-build pipeline took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.scale10Ms}ms)`);
  for (const order of phaseOrders) {
    assert.deepEqual(order, ["resolve", "plan", "emit", "verify", "succeeded"]);
  }
  report("scale 10 (10 builds)", elapsed, endToEnd, arcsByPhase);
});

test("stage pipeline: per-stage cost + end-to-end latency at scale 50", async () => {
  const { elapsed, endToEnd, arcsByPhase, phaseOrders } = await runScale(50, "pipe50");
  assert.ok(elapsed < BUDGETS.scale50Ms, `50-build pipeline took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.scale50Ms}ms)`);
  assert.equal(phaseOrders.length, 50);
  for (const order of phaseOrders) {
    assert.deepEqual(order, ["resolve", "plan", "emit", "verify", "succeeded"]);
  }
  report("scale 50 (50 builds)", elapsed, endToEnd, arcsByPhase);
});

test("stage pipeline: the workload is deterministic (small repeat)", async () => {
  const run = async (): Promise<string> => {
    const { service, inputsBySlot } = makeOrchestrator(8);
    const outcomes: { phases: readonly string[]; manifestDigest: string }[] = [];
    for (let i = 0; i < 4; i += 1) {
      const inputs = inputsBySlot.get(i);
      if (inputs === undefined) throw new Error("missing pipeline inputs");
      // The SAME nonces in both runs (separate orchestrator instances keep
      // the encounters isolated): build ids are content-derived.
      const outcome = await pipelineOneBuild(service, inputs, `det-nonce-${i}`);
      outcomes.push({ phases: outcome.phases, manifestDigest: outcome.manifestDigest });
    }
    return shapeDigestOf({
      suite: "build-orchestrator/stage-pipeline",
      builds: 4,
      phases: outcomes.map((outcome) => outcome.phases),
      manifestDigests: outcomes.map((outcome) => outcome.manifestDigest).sort(),
    });
  };
  const digestA = await run();
  const digestB = await run();
  assert.equal(digestA, digestB, "identical pipeline workloads must produce identical phase orders + manifest digests");
  console.log(`[perf] stage-pipeline determinism digest: ${digestA}`);
});
