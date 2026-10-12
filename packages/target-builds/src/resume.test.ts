/**
 * Resume tests (E6): the durable fan-out plan keyed by content — completed
 * targets are SKIPPED on re-run, non-terminal targets are restored from their
 * content-addressed build documents and re-driven with the (possibly
 * strengthened) evidence pool; snapshot/restore roundtrips the full state.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/build-orchestrator";
import { asBuildNonce } from "@playliquid/build-contracts";
import { createServiceRig, fixtureMultiTargetRequest, fixtureOnTargetEvidence, fixtureProfileBundle, fixtureVendorSdkEvidence } from "./fixtures.ts";
import { MultiTargetBuildService } from "./service.ts";
import { verifyMultiTargetSnapshot } from "./snapshot.ts";
import type { MultiTargetBuildRecord } from "./record.ts";
import type { TargetOutcome } from "./outcomes.ts";

const tenantA = asTenantId("tenant-alpha");

test("a re-run of completed content skips every target (typed skip; idempotent by content key)", async () => {
  const rig = createServiceRig();
  const first = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web", "windows"] }));
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  const toolCallsAfterFirst = rig.fabric.calls.length;
  const rerun = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web", "windows"], nonce: asBuildNonce("mtb-nonce-0002") }));
  assert.equal(rerun.ok, true);
  if (!rerun.ok) {
    return;
  }
  assert.equal(rerun.classification, "resumed");
  assert.equal(rerun.record.verdict, "succeeded");
  assert.deepEqual(
    rerun.record.outcomes.map((outcome) => outcome.outcome),
    ["skipped", "skipped"],
  );
  // The skip reuses the FIRST run's build truth — no re-admission, no re-execution.
  for (let index = 0; index < rerun.record.outcomes.length; index += 1) {
    const outcome: TargetOutcome | undefined = rerun.record.outcomes[index];
    const priorOutcome: TargetOutcome | undefined = first.record.outcomes[index];
    if (outcome === undefined || priorOutcome === undefined) {
      continue;
    }
    assert.equal(outcome.outcome, "skipped");
    if (outcome.outcome === "skipped" && priorOutcome.outcome === "succeeded") {
      assert.equal(outcome.buildId, priorOutcome.buildId);
      assert.equal(outcome.documentDigest, priorOutcome.documentDigest);
      assert.equal(outcome.manifestDigest, priorOutcome.manifestDigest);
      assert.equal(outcome.resumedFromRecordId, first.record.recordId);
    }
  }
  assert.equal(rig.fabric.calls.length, toolCallsAfterFirst);
});

test("a re-run skips the completed target and drives only the awaiting one (partial resume, E6)", async () => {
  const rig = createServiceRig();
  rig.profiles.publish("web", fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } }));
  const first = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, { targets: ["web", "windows"], evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
  );
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  assert.equal(first.record.verdict, "partial");
  const webFirst = first.record.outcomes.find((outcome) => outcome.target === "web");
  assert.equal(webFirst?.outcome, "awaiting-evidence");
  if (webFirst?.outcome !== "awaiting-evidence") {
    return;
  }
  const callsAfterFirst = rig.fabric.calls.length;
  const rerun = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, {
      targets: ["web", "windows"],
      nonce: asBuildNonce("mtb-nonce-0002"),
      evidence: [fixtureVendorSdkEvidence("vendor-x"), fixtureOnTargetEvidence(webFirst.manifestDigest as string)],
    }),
  );
  assert.equal(rerun.ok, true);
  if (!rerun.ok) {
    return;
  }
  assert.equal(rerun.record.verdict, "succeeded");
  const outcomes = rerun.record.outcomes;
  assert.equal(outcomes.find((outcome) => outcome.target === "web")?.outcome, "succeeded");
  assert.equal(outcomes.find((outcome) => outcome.target === "windows")?.outcome, "skipped");
  // Only the awaiting target was re-driven (the completed one skipped).
  assert.ok(rig.fabric.calls.length > callsAfterFirst);
});

test("an awaiting-evidence target completes on re-run with the on-target record (lock rule 24)", async () => {
  const rig = createServiceRig();
  rig.profiles.publish("web", fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } }));
  const first = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, { targets: ["web", "windows"], evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
  );
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  assert.equal(first.record.verdict, "partial");
  const webFirst = first.record.outcomes.find((outcome) => outcome.target === "web");
  assert.equal(webFirst?.outcome, "awaiting-evidence");
  if (webFirst?.outcome !== "awaiting-evidence") {
    return;
  }
  assert.ok(webFirst.manifestDigest !== null);
  // The out-of-band vendor pipeline verifies exactly that manifest digest…
  const rerun = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, {
      targets: ["web", "windows"],
      nonce: asBuildNonce("mtb-nonce-0002"),
      evidence: [fixtureVendorSdkEvidence("vendor-x"), fixtureOnTargetEvidence(webFirst.manifestDigest)],
    }),
  );
  assert.equal(rerun.ok, true);
  if (!rerun.ok) {
    return;
  }
  assert.equal(rerun.classification, "resumed");
  assert.equal(rerun.record.verdict, "succeeded");
  const webRerun = rerun.record.outcomes.find((outcome) => outcome.target === "web");
  assert.equal(webRerun?.outcome, "succeeded");
  // The resumed build is THE SAME build (restored, not re-admitted).
  if (webRerun?.outcome === "succeeded") {
    assert.equal(webRerun.buildId, webFirst.buildId);
  }
  const verification = rerun.record.verification.find((entry) => entry.target === "web");
  assert.equal(verification?.verdict, "pass");
});

test("snapshot → restore roundtrips the full state and continues skipping (E6)", async () => {
  const rig = createServiceRig();
  const first = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock));
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  const snapshot = rig.service.snapshot();
  assert.equal(verifyMultiTargetSnapshot(snapshot).ok, true);
  const restored = MultiTargetBuildService.restore(snapshot, {
    catalog: rig.catalog,
    profiles: rig.profiles,
    sources: rig.sources,
    fabric: rig.fabric,
    clock: rig.clock,
    stores: rig.stores,
  });
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    return;
  }
  const toolCallsAfterFirst = rig.fabric.calls.length;
  const rerun = await restored.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { nonce: asBuildNonce("mtb-nonce-0002") }));
  assert.equal(rerun.ok, true);
  if (!rerun.ok) {
    return;
  }
  assert.equal(rerun.classification, "resumed");
  assert.deepEqual(
    rerun.record.outcomes.map((outcome) => outcome.outcome),
    ["skipped", "skipped"],
  );
  assert.equal(rig.fabric.calls.length, toolCallsAfterFirst);
  // The restored service also replays recorded encounters idempotently.
  const replay = await restored.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { nonce: asBuildNonce("mtb-nonce-0002") }));
  assert.equal(replay.ok, true);
  if (replay.ok) {
    assert.equal(replay.classification, "replay");
  }
});

test("a tampered service snapshot is refused restore (never healed, E8)", async () => {
  const rig = createServiceRig();
  const first = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock));
  assert.equal(first.ok, true);
  const snapshot = rig.service.snapshot();
  const parsed = JSON.parse(snapshot.document) as { revision: number };
  parsed.revision = 999;
  const tampered = { ...snapshot, document: JSON.stringify(parsed) };
  const restored = MultiTargetBuildService.restore(tampered, {
    catalog: rig.catalog,
    profiles: rig.profiles,
    sources: rig.sources,
    fabric: rig.fabric,
    clock: rig.clock,
    stores: rig.stores,
  });
  assert.equal(restored.ok, false);
  if (!restored.ok) {
    assert.equal(restored.code, "snapshot-digest-mismatch");
  }
});

test("an awaiting-evidence record carries the honest awaiting outcome (E11 truth)", async () => {
  const rig = createServiceRig();
  rig.profiles.publish("web", fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } }));
  const result = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, { targets: ["web"], evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const record: MultiTargetBuildRecord = result.record;
  assert.equal(record.verdict, "partial");
  const web = record.outcomes[0];
  assert.equal(web?.outcome, "awaiting-evidence");
  if (web?.outcome === "awaiting-evidence") {
    assert.ok(web.manifestDigest === null || web.manifestDigest.startsWith("sha256:"));
    assert.ok(typeof web.buildId === "string");
  }
  const verification = record.verification[0];
  assert.equal(verification?.verdict, "awaiting");
  assert.ok(record.provenance[0]?.stageDigests.length === 4);
});
