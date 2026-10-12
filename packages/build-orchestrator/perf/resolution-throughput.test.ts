/**
 * PL-042 perf suite — RESOLUTION THROUGHPUT (packages/build-orchestrator).
 *
 * WHAT IS MEASURED (E11 honesty): package-closure resolution + R19
 * adjudication over the public `adjudicateClosure` authority, at lock
 * scales M=100 and M=400 packages (fixtures sealed with REAL content
 * digests; every record re-validated + digest-recomputed by the
 * authority on every call). Metrics: adjudications/sec, packages/sec.
 * Typed refusals are exercised and COUNTED (E8, never swallowed): a
 * tampered lock fingerprint (lock-fingerprint-mismatch) and a
 * declared-license record failing the R19 provenance gate
 * (provenance-gate-failed).
 *
 * Determinism: the resolved topological order + closure digest shape is
 * asserted stable across a small repeat.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adjudicateClosure, asTenantId, createFakeBuildSource, createManualClock, createFakeToolFabric, createMemoryBuildStore, BuildOrchestratorService } from "../src/index.ts";
import { logMetric, nowMs, perfLock, perfLockFingerprint, perfPackageRecord, shapeDigestOf } from "./perf-fixtures.ts";

/** Budgets (ms): generous upper bounds ~10x observed on the 4GB sandbox. */
const BUDGETS = {
  adjudications100Ms: 2_500,
  adjudications400Ms: 3_000,
  refusalRunsMs: 15_000,
} as const;

/** Builds a package graph of `count` records (leaves + a base), pinned by one lock. */
function graphOf(count: number) {
  const records = [perfPackageRecord("perf-res-base"), ...Array.from({ length: count - 1 }, (_, index) => perfPackageRecord(`perf-res-${String(index).padStart(4, "0")}`, { dependsOn: ["perf-res-base"] }))];
  const lock = perfLock(records);
  return { records, lock, fingerprint: perfLockFingerprint(lock) };
}

/** Repeated adjudication of the same closure; returns elapsed ms. */
function adjudicateTimes(count: number, repeats: number): number {
  const { records, lock, fingerprint } = graphOf(count);
  const source = createFakeBuildSource({ records, locks: new Map([[fingerprint, lock]]) });
  const started = nowMs();
  for (let i = 0; i < repeats; i += 1) {
    const admission = adjudicateClosure(source, fingerprint);
    if (!admission.ok) throw new Error(`adjudication refused: ${admission.code} — ${admission.message}`);
  }
  return nowMs() - started;
}

test("resolution throughput: closure resolution + R19 adjudication over 100 packages", () => {
  const repeats = 40;
  const elapsed = adjudicateTimes(100, repeats);
  assert.ok(elapsed < BUDGETS.adjudications100Ms, `40 adjudications of a 100-package lock took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.adjudications100Ms}ms)`);
  logMetric("closure resolution + adjudication", `100-package lock x ${repeats} adjudications`, elapsed, 100 * repeats);
});

test("resolution throughput: closure resolution + R19 adjudication over 400 packages", () => {
  const repeats = 15;
  const elapsed = adjudicateTimes(400, repeats);
  assert.ok(elapsed < BUDGETS.adjudications400Ms, `15 adjudications of a 400-package lock took ${elapsed.toFixed(1)}ms (budget ${BUDGETS.adjudications400Ms}ms)`);
  logMetric("closure resolution + adjudication", `400-package lock x ${repeats} adjudications`, elapsed, 400 * repeats);
});

test("resolution throughput: typed refusals are counted, never swallowed (E8)", () => {
  // 1. Tampered lock under a stale fingerprint: the lock loads, but its
  //    content (a DIFFERENT pin set) hashes to a different fingerprint.
  const honestGraph = graphOf(50);
  const tamperedGraph = graphOf(51);
  const tamperedSource = createFakeBuildSource({
    records: tamperedGraph.records,
    locks: new Map([[honestGraph.fingerprint, tamperedGraph.lock]]),
  });
  const started = nowMs();
  let mismatches = 0;
  for (let i = 0; i < 2_000; i += 1) {
    const admission = adjudicateClosure(tamperedSource, honestGraph.fingerprint);
    if (!admission.ok && admission.code === "lock-fingerprint-mismatch") mismatches += 1;
  }
  const mismatchElapsed = nowMs() - started;
  assert.equal(mismatches, 2_000, "every tampered-fingerprint call must be refused");
  logMetric("typed lock-fingerprint-mismatch refusals", "2,000 adjudications of a tampered lock under a stale fingerprint", mismatchElapsed, 2_000);

  // 2. A declared (unverified) license fails the R19 provenance gate.
  const unlicensed = [perfPackageRecord("perf-res-unlicensed", { licenseStatus: "declared" }), ...honestGraph.records];
  const unlicensedLock = perfLock(unlicensed);
  const unlicensedFingerprint = perfLockFingerprint(unlicensedLock);
  const gatedSource = createFakeBuildSource({ records: unlicensed, locks: new Map([[unlicensedFingerprint, unlicensedLock]]) });
  const gateStarted = nowMs();
  let gateFailures = 0;
  for (let i = 0; i < 500; i += 1) {
    const admission = adjudicateClosure(gatedSource, unlicensedFingerprint);
    if (!admission.ok && admission.code === "provenance-gate-failed") gateFailures += 1;
  }
  const gateElapsed = nowMs() - gateStarted;
  assert.equal(gateFailures, 500, "every unlicensed closure must fail the R19 gate");
  assert.ok(mismatchElapsed + gateElapsed < BUDGETS.refusalRunsMs, `refusal runs took ${(mismatchElapsed + gateElapsed).toFixed(1)}ms (budget ${BUDGETS.refusalRunsMs}ms)`);
  logMetric("typed provenance-gate-failed refusals", "500 adjudications of an unlicensed closure (R19)", gateElapsed, 500);
});

test("resolution throughput: the workload is deterministic (small repeat)", () => {
  const resolve = (): string => {
    const { records, lock, fingerprint } = graphOf(24);
    const source = createFakeBuildSource({ records, locks: new Map([[fingerprint, lock]]) });
    const admission = adjudicateClosure(source, fingerprint);
    if (!admission.ok) throw new Error(`adjudication refused: ${admission.code}`);
    return shapeDigestOf({
      suite: "build-orchestrator/resolution-throughput",
      packages: 24,
      lockFingerprint: admission.closure.lockFingerprint,
      closureDigest: admission.closure.closureDigest,
      topologicalOrder: admission.closure.resolution.topologicalOrder,
    });
  };
  const digestA = resolve();
  const digestB = resolve();
  assert.equal(digestA, digestB, "identical locks must resolve to identical closure digests");
  console.log(`[perf] resolution-throughput determinism digest: ${digestA}`);
});

test("resolution throughput: the service resolve arc uses the same authority", async () => {
  // End-to-end sanity: one admitted build over the 100-package lock drives
  // its resolve arc through the service door (not just the pure function).
  const { records, lock, fingerprint } = graphOf(100);
  const gameIrDigest = "sha256:" + "1".repeat(64);
  const profileDigest = "sha256:" + "2".repeat(64);
  const bindingDigest = "sha256:" + "3".repeat(64);
  const toolchainDigest = "sha256:" + "4".repeat(64);
  const service = new BuildOrchestratorService({
    sources: createFakeBuildSource({
      records,
      locks: new Map([[fingerprint, lock]]),
      resolvableContent: new Set([gameIrDigest, profileDigest, bindingDigest, toolchainDigest]),
    }),
    fabric: createFakeToolFabric({ operations: ["build", "test", "package"].map((operation) => operation as never) }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });
  const tenant = asTenantId("perf-resolve-tenant");
  const request = {
    kind: "request-build" as const,
    idempotency: { scope: "build-request" as const, requester: "perf-builder" as never, nonce: "resolve-arc-1" as never },
    inputs: {
      gameIr: { digest: gameIrDigest },
      packageLock: { lockFingerprint: fingerprint, pinnedPackageCount: lock.packages.length },
      targetProfile: { profileId: "perf-profile" as never, profileDigest, target: "web" as never, vendorGate: { kind: "none" as const } },
      engineBinding: { engineId: "native" as never, bindingDigest, supportedTargets: ["web" as never] },
      toolchain: { profileId: "perf-toolchain" as never, profileDigest: toolchainDigest, citesToolOperations: ["build", "test", "package"] as never },
    },
    parameters: { kind: "record" as const, fields: { scale: { kind: "int" as const, value: 100n } } },
    requestedAt: 1_700_000_000_000,
  };
  const intake = service.requestBuild(tenant, request);
  assert.equal(intake.ok, true);
  const started = nowMs();
  const step = await service.drive(tenant, intake.ok ? intake.buildId : ("none" as never));
  const elapsed = nowMs() - started;
  assert.equal(step.ok, true);
  if (step.ok) {
    assert.equal(step.phase, "resolve");
    assert.equal(step.terminal, false);
  }
  logMetric("service resolve arc", "one 100-package build driven through the resolve arc", elapsed, 100);
});
