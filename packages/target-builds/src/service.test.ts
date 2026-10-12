/**
 * Multi-target build service tests (integration over the in-memory doubles):
 * the full execute door — admission, fan-out, aggregation, idempotent replay
 * and the tenant-scoped reads (R20).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/build-orchestrator";

import { documentDigestMapping, verifyMultiTargetRecord } from "./record.ts";
import { createServiceRig, fixtureMultiTargetRequest, fixturePackageRecord } from "./fixtures.ts";
import type { PackageRecord } from "@playliquid/package-system";

const tenantA = asTenantId("tenant-alpha");
const tenantB = asTenantId("tenant-beta");

function targetsOf(outcomes: readonly { target: string }[]): string[] {
  return outcomes.map((outcome) => outcome.target);
}

test("a multi-target request executes one staged build per bound target and aggregates one record", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["windows", "web"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.classification, "first");
  const record = result.record;
  assert.equal(record.kind, "multi-target-build-record");
  assert.equal(record.tenant, tenantA);
  assert.equal(record.verdict, "succeeded");
  assert.deepEqual(targetsOf(record.outcomes), ["web", "windows"]);
  assert.equal(record.outcomes[0]?.outcome, "succeeded");
  assert.equal(record.outcomes[0]?.engineId, "playcanvas");
  assert.equal(record.outcomes[1]?.engineId, "unreal");
  assert.ok(record.outcomes.every((outcome) => outcome.outcome === "succeeded" && typeof outcome.buildId === "string" && typeof outcome.manifestDigest === "string"));
  // The record's own content address verifies (tamper-evident, E8).
  assert.equal(verifyMultiTargetRecord(record), true);
  // The fan-out's target → document digest mapping is total.
  const mapping = documentDigestMapping(record);
  assert.deepEqual(Object.keys(mapping).sort(), ["web", "windows"]);
  const webMapping = mapping.web ?? null;
  assert.ok(webMapping !== null && webMapping.startsWith("sha256:"));
});

test("each per-target staged build produced R19 provenance and verification evidence", async () => {
  const rig = createServiceRig();
  const request = fixtureMultiTargetRequest(rig.lock);
  const result = await rig.service.execute(tenantA, request);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const { record } = result;
  assert.equal(record.provenance.length, 2);
  assert.equal(record.verification.length, 2);
  for (const provenance of record.provenance) {
    assert.ok(provenance.provenanceDigest.startsWith("sha256:"));
    assert.equal(provenance.sourcePins.gameIr, request.pins.gameIr);
    assert.equal(provenance.sourcePins.packageLock, request.pins.packageLock.lockFingerprint);
    assert.equal(provenance.sourcePins.toolchain, request.pins.toolchain.profileDigest);
    assert.deepEqual(provenance.stageDigests.map((stage) => stage.stage), ["resolve", "plan", "emit", "verify", "package"]);
  }
  for (const verification of record.verification) {
    assert.ok(verification.verificationDigest.startsWith("sha256:"));
    assert.equal(verification.verdict, "pass");
    assert.ok(verification.gateResults.some((gate) => gate.kind === "evaluation-suite"));
  }
});

test("replaying the same encounter returns the recorded record (idempotent, E6)", async () => {
  const rig = createServiceRig();
  const request = fixtureMultiTargetRequest(rig.lock);
  const first = await rig.service.execute(tenantA, request);
  const replay = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock));
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  if (!first.ok || !replay.ok) {
    return;
  }
  assert.equal(replay.classification, "replay");
  assert.equal(replay.record.recordId, first.record.recordId);
  assert.equal(replay.record.recordDigest, first.record.recordDigest);
});

test("reusing the idempotency key with different content is a typed collision refusal (E8)", async () => {
  const rig = createServiceRig();
  const first = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock));
  assert.equal(first.ok, true);
  const collision = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web", "macos"] }));
  assert.equal(collision.ok, false);
  if (collision.ok) {
    return;
  }
  assert.equal(collision.code, "idempotency-collision");
  assert.ok(collision.message.includes("never silently executed twice"));
});

test("an invalid tenant or structurally invalid request is refused at the door (E1)", async () => {
  const rig = createServiceRig();
  const invalidTenant = await rig.service.execute("Not-A-Tenant" as never, fixtureMultiTargetRequest(rig.lock));
  assert.equal(invalidTenant.ok, false);
  if (!invalidTenant.ok) {
    assert.equal(invalidTenant.code, "invalid-tenant");
  }
  const invalidRequest = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: [] }));
  assert.equal(invalidRequest.ok, false);
  if (!invalidRequest.ok) {
    assert.equal(invalidRequest.code, "invalid-request");
    assert.deepEqual(
      invalidRequest.reasons?.map((reason) => reason.code),
      ["invalid-targets"],
    );
  }
  const hostile = await rig.service.execute(tenantA, null as never);
  assert.equal(hostile.ok, false);
});

test("the tenant-scoped reads serve records, plans and durable outcomes (R20)", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const { record } = result;
  const read = rig.service.recordOf(tenantA, record.recordId);
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.equal(read.record.recordId, record.recordId);
  }
  const planRead = rig.service.planOf(tenantA, record.planId);
  assert.equal(planRead.ok, true);
  if (planRead.ok) {
    assert.equal(planRead.plan.planId, record.planId);
    assert.deepEqual(
      planRead.plan.entries.map((entry) => entry.target),
      ["web", "windows"],
    );
  }
  const outcomes = rig.service.durableOutcomesOf(tenantA, record.planId);
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((outcome) => outcome.planKey.startsWith(`${record.planId}|`)));
  // Unknown ids and foreign tenants are typed refusals, never leaks.
  assert.equal(rig.service.recordOf(tenantA, "mtb-unknown").ok, false);
  assert.equal(rig.service.recordOf(tenantB, record.recordId).ok, false);
  if (!rig.service.recordOf(tenantB, record.recordId).ok) {
    const refusal = rig.service.recordOf(tenantB, record.recordId);
    assert.ok(!refusal.ok && refusal.code === "wrong-tenant");
  }
  assert.equal(rig.service.planOf(tenantB, record.planId).ok, false);
  assert.equal(rig.service.planOf(tenantA, "sha256:" + "0".repeat(64)).ok, false);
  assert.deepEqual(rig.service.durableOutcomesOf(tenantB, record.planId), []);
});

test("an R19-closed package closure fails every per-target build honestly (never silent completion)", async () => {
  const unlicensed: PackageRecord = fixturePackageRecord("fixture-unlicensed-pack", { licenseStatus: "declared" });
  const rig = createServiceRig({ records: [unlicensed, ...defaultRecords()] });
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "failed");
  const outcome = result.record.outcomes[0];
  assert.equal(outcome?.outcome, "failed");
  if (outcome?.outcome === "failed") {
    assert.equal(outcome.failure.code, "closure-provenance-gate-failed");
  }
  const verification = result.record.verification[0];
  assert.equal(verification?.verdict, "fail");
  assert.equal(verification?.failure?.code, "closure-provenance-gate-failed");
});

function defaultRecords(): readonly PackageRecord[] {
  return [fixturePackageRecord("fixture-assets-pack"), fixturePackageRecord("fixture-logic-pack")];
}

test("a missing toolchain operation fails the per-target build with a truthful E11 limitation", async () => {
  const rig = createServiceRig({ operations: ["build", "package"] });
  const request = fixtureMultiTargetRequest(rig.lock, { targets: ["web"] });
  const result = await rig.service.execute(tenantA, request);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "failed");
  const outcome = result.record.outcomes[0];
  if (outcome?.outcome === "failed") {
    assert.equal(outcome.failure.code, "toolchain-unavailable");
  }
});
