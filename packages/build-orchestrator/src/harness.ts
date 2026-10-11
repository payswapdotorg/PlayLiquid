/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives the full build-orchestrator journeys over the in-memory fakes
 * (deterministic; every digest derived, never hand-written):
 *  1. web happy path: intake → resolve → plan → emit → verify → package
 *     → SUCCEEDED with manifest digest, outputs served by the
 *     BuildExecutor view (E10, E9);
 *  2. idempotent replay returns the recorded build id (E6); same payload
 *     under a fresh nonce is refused `duplicate-payload` (E8/E9);
 *  3. unresolvable input refused at intake, naming the input (E1);
 *  4. closure containing unverified-license records fails the R19 gate
 *     (`closure-provenance-gate-failed`), never silent completion;
 *  5. missing toolchain operation fails `toolchain-unavailable` with a
 *     truthful E11 limitation recorded;
 *  6. console build without vendor evidence fails `vendor-evidence-required`
 *     (authorization never fabricated — lock rule 24);
 *  7. console build WITH out-of-band vendor evidence (authorization +
 *     on-target record verifying the manifest digest) succeeds;
 *  8. console build with an on-target record verifying a WRONG digest
 *     fails the vendor gate (fail-closed);
 *  9. tool failure + malformed tool output are typed stage failures;
 * 10. cooperative cancellation; terminal builds refuse further drives;
 * 11. cross-tenant commands are typed refusals (R20);
 * 12. snapshot → restore resumes exactly (E6); a diverged store is
 *     refused `store-divergence` (torn state, E8/E10);
 * 13. per-build event sequences are exactly 1, 2, 3, … (append-only E10);
 * 14. E9 determinism: two identical instances produce identical build
 *     ids and identical snapshot ids.
 * Prints deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no wall clock, no randomness.
 */

import {
  asBuildId,
  asBuildNonce,
  asRequesterId,
  asToolOperationId,
} from "@playliquid/build-contracts";
import type { BuildId } from "@playliquid/build-contracts";
import { computeLockFingerprint } from "@playliquid/package-system";
import type { ContentDigest, PackageLock, PackageRecord } from "@playliquid/package-system";
import { BuildOrchestratorService } from "./service.ts";
import type { BuildStatusView, DriveRefusal, DriveStepResult } from "./service-types.ts";
import { asTenantId } from "./tenancy.ts";
import type { TenantId } from "./tenancy.ts";
import { createFakeBuildSource, createFakeToolFabric, createManualClock, createMemoryBuildStore } from "./fakes.ts";
import type { FakeToolFabric } from "./fakes.ts";
import {
  contentDigestsOf,
  expectedManifestDigest,
  fixtureBuildRequest,
  fixtureConsoleBuildInputs,
  fixtureDigest,
  fixtureEvaluationEvidence,
  fixtureLock,
  fixtureOnTargetEvidence,
  fixturePackageRecord,
  fixtureRecords,
  fixtureVendorSdkEvidence,
  fixtureWebBuildInputs,
  stageDigestsFromEvents,
} from "./fixtures.ts";

const tenantA = asTenantId("tenant-alpha");
const tenantB = asTenantId("tenant-beta");

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
const failures: string[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
  if (expected !== actual) {
    failures.push(`${name}: expected ${expected}, got ${actual}`);
  }
}

interface Rig {
  readonly service: BuildOrchestratorService;
  readonly store: ReturnType<typeof createMemoryBuildStore>;
  readonly fabric: FakeToolFabric;
}

function rig(options: {
  records?: readonly PackageRecord[];
  locks?: ReadonlyMap<ContentDigest, PackageLock>;
  content?: readonly ContentDigest[];
  operations?: readonly string[];
} = {}): Rig {
  const clock = createManualClock();
  const store = createMemoryBuildStore();
  const fabric = createFakeToolFabric({ operations: (options.operations ?? ["build", "test", "package"]).map((operation) => asToolOperationId(operation)) });
  const service = new BuildOrchestratorService({
    sources: createFakeBuildSource({
      records: options.records ?? fixtureRecords(),
      ...(options.locks === undefined ? {} : { locks: options.locks }),
      ...(options.content === undefined ? {} : { resolvableContent: new Set(options.content) }),
    }),
    fabric,
    clock: clock.clock,
    store,
  });
  return { service, store, fabric };
}

function locksOf(...locks: readonly PackageLock[]): Map<ContentDigest, PackageLock> {
  const map = new Map<ContentDigest, PackageLock>();
  for (const lock of locks) {
    map.set(computeLockFingerprint(lock), lock);
  }
  return map;
}

async function driveAll(service: BuildOrchestratorService, tenant: TenantId, buildId: BuildId): Promise<DriveStepResult | DriveRefusal> {
  for (let index = 0; index < 10; index += 1) {
    const step = await service.drive(tenant, buildId);
    if (!step.ok || step.terminal) {
      return step;
    }
  }
  throw new Error("driveAll: build reached no terminal phase within 10 arcs");
}

function outcome(step: Awaited<ReturnType<typeof driveAll>>): string {
  return step.ok ? `${step.phase}:${step.failure === undefined ? "none" : step.failure.code}${step.manifestDigest === undefined ? "" : "+manifest"}` : `refused:${step.code}`;
}

async function main(): Promise<void> {
  const requester = asRequesterId("builder-agent");
  const nonceOf = (nonce: string) => ({ scope: "build-request" as const, requester, nonce: asBuildNonce(nonce) });

  // --- 1. web happy path --------------------------------------------------
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const web = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const request = fixtureBuildRequest(inputs);
  const intake = web.service.requestBuild(tenantA, request);
  record("intake-first", "first", intake.ok ? intake.classification : `refused:${intake.code}`);
  const buildId = intake.ok ? intake.buildId : asBuildId("");
  record("happy-path", "succeeded:none+manifest", outcome(await driveAll(web.service, tenantA, buildId)));
  const status = web.service.status(tenantA, buildId) as BuildStatusView;
  record("status-phase", "succeeded", status.ok ? status.phase : "refused");
  record("status-artifacts", "2", status.ok ? String(status.artifactCount) : "?");
  record("status-steps", "5", status.ok ? String(status.stepCount) : "?");
  const executed = web.service.asBuildExecutor().execute({ request: { request, buildId } });
  record("executor-view", "ok", executed.ok ? "ok" : `refused:${executed.code}`);

  // --- 2/3. replay, duplicate payload, unresolvable input -----------------
  const replay = web.service.requestBuild(tenantA, fixtureBuildRequest(inputs));
  record("replay-duplicate", `duplicate:${String(buildId)}`, replay.ok && replay.classification === "duplicate" ? `${replay.classification}:${String(replay.buildId)}` : `refused:${replay.ok ? "?" : replay.code}`);
  const reissue = web.service.requestBuild(tenantA, fixtureBuildRequest(inputs, { idempotency: nonceOf("nonce-0002") }));
  record("duplicate-payload", "refused:duplicate-payload", reissue.ok ? "accepted" : `refused:${reissue.code}`);
  const unresolvable = web.service.requestBuild(tenantA, fixtureBuildRequest(fixtureWebBuildInputs(lock, { over: { gameIrDigest: fixtureDigest("not-published-anywhere") } }), { idempotency: nonceOf("nonce-0003") }));
  record("unresolvable-input", "refused:unresolvable-input:gameIr", unresolvable.ok ? "accepted" : `refused:${unresolvable.code}${unresolvable.input === undefined ? "" : `:${unresolvable.input}`}`);

  // --- 4. R19 closure gate -------------------------------------------------
  const badRecords = [fixturePackageRecord("fixture-unlicensed-pack", { licenseStatus: "declared" }), ...records];
  const badLock = fixtureLock(badRecords);
  const badInputs = fixtureWebBuildInputs(badLock);
  const gated = rig({ records: badRecords, locks: locksOf(badLock), content: contentDigestsOf(badInputs) });
  const gatedIntake = gated.service.requestBuild(tenantA, fixtureBuildRequest(badInputs));
  const gatedId = gatedIntake.ok ? gatedIntake.buildId : asBuildId("");
  record("closure-gate", "failed:closure-provenance-gate-failed", outcome(await driveAll(gated.service, tenantA, gatedId)));

  // --- 5. toolchain unavailable (E11) --------------------------------------
  const missing = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs), operations: ["build", "package"] });
  const missingIntake = missing.service.requestBuild(tenantA, fixtureBuildRequest(fixtureWebBuildInputs(lock, { operations: ["build", "deploy", "package"] })));
  const missingId = missingIntake.ok ? missingIntake.buildId : asBuildId("");
  record("toolchain-unavailable", "failed:toolchain-unavailable", outcome(await driveAll(missing.service, tenantA, missingId)));
  record("toolchain-limitation", "toolchain-unavailable", missing.service.limitations(tenantA).find((item) => item.code === "toolchain-unavailable")?.code ?? "none");

  // --- 6/7/8. console vendor gate ------------------------------------------
  const consoleInputs = fixtureConsoleBuildInputs(lock);
  const consoleRig = rig({ locks: locksOf(lock), content: contentDigestsOf(consoleInputs) });
  const consoleIntake = consoleRig.service.requestBuild(tenantA, fixtureBuildRequest(consoleInputs));
  const consoleId = consoleIntake.ok ? consoleIntake.buildId : asBuildId("");
  await consoleRig.service.drive(tenantA, consoleId);
  await consoleRig.service.drive(tenantA, consoleId);
  const ungated = await consoleRig.service.drive(tenantA, consoleId);
  record("console-no-evidence", "failed:vendor-evidence-required", outcome(ungated));
  record("console-limitation", "console-verification-out-of-band", consoleRig.service.limitations(tenantA).find((item) => item.code === "console-verification-out-of-band")?.code ?? "none");

  const consoleRig2 = rig({ locks: locksOf(lock), content: contentDigestsOf(consoleInputs) });
  const consoleIntake2 = consoleRig2.service.requestBuild(tenantA, fixtureBuildRequest(consoleInputs, { idempotency: nonceOf("console-0002") }));
  const consoleId2 = consoleIntake2.ok ? consoleIntake2.buildId : asBuildId("");
  await consoleRig2.service.drive(tenantA, consoleId2);
  await consoleRig2.service.drive(tenantA, consoleId2);
  const emitStep = await consoleRig2.service.drive(tenantA, consoleId2, { vendorEvidence: [fixtureVendorSdkEvidence(consoleInputs)] });
  record("console-emit-with-vendor-evidence", "emit:none", outcome(emitStep));
  await consoleRig2.service.drive(tenantA, consoleId2);
  const eventsBeforePackage = consoleRig2.service.events(tenantA, consoleId2);
  const manifestDigest = eventsBeforePackage.ok ? expectedManifestDigest(consoleId2, consoleInputs, stageDigestsFromEvents(eventsBeforePackage.events)) : fixtureDigest("missing");
  const packaged = await consoleRig2.service.drive(tenantA, consoleId2, { vendorEvidence: [fixtureOnTargetEvidence(manifestDigest)] });
  record("console-package-with-on-target", "succeeded:none+manifest", outcome(packaged));

  const consoleRig3 = rig({ locks: locksOf(lock), content: contentDigestsOf(consoleInputs) });
  const consoleIntake3 = consoleRig3.service.requestBuild(tenantA, fixtureBuildRequest(consoleInputs, { idempotency: nonceOf("console-0003") }));
  const consoleId3 = consoleIntake3.ok ? consoleIntake3.buildId : asBuildId("");
  await consoleRig3.service.drive(tenantA, consoleId3);
  await consoleRig3.service.drive(tenantA, consoleId3);
  await consoleRig3.service.drive(tenantA, consoleId3, { vendorEvidence: [fixtureVendorSdkEvidence(consoleInputs)] });
  await consoleRig3.service.drive(tenantA, consoleId3);
  const wrongTarget = await consoleRig3.service.drive(tenantA, consoleId3, { vendorEvidence: [fixtureOnTargetEvidence(fixtureDigest("wrong-manifest"))] });
  record("console-wrong-on-target-digest", "failed:vendor-evidence-required+manifest", outcome(wrongTarget));

  // --- 9. tool failure + malformed output -----------------------------------
  const faultRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const faultIntake = faultRig.service.requestBuild(tenantA, fixtureBuildRequest(fixtureWebBuildInputs(lock), { idempotency: nonceOf("fault-0001") }));
  const faultId = faultIntake.ok ? faultIntake.buildId : asBuildId("");
  faultRig.fabric.failOperation(asToolOperationId("test"), { code: "compiler-crash", message: "scripted fault" });
  record("tool-failure", "failed:tool-step-failed", outcome(await driveAll(faultRig.service, tenantA, faultId)));

  const malformedRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const malformedIntake = malformedRig.service.requestBuild(tenantA, fixtureBuildRequest(fixtureWebBuildInputs(lock), { idempotency: nonceOf("malformed-0001") }));
  const malformedId = malformedIntake.ok ? malformedIntake.buildId : asBuildId("");
  await malformedRig.service.drive(tenantA, malformedId);
  await malformedRig.service.drive(tenantA, malformedId);
  await malformedRig.service.drive(tenantA, malformedId);
  malformedRig.fabric.scriptNextOutput({ artifacts: [{ artifactKind: "game.bundle", digest: "not-a-digest", sizeBytes: 1, mediaType: "application/octet-stream" }] });
  record("malformed-tool-output", "failed:tool-output-invalid", outcome(await driveAll(malformedRig.service, tenantA, malformedId)));

  // --- 10. cancel + terminal refusal ----------------------------------------
  const cancelRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const cancelIntake = cancelRig.service.requestBuild(tenantA, fixtureBuildRequest(fixtureWebBuildInputs(lock), { idempotency: nonceOf("cancel-0001") }));
  const cancelId = cancelIntake.ok ? cancelIntake.buildId : asBuildId("");
  await cancelRig.service.drive(tenantA, cancelId);
  const cancelled = cancelRig.service.cancel(tenantA, {
    kind: "cancel-build",
    idempotency: { scope: "build-cancel", requester, nonce: asBuildNonce("cancel-nonce-1") },
    buildId: cancelId,
    requestedAt: 1,
  });
  record("cancel", "cancelled", cancelled.ok ? cancelled.phase : `refused:${cancelled.code}`);
  const afterCancel = await cancelRig.service.drive(tenantA, cancelId);
  record("drive-after-cancel", "refused:build-terminal", afterCancel.ok ? "accepted" : `refused:${afterCancel.code}`);

  // --- 11. cross-tenant (R20) ------------------------------------------------
  const crossRead = web.service.status(tenantB, buildId);
  record("cross-tenant-read", "refused:wrong-tenant", crossRead.ok ? "ok" : `refused:${crossRead.code}`);
  const crossDrive = await web.service.drive(tenantB, buildId);
  record("cross-tenant-drive", "refused:wrong-tenant", crossDrive.ok ? "ok" : `refused:${crossDrive.code}`);
  const invalidTenant = web.service.status("Not-A-Tenant" as TenantId, buildId);
  record("invalid-tenant", "refused:invalid-tenant", invalidTenant.ok ? "ok" : `refused:${invalidTenant.code}`);

  // --- 12. snapshot / restore / divergence ------------------------------------
  const resumeRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const resumeIntake = resumeRig.service.requestBuild(tenantA, fixtureBuildRequest(fixtureWebBuildInputs(lock), { idempotency: nonceOf("resume-0001") }));
  const resumeId = resumeIntake.ok ? resumeIntake.buildId : asBuildId("");
  await resumeRig.service.drive(tenantA, resumeId);
  await resumeRig.service.drive(tenantA, resumeId);
  const snapshot = resumeRig.service.snapshot();
  const restored = BuildOrchestratorService.restore(snapshot, {
    sources: createFakeBuildSource({ records, locks: locksOf(lock), resolvableContent: new Set(contentDigestsOf(inputs)) }),
    fabric: createFakeToolFabric({ operations: ["build", "test", "package"].map(asToolOperationId) }),
    clock: createManualClock(9_000).clock,
    store: resumeRig.store,
  });
  record("restore-ok", "ok", restored.ok ? "ok" : `refused:${restored.code}`);
  if (restored.ok) {
    record("restore-resume", "succeeded:none+manifest", outcome(await driveAll(restored.service, tenantA, resumeId)));
  }
  const divergent = BuildOrchestratorService.restore(snapshot, {
    sources: createFakeBuildSource({ records, locks: locksOf(lock), resolvableContent: new Set(contentDigestsOf(inputs)) }),
    fabric: createFakeToolFabric({ operations: ["build", "test", "package"].map(asToolOperationId) }),
    clock: createManualClock(9_000).clock,
    store: createMemoryBuildStore(),
  });
  record("restore-divergence", "refused:store-divergence", divergent.ok ? "ok" : `refused:${divergent.code}`);

  // --- 13. event log discipline (E10) -----------------------------------------
  const log = web.service.events(tenantA, buildId);
  const sequences = log.ok ? log.events.map((event) => event.sequence) : [];
  record(
    "event-sequences",
    "1..n-increasing",
    sequences.length > 0 && sequences.every((sequence, index) => sequence === index + 1) ? "1..n-increasing" : sequences.join(","),
  );
  const types = log.ok ? log.events.map((event) => event.type) : [];
  record("event-has-succeeded", "yes", types.includes("build-succeeded") ? "yes" : "no");

  // --- 14. E9 determinism ------------------------------------------------------
  const twinRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const twinRig2 = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const twinIntake = twinRig.service.requestBuild(tenantA, fixtureBuildRequest(fixtureWebBuildInputs(lock), { idempotency: nonceOf("twin-0001") }));
  const twinIntake2 = twinRig2.service.requestBuild(tenantA, fixtureBuildRequest(fixtureWebBuildInputs(lock), { idempotency: nonceOf("twin-0001") }));
  const twinId = twinIntake.ok ? twinIntake.buildId : asBuildId("");
  record("determinism-build-id", String(twinId), twinIntake2.ok ? String(twinIntake2.buildId) : "refused");
  await driveAll(twinRig.service, tenantA, twinId);
  if (twinIntake2.ok) {
    await driveAll(twinRig2.service, tenantA, twinIntake2.buildId);
  }
  record("determinism-snapshot", "equal", twinRig.service.snapshot().snapshotId === twinRig2.service.snapshot().snapshotId ? "equal" : "different");

  record("evaluation-evidence-shape", "evaluation-suite", fixtureEvaluationEvidence().kind);

  console.log(JSON.stringify({ harness: "build-orchestrator", ok: failures.length === 0, steps, failures }, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
