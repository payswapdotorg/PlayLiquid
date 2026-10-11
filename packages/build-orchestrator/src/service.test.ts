/**
 * Build orchestrator service tests — the phase arcs (E10), tenant
 * isolation (R20), the R19 closure gate, truthful E11 limitations, the
 * console vendor-SDK gate (lock rule 24), event discipline (E10),
 * snapshot/restore (E6), determinism (E9) and the BuildExecutor view.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asBuildId,
  asBuildNonce,
  asRequesterId,
  asToolOperationId,
  computeBuildManifestDigest,
} from "@playliquid/build-contracts";
import type { BuildId } from "@playliquid/build-contracts";
import { computeLockFingerprint } from "@playliquid/package-system";
import type { ContentDigest, PackageLock } from "@playliquid/package-system";
import { BuildOrchestratorService } from "./service.ts";
import type { DriveStepResult } from "./service-types.ts";
import { createFakeBuildSource, createFakeToolFabric, createManualClock, createMemoryBuildStore } from "./fakes.ts";
import type { FakeToolFabric } from "./fakes.ts";
import { asTenantId } from "./tenancy.ts";
import type { TenantId } from "./tenancy.ts";
import {
  contentDigestsOf,
  expectedManifestDigest,
  fixtureBuildRequest,
  fixtureConsoleBuildInputs,
  fixtureDigest,
  fixtureLock,
  fixtureOnTargetEvidence,
  fixturePackageRecord,
  fixtureRecords,
  fixtureVendorSdkEvidence,
  fixtureWebBuildInputs,
  stageDigestsFromEvents,
} from "./fixtures.ts";

const TENANT_A = asTenantId("tenant-a");
const TENANT_B = asTenantId("tenant-b");
const REQUESTER = asRequesterId("builder-agent");
const OPERATIONS = ["build", "test", "package"].map((operation) => asToolOperationId(operation));

interface Rig {
  readonly service: BuildOrchestratorService;
  readonly store: ReturnType<typeof createMemoryBuildStore>;
  readonly fabric: FakeToolFabric;
}

function rig(options: {
  records?: readonly ReturnType<typeof fixtureRecords>[number][];
  locks?: ReadonlyMap<ContentDigest, PackageLock>;
  content?: readonly ContentDigest[];
  operations?: readonly string[];
} = {}): Rig {
  const store = createMemoryBuildStore();
  const fabric = createFakeToolFabric({ operations: (options.operations ?? ["build", "test", "package"]).map((operation) => asToolOperationId(operation)) });
  const service = new BuildOrchestratorService({
    sources: createFakeBuildSource({
      records: options.records ?? fixtureRecords(),
      ...(options.locks === undefined ? {} : { locks: options.locks }),
      ...(options.content === undefined ? {} : { resolvableContent: new Set(options.content) }),
    }),
    fabric,
    clock: createManualClock().clock,
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

const nonceOf = (nonce: string) => ({ scope: "build-request" as const, requester: REQUESTER, nonce: asBuildNonce(nonce) });

async function driveAll(service: BuildOrchestratorService, tenant: TenantId, buildId: BuildId): Promise<DriveStepResult> {
  for (let index = 0; index < 10; index += 1) {
    const step = await service.drive(tenant, buildId);
    if (!step.ok) {
      throw new Error(`driveAll refused: ${step.code}`);
    }
    if (step.terminal) {
      return step;
    }
  }
  throw new Error("driveAll: no terminal phase within 10 arcs");
}

function admitted(service: BuildOrchestratorService, nonce: string, inputs: ReturnType<typeof fixtureWebBuildInputs>): BuildId {
  const intake = service.requestBuild(TENANT_A, fixtureBuildRequest(inputs, { idempotency: nonceOf(nonce) }));
  if (!intake.ok) {
    throw new Error(`fixture intake refused: ${intake.code}`);
  }
  return intake.buildId;
}

// ---------------------------------------------------------------------------
// 1. The happy path (web): the frozen phase machine, end to end
// ---------------------------------------------------------------------------

test("a web build walks the frozen phase machine to success", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const web = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(web.service, "happy-0001", inputs);
  const phases: string[] = [];
  let terminal = false;
  for (let index = 0; index < 10 && !terminal; index += 1) {
    const step = await web.service.drive(TENANT_A, buildId);
    assert.equal(step.ok, true);
    if (step.ok) {
      phases.push(step.phase);
      terminal = step.terminal;
    }
  }
  assert.deepEqual(phases, ["resolve", "plan", "emit", "verify", "succeeded"]);
  const status = web.service.status(TENANT_A, buildId);
  assert.equal(status.ok, true);
  if (status.ok) {
    assert.equal(status.phase, "succeeded");
    assert.equal(status.stepCount, 5);
    assert.equal(status.artifactCount, 2); // one emit bundle + one package bundle
    assert.notEqual(status.outputs, undefined);
    assert.notEqual(status.manifestDigest, undefined);
  }
});

test("the manifest digest matches the independently recomputed expectation (E9)", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const web = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(web.service, "manifest-0001", inputs);
  const final = await driveAll(web.service, TENANT_A, buildId);
  const log = web.service.events(TENANT_A, buildId);
  assert.equal(log.ok, true);
  if (log.ok) {
    const expected = expectedManifestDigest(buildId, inputs, stageDigestsFromEvents(log.events));
    assert.equal(final.manifestDigest, expected);
    const succeeded = log.events.find((event) => event.type === "build-succeeded");
    assert.notEqual(succeeded, undefined);
    assert.equal((succeeded?.detail as { manifestDigest: string } | undefined)?.manifestDigest, expected);
  }
});

test("the event log is append-only, authority-stamped and mirrored by the store (E10)", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const web = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(web.service, "events-0001", inputs);
  await driveAll(web.service, TENANT_A, buildId);
  const log = web.service.events(TENANT_A, buildId);
  assert.equal(log.ok, true);
  if (log.ok) {
    assert.ok(log.events.length > 0);
    for (const [index, event] of log.events.entries()) {
      assert.equal(event.sequence, index + 1);
      assert.equal(event.authority, "build-orchestrator");
      assert.equal(event.buildId, buildId);
    }
    // Every in-memory event is durably appended, in order, exactly once.
    assert.equal(web.store.appended.length, log.events.length);
    assert.deepEqual(web.store.loadEvents().map((event) => event.sequence), log.events.map((event) => event.sequence));
  }
});

// ---------------------------------------------------------------------------
// 2. Failure arcs: closure gate, toolchain gap, tool failure, malformed output
// ---------------------------------------------------------------------------

test("a declared (unverified) license fails the build at the R19 closure gate", async () => {
  const badRecords = [fixturePackageRecord("fixture-unlicensed-pack", { licenseStatus: "declared" }), ...fixtureRecords()];
  const badLock = fixtureLock(badRecords);
  const badInputs = fixtureWebBuildInputs(badLock);
  const gated = rig({ records: badRecords, locks: locksOf(badLock), content: contentDigestsOf(badInputs) });
  const buildId = admitted(gated.service, "gate-0001", badInputs);
  const failed = await driveAll(gated.service, TENANT_A, buildId);
  assert.equal(failed.phase, "failed");
  assert.equal(failed.failure?.code, "closure-provenance-gate-failed");
});

test("a tampered lock under a stale fingerprint fails closed (integrity)", async () => {
  const records = fixtureRecords();
  const honestLock = fixtureLock(records);
  const tamperedLock = fixtureLock([fixturePackageRecord("fixture-tamper-pack")]);
  const inputs = fixtureWebBuildInputs(honestLock);
  const web = rig({
    records: [...records, fixturePackageRecord("fixture-tamper-pack")],
    locks: new Map([[computeLockFingerprint(honestLock), tamperedLock]]),
    content: contentDigestsOf(inputs),
  });
  const buildId = admitted(web.service, "tamper-0001", inputs);
  const failed = await driveAll(web.service, TENANT_A, buildId);
  assert.equal(failed.failure?.code, "closure-lock-fingerprint-mismatch");
});

test("a missing toolchain operation fails truthfully with a recorded limitation (E11)", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock, { operations: ["build", "deploy", "package"] });
  const missing = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs), operations: ["build", "package"] });
  const buildId = admitted(missing.service, "missing-0001", inputs);
  const failed = await driveAll(missing.service, TENANT_A, buildId);
  assert.equal(failed.failure?.code, "toolchain-unavailable");
  const limitation = missing.service.limitations(TENANT_A).find((item) => item.code === "toolchain-unavailable");
  assert.notEqual(limitation, undefined);
  if (limitation !== undefined) {
    assert.equal(limitation.buildId, buildId);
    assert.equal(limitation.operation, "deploy");
  }
  // No tool step executed before the truthful refusal.
  assert.equal(missing.fabric.calls.length, 0);
  // The limitation is visible as a typed event, too.
  const log = missing.service.events(TENANT_A, buildId);
  assert.equal(log.ok && log.events.some((event) => event.type === "limitation-recorded"), true);
});

test("a failed tool step fails the build tool-step-failed", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const fault = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  fault.fabric.failOperation(asToolOperationId("test"), { code: "compiler-crash", message: "scripted fault" });
  const buildId = admitted(fault.service, "fault-0001", inputs);
  const failed = await driveAll(fault.service, TENANT_A, buildId);
  assert.equal(failed.failure?.code, "tool-step-failed");
  assert.match(failed.failure?.message ?? "", /compiler-crash/);
});

test("a malformed tool output fails the build tool-output-invalid", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const malformed = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(malformed.service, "malformed-0001", inputs);
  await malformed.service.drive(TENANT_A, buildId);
  await malformed.service.drive(TENANT_A, buildId);
  malformed.fabric.scriptNextOutput({ artifacts: [{ artifactKind: "game.bundle", digest: "not-a-digest", sizeBytes: 1, mediaType: "application/octet-stream" }] });
  const failed = await driveAll(malformed.service, TENANT_A, buildId);
  assert.equal(failed.failure?.code, "tool-output-invalid");
});

// ---------------------------------------------------------------------------
// 3. The console vendor-SDK gate (lock rule 24; authorization never fabricated)
// ---------------------------------------------------------------------------

test("a console build without vendor evidence fails vendor-evidence-required with a truthful limitation", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const consoleInputs = fixtureConsoleBuildInputs(lock);
  const consoleRig = rig({ locks: locksOf(lock), content: contentDigestsOf(consoleInputs) });
  const buildId = admitted(consoleRig.service, "console-0001", consoleInputs);
  const failed = await driveAll(consoleRig.service, TENANT_A, buildId);
  assert.equal(failed.failure?.code, "vendor-evidence-required");
  const limitation = consoleRig.service.limitations(TENANT_A).find((item) => item.code === "console-verification-out-of-band");
  assert.notEqual(limitation, undefined);
  // No tool step executed without the authorization.
  assert.equal(consoleRig.fabric.calls.length, 0);
});

test("a console build awaits missing on-target evidence retryably, then succeeds on the exact manifest", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const consoleInputs = fixtureConsoleBuildInputs(lock);
  const consoleRig = rig({ locks: locksOf(lock), content: contentDigestsOf(consoleInputs) });
  const buildId = admitted(consoleRig.service, "console-0002", consoleInputs);
  await consoleRig.service.drive(TENANT_A, buildId); // resolve
  await consoleRig.service.drive(TENANT_A, buildId); // plan
  // emit requires the vendor-SDK PASS record supplied out-of-band.
  const emitStep = await consoleRig.service.drive(TENANT_A, buildId, { vendorEvidence: [fixtureVendorSdkEvidence(consoleInputs)] });
  assert.equal(emitStep.ok && emitStep.phase, "emit");
  await consoleRig.service.drive(TENANT_A, buildId); // verify
  const logBeforePackage = consoleRig.service.events(TENANT_A, buildId);
  assert.equal(logBeforePackage.ok, true);
  const predicted = logBeforePackage.ok
    ? expectedManifestDigest(buildId, consoleInputs, stageDigestsFromEvents(logBeforePackage.events))
    : fixtureDigest("missing");
  // NO on-target evidence yet: an out-of-band WAIT, not a build defect —
  // the arc refuses retryably and names the digest the vendor must verify.
  const waiting = await consoleRig.service.drive(TENANT_A, buildId);
  assert.equal(waiting.ok, true);
  assert.equal(waiting.terminal, false);
  assert.equal(waiting.failure?.code, "vendor-evidence-required");
  assert.equal(waiting.manifestDigest, predicted);
  const stillLive = consoleRig.service.status(TENANT_A, buildId);
  assert.equal(stillLive.ok && stillLive.phase, "verify");
  // The exact predicted digest passes and the build succeeds.
  const final = await consoleRig.service.drive(TENANT_A, buildId, { vendorEvidence: [fixtureOnTargetEvidence(predicted)] });
  assert.equal(final.ok && final.phase, "succeeded");
  assert.equal(final.ok ? final.manifestDigest : undefined, predicted);
  const status = consoleRig.service.status(TENANT_A, buildId);
  if (status.ok && status.outputs) {
    const kinds = status.outputs.verification.map((record) => record.kind);
    assert.ok(kinds.includes("vendor-sdk"));
    assert.ok(kinds.includes("on-target"));
    assert.equal(computeBuildManifestDigest(status.outputs.manifest), predicted);
  }
});

test("an on-target record verifying a WRONG digest fails the gate terminally (fail-closed)", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const consoleInputs = fixtureConsoleBuildInputs(lock);
  const consoleRig = rig({ locks: locksOf(lock), content: contentDigestsOf(consoleInputs) });
  const buildId = admitted(consoleRig.service, "console-0003", consoleInputs);
  await consoleRig.service.drive(TENANT_A, buildId); // resolve
  await consoleRig.service.drive(TENANT_A, buildId); // plan
  await consoleRig.service.drive(TENANT_A, buildId, { vendorEvidence: [fixtureVendorSdkEvidence(consoleInputs)] }); // emit
  await consoleRig.service.drive(TENANT_A, buildId); // verify
  const logBeforePackage = consoleRig.service.events(TENANT_A, buildId);
  const predicted = logBeforePackage.ok
    ? expectedManifestDigest(buildId, consoleInputs, stageDigestsFromEvents(logBeforePackage.events))
    : fixtureDigest("missing");
  const stepsBeforePackage = logBeforePackage.ok ? logBeforePackage.events.filter((event) => event.type === "stage-completed").length : 0;
  // The vendor pipeline DID speak — and attested a different manifest.
  const wrong = await consoleRig.service.drive(TENANT_A, buildId, { vendorEvidence: [fixtureOnTargetEvidence(fixtureDigest("wrong-manifest"))] });
  assert.equal(wrong.ok, true);
  assert.equal(wrong.terminal, true);
  assert.equal(wrong.phase, "failed");
  assert.equal(wrong.failure?.code, "vendor-evidence-required");
  assert.match(wrong.failure?.message ?? "", /fail-closed/);
  assert.equal(wrong.manifestDigest, predicted);
  // Fail-closed means terminal: no re-drive, and no package step ever ran.
  const afterFailure = await consoleRig.service.drive(TENANT_A, buildId, { vendorEvidence: [fixtureOnTargetEvidence(predicted)] });
  assert.equal(afterFailure.ok, false);
  if (!afterFailure.ok) {
    assert.equal(afterFailure.code, "build-terminal");
  }
  const failedStatus = consoleRig.service.status(TENANT_A, buildId);
  assert.equal(failedStatus.ok && failedStatus.phase, "failed");
  const logAfter = consoleRig.service.events(TENANT_A, buildId);
  assert.equal(logAfter.ok ? logAfter.events.filter((event) => event.type === "stage-completed").length : -1, stepsBeforePackage);
  const limitation = consoleRig.service.limitations(TENANT_A).find((item) => item.code === "console-verification-out-of-band");
  assert.notEqual(limitation, undefined);
});

// ---------------------------------------------------------------------------
// 4. Cancellation and terminal discipline
// ---------------------------------------------------------------------------

test("a queued build is cancellable; terminal builds refuse further work", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const cancelRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(cancelRig.service, "cancel-0001", inputs);
  const cancelled = cancelRig.service.cancel(TENANT_A, {
    kind: "cancel-build",
    idempotency: { scope: "build-cancel", requester: REQUESTER, nonce: asBuildNonce("cancel-nonce-1") },
    buildId,
    requestedAt: 1,
  });
  assert.equal(cancelled.ok, true);
  if (cancelled.ok) {
    assert.equal(cancelled.phase, "cancelled");
  }
  const afterCancel = await cancelRig.service.drive(TENANT_A, buildId);
  assert.equal(afterCancel.ok, false);
  if (!afterCancel.ok) {
    assert.equal(afterCancel.code, "build-terminal");
  }
  const reCancel = cancelRig.service.cancel(TENANT_A, {
    kind: "cancel-build",
    idempotency: { scope: "build-cancel", requester: REQUESTER, nonce: asBuildNonce("cancel-nonce-2") },
    buildId,
    requestedAt: 2,
  });
  assert.equal(reCancel.ok, false);
  if (!reCancel.ok) {
    assert.equal(reCancel.code, "build-not-cancellable");
  }
  const log = cancelRig.service.events(TENANT_A, buildId);
  assert.equal(log.ok && log.events.some((event) => event.type === "build-cancelled"), true);
});

test("a malformed cancel command is refused invalid-command", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const cancelRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(cancelRig.service, "cancel-0002", inputs);
  const refused = cancelRig.service.cancel(TENANT_A, {
    kind: "cancel-build",
    idempotency: { scope: "build-request", requester: REQUESTER, nonce: asBuildNonce("bad-scope") },
    buildId,
    requestedAt: 1,
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "invalid-command");
  }
});

// ---------------------------------------------------------------------------
// 5. Tenant isolation (R20) and drive refusals
// ---------------------------------------------------------------------------

test("every command and read is tenant-scoped; cross-tenant access is typed refusal", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const web = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(web.service, "isolation-0001", inputs);
  await web.service.drive(TENANT_A, buildId);
  const crossRead = web.service.status(TENANT_B, buildId);
  assert.equal(crossRead.ok, false);
  if (!crossRead.ok) {
    assert.equal(crossRead.code, "wrong-tenant");
  }
  const crossDrive = await web.service.drive(TENANT_B, buildId);
  assert.equal(crossDrive.ok, false);
  if (!crossDrive.ok) {
    assert.equal(crossDrive.code, "wrong-tenant");
  }
  const crossCancel = web.service.cancel(TENANT_B, {
    kind: "cancel-build",
    idempotency: { scope: "build-cancel", requester: REQUESTER, nonce: asBuildNonce("cross-nonce") },
    buildId,
    requestedAt: 1,
  });
  assert.equal(crossCancel.ok, false);
  if (!crossCancel.ok) {
    assert.equal(crossCancel.code, "wrong-tenant");
  }
  const crossLog = web.service.events(TENANT_B, buildId);
  assert.equal(crossLog.ok, false);
  const invalidTenant = web.service.status("Not-A-Tenant" as TenantId, buildId);
  assert.equal(invalidTenant.ok, false);
  if (!invalidTenant.ok) {
    assert.equal(invalidTenant.code, "invalid-tenant");
  }
  // Limitations are tenant-scoped reads, too.
  assert.deepEqual(web.service.limitations(TENANT_B), []);
});

test("unknown builds, terminal builds and invalid evidence are typed drive refusals", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const web = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const unknown = await web.service.drive(TENANT_A, asBuildId("bld-never-recorded"));
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.code, "unknown-build");
  }
  const buildId = admitted(web.service, "refusals-0001", inputs);
  const invalidEvidence = await web.service.drive(TENANT_A, buildId, { vendorEvidence: [{} as never] });
  assert.equal(invalidEvidence.ok, false);
  if (!invalidEvidence.ok) {
    assert.equal(invalidEvidence.code, "invalid-evidence");
  }
  // A refusal changes no state: the build is still queued and drivable.
  const statusAfterRefusal = web.service.status(TENANT_A, buildId);
  assert.equal(statusAfterRefusal.ok && statusAfterRefusal.phase, "queued");
});

// ---------------------------------------------------------------------------
// 6. Snapshot / restore (E6)
// ---------------------------------------------------------------------------

test("a snapshot restores against an agreeing store and resumes to success", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const resumeRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(resumeRig.service, "resume-0001", inputs);
  await resumeRig.service.drive(TENANT_A, buildId);
  await resumeRig.service.drive(TENANT_A, buildId);
  const snapshot = resumeRig.service.snapshot();
  const restored = BuildOrchestratorService.restore(snapshot, {
    sources: createFakeBuildSource({ records, locks: locksOf(lock), resolvableContent: new Set(contentDigestsOf(inputs)) }),
    fabric: createFakeToolFabric({ operations: OPERATIONS }),
    clock: createManualClock(9_000).clock,
    store: resumeRig.store,
  });
  assert.equal(restored.ok, true);
  if (restored.ok) {
    const final = await driveAll(restored.service, TENANT_A, buildId);
    assert.equal(final.phase, "succeeded");
  }
});

test("a divergent store is torn state and is refused (E8)", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const resumeRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(resumeRig.service, "resume-0002", inputs);
  await resumeRig.service.drive(TENANT_A, buildId);
  const snapshot = resumeRig.service.snapshot();
  const divergent = BuildOrchestratorService.restore(snapshot, {
    sources: createFakeBuildSource({ records, locks: locksOf(lock), resolvableContent: new Set(contentDigestsOf(inputs)) }),
    fabric: createFakeToolFabric({ operations: OPERATIONS }),
    clock: createManualClock(9_000).clock,
    store: createMemoryBuildStore(),
  });
  assert.equal(divergent.ok, false);
  if (!divergent.ok) {
    assert.equal(divergent.code, "store-divergence");
  }
  void buildId;
});

test("a tampered snapshot fails its content address", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const resumeRig = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  admitted(resumeRig.service, "resume-0003", inputs);
  const snapshot = resumeRig.service.snapshot();
  // Tamper the payload but keep it VALID JSON, so the refusal provably
  // comes from the content-address check, not the parser.
  const parsed = JSON.parse(snapshot.document) as { revision: number };
  parsed.revision = 999;
  const tampered = { snapshotId: snapshot.snapshotId, revision: snapshot.revision, document: JSON.stringify(parsed) };
  const refused = BuildOrchestratorService.restore(tampered, {
    sources: createFakeBuildSource({ records, locks: locksOf(lock), resolvableContent: new Set(contentDigestsOf(inputs)) }),
    fabric: createFakeToolFabric({ operations: OPERATIONS }),
    clock: createManualClock(9_000).clock,
    store: resumeRig.store,
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "snapshot-digest-mismatch");
  }
});

// ---------------------------------------------------------------------------
// 7. Determinism (E9)
// ---------------------------------------------------------------------------

test("identical builds on identical rigs produce identical snapshots", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const a = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const b = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const idA = admitted(a.service, "twin-0001", inputs);
  const idB = admitted(b.service, "twin-0001", inputs);
  assert.equal(idA, idB);
  await driveAll(a.service, TENANT_A, idA);
  await driveAll(b.service, TENANT_A, idB);
  assert.equal(a.service.snapshot().snapshotId, b.service.snapshot().snapshotId);
});

// ---------------------------------------------------------------------------
// 8. The BuildExecutor view (recorded truth only)
// ---------------------------------------------------------------------------

test("the executor serves only recorded, succeeded truth", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const web = rig({ locks: locksOf(lock), content: contentDigestsOf(inputs) });
  const buildId = admitted(web.service, "executor-0001", inputs);
  const executor = web.service.asBuildExecutor();
  // Before success: typed refusal that names the current phase.
  const premature = executor.execute({ request: { request: fixtureBuildRequest(inputs, { idempotency: nonceOf("executor-0001") }), buildId } });
  assert.equal(premature.ok, false);
  if (!premature.ok) {
    assert.equal(premature.code, "invalid-command");
    assert.match(premature.message, /SUCCEEDED builds only/);
  }
  const final = await driveAll(web.service, TENANT_A, buildId);
  assert.equal(final.phase, "succeeded");
  const served = executor.execute({ request: { request: fixtureBuildRequest(inputs, { idempotency: nonceOf("executor-0001") }), buildId } });
  assert.equal(served.ok, true);
  // A different request payload under the same build id is refused.
  const wrongPayload = executor.execute({
    request: {
      request: fixtureBuildRequest(fixtureWebBuildInputs(lock, { over: { gameIrDigest: fixtureDigest("other-game-ir") } }), { idempotency: nonceOf("executor-0001") }),
      buildId,
    },
  });
  assert.equal(wrongPayload.ok, false);
  // An unknown build id is refused.
  const unknown = executor.execute({ request: { request: fixtureBuildRequest(inputs), buildId: asBuildId("bld-unknown") } });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.code, "invalid-command");
  }
});

test("a vendor-gate failure surfaces as vendor-evidence-required through the executor", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const consoleInputs = fixtureConsoleBuildInputs(lock);
  const consoleRig = rig({ locks: locksOf(lock), content: contentDigestsOf(consoleInputs) });
  const buildId = admitted(consoleRig.service, "executor-0002", consoleInputs);
  const failed = await driveAll(consoleRig.service, TENANT_A, buildId);
  assert.equal(failed.failure?.code, "vendor-evidence-required");
  const served = consoleRig.service.asBuildExecutor().execute({
    request: { request: fixtureBuildRequest(consoleInputs, { idempotency: nonceOf("executor-0002") }), buildId },
  });
  assert.equal(served.ok, false);
  if (!served.ok) {
    assert.equal(served.code, "vendor-evidence-required");
  }
});
