/**
 * PL-042 perf suite — TARGET FAN-OUT (packages/build-orchestrator).
 *
 * WHAT IS MEASURED (E11 honesty): N staged builds fanned out through ONE
 * orchestrator service instance over in-memory source/fabric/store/clock
 * fixtures with REAL, deterministic content digests (records sealed with
 * the package-system digest rule, locks fingerprinted by the lockfile
 * rule — see perf-fixtures.ts). Each build targets a different slot of
 * the frozen 11-target taxonomy (the 10 non-console targets; console
 * builds require out-of-band vendor evidence and are deliberately out of
 * this fan-out) and is driven through the public doors to its terminal
 * phase: requestBuild -> drive arcs (resolve/plan/emit/verify) ->
 * succeeded. Metrics: builds/sec and mean/p95 per-build end-to-end
 * latency at N=25 and N=100. Cross-tenant reads are TYPED refusals —
 * counted, never swallowed (R20/E8 evidence).
 *
 * Determinism: every build's manifest digest is content-derived; the
 * workload shape digest (descriptor + sorted manifest digests) is
 * asserted stable across a small repeat.
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
  fanout25Ms: 400,
  fanout100Ms: 1_000,
} as const;

const TENANT: TenantId = asTenantId("perf-tenant");
const FOREIGN_TENANT: TenantId = asTenantId("perf-foreign-tenant");

/** One orchestrator over the deterministic fixture graph (in-memory, E11). */
function makeOrchestrator() {
  const records = [
    perfPackageRecord("perf-graph-base"),
    perfPackageRecord("perf-graph-a", { dependsOn: ["perf-graph-base"] }),
    perfPackageRecord("perf-graph-b", { dependsOn: ["perf-graph-base"] }),
    perfPackageRecord("perf-graph-c", { dependsOn: ["perf-graph-a", "perf-graph-b"] }),
  ];
  const lock = perfLock(records);
  const fingerprint = perfLockFingerprint(lock);
  const resolvable = new Set<string>([fingerprint]);
  const inputsBySlot = new Map<number, ReturnType<typeof perfBuildInputs>>();
  for (let slot = 0; slot < 120; slot += 1) {
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
  return { service, records, lock, fingerprint, inputsBySlot };
}

/** Runs one build end to end, returning its latency and manifest digest. */
async function runOneBuild(
  service: BuildOrchestratorService,
  inputs: ReturnType<typeof perfBuildInputs>,
  nonce: string,
): Promise<{ readonly latencyMs: number; readonly manifestDigest: string; readonly buildId: string }> {
  const started = nowMs();
  const intake = service.requestBuild(TENANT, perfBuildRequest(inputs, nonce));
  if (!intake.ok) throw new Error(`intake refused: ${intake.code} — ${intake.message}`);
  let manifestDigest = "";
  for (let arc = 0; arc < 12; arc += 1) {
    const step = await service.drive(TENANT, intake.buildId);
    if (!step.ok) throw new Error(`drive refused: ${step.code} — ${step.message}`);
    if (step.manifestDigest !== undefined) manifestDigest = step.manifestDigest;
    if (step.terminal) {
      if (step.phase !== "succeeded") throw new Error(`build ended in phase ${step.phase}`);
      return { latencyMs: nowMs() - started, manifestDigest, buildId: String(intake.buildId) };
    }
  }
  throw new Error("no terminal phase within 12 arcs");
}

async function fanOut(count: number, tag: string) {
  const { service, inputsBySlot } = makeOrchestrator();
  const latencies: number[] = [];
  const manifestDigests: string[] = [];
  const buildIds: string[] = [];
  const started = nowMs();
  for (let i = 0; i < count; i += 1) {
    const inputs = inputsBySlot.get(i % 120);
    if (inputs === undefined) throw new Error("missing fan-out inputs");
    const outcome = await runOneBuild(service, inputs, `${tag}-nonce-${i}`);
    latencies.push(outcome.latencyMs);
    manifestDigests.push(outcome.manifestDigest);
    buildIds.push(outcome.buildId);
  }
  const elapsed = nowMs() - started;
  return { service, elapsed, latencies, manifestDigests: manifestDigests.sort(), buildIds };
}

test("target fan-out: 25 staged builds through one orchestrator", async () => {
  const { elapsed, latencies, manifestDigests } = await fanOut(25, "fan25");
  assert.ok(elapsed < BUDGETS.fanout25Ms, `25-build fan-out took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.fanout25Ms}ms)`);
  assert.equal(manifestDigests.length, 25);
  logMetric("staged build fan-out", "25 builds (10 targets, 1 orchestrator)", elapsed, 25, `mean ${meanOf(latencies).toFixed(1)} ms/build | p95 ${percentileOf(latencies, 95).toFixed(1)} ms/build`);
});

test("target fan-out: 100 staged builds through one orchestrator", async () => {
  const { service, elapsed, latencies, manifestDigests, buildIds } = await fanOut(100, "fan100");
  assert.ok(elapsed < BUDGETS.fanout100Ms, `100-build fan-out took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.fanout100Ms}ms)`);
  assert.equal(manifestDigests.length, 100);
  logMetric("staged build fan-out", "100 builds (10 targets, 1 orchestrator)", elapsed, 100, `mean ${meanOf(latencies).toFixed(1)} ms/build | p95 ${percentileOf(latencies, 95).toFixed(1)} ms/build`);
  // R20/E8: cross-tenant reads over the REAL build ids are typed refusals, counted, never swallowed.
  const started = nowMs();
  let refusals = 0;
  const codes = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    const status = service.status(FOREIGN_TENANT, (buildIds[i] ?? "none") as never);
    if (!status.ok) {
      refusals += 1;
      codes.add(status.code);
    }
  }
  const refusalElapsed = nowMs() - started;
  assert.equal(refusals, 100);
  assert.deepEqual([...codes], ["wrong-tenant"]);
  logMetric("typed wrong-tenant refusals", "100 status reads over real builds under a foreign tenant (R20, E8 counted)", refusalElapsed, 100);
});

test("target fan-out: the workload is deterministic (small repeat)", async () => {
  const run = async (): Promise<string> => {
    const { service, inputsBySlot, records, lock } = makeOrchestrator();
    const manifestDigests: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const inputs = inputsBySlot.get(i);
      if (inputs === undefined) throw new Error("missing fan-out inputs");
      // The SAME nonces in both runs (separate orchestrator instances keep
      // the encounters isolated): build ids are content-derived, so the
      // manifest digests must be identical.
      const outcome = await runOneBuild(service, inputs, `det-nonce-${i}`);
      manifestDigests.push(outcome.manifestDigest);
    }
    return shapeDigestOf({
      suite: "build-orchestrator/target-fanout",
      builds: 5,
      records: records.map((record) => record.identity.contentDigest).sort(),
      lockFingerprint: perfLockFingerprint(lock),
      manifestDigests: manifestDigests.sort(),
    });
  };
  const digestA = await run();
  const digestB = await run();
  assert.equal(digestA, digestB, "identical fan-out workloads must produce identical manifest-digest sets");
  console.log(`[perf] target-fanout determinism digest: ${digestA}`);
});
