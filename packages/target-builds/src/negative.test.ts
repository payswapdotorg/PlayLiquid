/**
 * Negative tests (E8): typed refusals and honest failures at every layer —
 * unknown targets, the console SDK gate (lock rule 24), capability gaps,
 * tampered pins/seals/digests, per-target failure isolation and the R20
 * tenant boundary. No path silently completes or throws.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, createMemoryBuildStore } from "@playliquid/build-orchestrator";
import { asBuildNonce } from "@playliquid/build-contracts";
import { createServiceRig, fixtureMultiTargetRequest, fixtureProfileBundle, fixtureVendorSdkEvidence, fixtureDigest } from "./fixtures.ts";
import { verifyMultiTargetRecord } from "./record.ts";
import { MultiTargetBuildService } from "./service.ts";
import type { FanoutStorePort } from "./ports.ts";
import type { TargetId } from "@playliquid/target-profiles";

const tenantA = asTenantId("tenant-alpha");
const tenantB = asTenantId("tenant-beta");

test("an unknown target is refused while the known targets still complete (isolation, E8)", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["television", "web"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "partial");
  assert.deepEqual(
    result.record.refusals.map((refusal) => [refusal.target, refusal.code]),
    [["television", "unknown-target"]],
  );
  assert.deepEqual(
    result.record.outcomes.map((outcome) => outcome.target),
    ["web"],
  );
  assert.equal(result.record.outcomes[0]?.outcome, "succeeded");
});

test("a console-only request is refused wholly and truthfully (lock rule 24 / E11)", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["console"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "refused");
  assert.deepEqual(result.record.outcomes, []);
  const refusal = result.record.refusals[0];
  assert.equal(refusal?.code, "sdk-gated");
  assert.ok(refusal.message.includes("never simulates"));
});

test("a console target does not void the web target's completed build (isolation)", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["console", "web"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "partial");
  assert.equal(result.record.outcomes[0]?.outcome, "succeeded");
  assert.equal(result.record.refusals.find((refusal) => refusal.target === "console")?.code, "sdk-gated");
});

test("console vendor-SDK evidence in the pool does NOT ungate the console target (authorization is out-of-band)", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, { targets: ["console"], evidence: [fixtureVendorSdkEvidence("nintendo")] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "refused");
  assert.equal(result.record.refusals[0]?.code, "sdk-gated");
  assert.ok(result.record.refusals[0]?.message.includes("cannot substitute"));
});

test("a target no merged adapter declares is refused no-engine-for-target (E11 truthful gap)", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["steamdeck", "xr", "dedicated-server", "web"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "partial");
  assert.deepEqual(
    result.record.refusals.map((refusal) => [refusal.target, refusal.code]),
    [
      ["dedicated-server", "no-engine-for-target"],
      ["steamdeck", "no-engine-for-target"],
      ["xr", "no-engine-for-target"],
    ],
  );
});

test("a tampered profile seal refuses exactly that target (E8 tamper + isolation)", async () => {
  const rig = createServiceRig();
  const sealed = fixtureProfileBundle("macos");
  rig.profiles.publish("macos", { ...sealed, record: { ...sealed.record, version: "9.9.9" } });
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["macos", "web"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "partial");
  assert.deepEqual(
    result.record.refusals.map((refusal) => [refusal.target, refusal.code]),
    [["macos", "profile-invalid"]],
  );
  assert.equal(result.record.outcomes[0]?.outcome, "succeeded");
});

test("an unpublishable (unresolvable) profile pin refuses the target at intake, isolating the others", async () => {
  const rig = createServiceRig();
  // Republish macos under a NEW digest the build source never saw: intake
  // must refuse it as an unresolvable input while web completes untouched.
  rig.profiles.publish("macos", fixtureProfileBundle("macos", { version: "2.0.0" }));
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["macos", "web"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "partial");
  const macos = result.record.outcomes.find((outcome) => outcome.target === "macos");
  assert.equal(macos?.outcome, "failed");
  if (macos?.outcome === "failed") {
    assert.equal(macos.failure.code, "intake-unresolvable-input");
    assert.equal(macos.buildId, null);
    assert.equal(macos.documentDigest, null);
  }
  assert.equal(result.record.outcomes.find((outcome) => outcome.target === "web")?.outcome, "succeeded");
});

test("a tampered game-ir pin fails every bound target at intake (fail closed, E8)", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, {
      targets: ["web", "windows"],
      gameIrDigest: fixtureDigest("never-published-anywhere"),
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.record.verdict, "failed");
  for (const outcome of result.record.outcomes) {
    assert.equal(outcome.outcome, "failed");
    if (outcome.outcome === "failed") {
      assert.equal(outcome.failure.code, "intake-unresolvable-input");
    }
  }
});

test("a tampered record digest never verifies (E8 tamper detection)", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(verifyMultiTargetRecord(result.record), true);
  const tampered = { ...result.record, verdict: "failed" as const };
  assert.equal(verifyMultiTargetRecord(tampered), false);
  const tamperedOutcome = { ...result.record, outcomes: [] };
  assert.equal(verifyMultiTargetRecord(tamperedOutcome), false);
});

test("cross-tenant access is a typed refusal on every door (R20; negative-tested)", async () => {
  const rig = createServiceRig();
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const recordRead = rig.service.recordOf(tenantB, result.record.recordId);
  assert.ok(!recordRead.ok && recordRead.code === "wrong-tenant");
  const planRead = rig.service.planOf(tenantB, result.record.planId);
  assert.ok(!planRead.ok && planRead.code === "wrong-tenant");
  assert.deepEqual(rig.service.durableOutcomesOf(tenantB, result.record.planId), []);
  // Each tenant's state is fully isolated: tenant B executes its own builds.
  const own = await rig.service.execute(tenantB, fixtureMultiTargetRequest(rig.lock, { nonce: asBuildNonce("tenant-b-nonce") }));
  assert.equal(own.ok, true);
  if (own.ok) {
    assert.equal(own.record.tenant, tenantB);
    assert.notEqual(own.record.recordId, result.record.recordId);
  }
});

test("a torn per-target event store is an honest typed failure, never a silent heal (E8/E6)", async () => {
  const rig = createServiceRig();
  const denied: string[] = [];
  const stores: FanoutStorePort = { open: (key) => (denied.includes(key) ? createMemoryBuildStore() : rig.stores.open(key)) };
  // One gated target stalls awaiting out-of-band evidence under the real store…
  rig.profiles.publish("web", fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } }));
  const first = await rig.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, { targets: ["web", "windows"], evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
  );
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  assert.equal(first.record.outcomes.find((outcome) => outcome.target === "web")?.outcome, "awaiting-evidence");
  // …then the host store "loses" that target's events: the resuming run
  // must report the restore refusal instead of re-executing behind it.
  const webOutcome = rig.service.durableOutcomesOf(tenantA, first.record.planId).find((outcome) => outcome.target === "web");
  assert.ok(webOutcome !== undefined);
  denied.push(webOutcome.storeKey);
  const restored = MultiTargetBuildService.restore(rig.service.snapshot(), {
    catalog: rig.catalog,
    profiles: rig.profiles,
    sources: rig.sources,
    fabric: rig.fabric,
    clock: rig.clock,
    stores,
  });
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    return;
  }
  const rerun = await restored.service.execute(
    tenantA,
    fixtureMultiTargetRequest(rig.lock, { targets: ["web", "windows"], nonce: asBuildNonce("mtb-nonce-0002"), evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
  );
  assert.equal(rerun.ok, true);
  if (!rerun.ok) {
    return;
  }
  const web = rerun.record.outcomes.find((outcome) => outcome.target === "web");
  assert.equal(web?.outcome, "failed");
  if (web?.outcome === "failed") {
    assert.equal(web.failure.code, "restore-refused:store-divergence");
  }
  assert.equal(rerun.record.outcomes.find((outcome) => outcome.target === "windows")?.outcome, "skipped");
  assert.equal(rerun.record.verdict, "partial");
});

test("an evidence-gated target without any vendor evidence is refused evidence-missing at resolution", async () => {
  const rig = createServiceRig();
  rig.profiles.publish("web", fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } }));
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web", "windows"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(
    result.record.refusals.map((refusal) => [refusal.target, refusal.code]),
    [["web", "evidence-missing"]],
  );
  assert.equal(result.record.outcomes.find((outcome) => outcome.target === "windows")?.outcome, "succeeded");
});

test("an unpublished profile target is refused profile-unavailable at resolution", async () => {
  const rig = createServiceRig({ targets: ["web", "windows"] as TargetId[] });
  const result = await rig.service.execute(tenantA, fixtureMultiTargetRequest(rig.lock, { targets: ["web", "linux"] }));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(
    result.record.refusals.map((refusal) => [refusal.target, refusal.code]),
    [["linux", "profile-unavailable"]],
  );
});
