/**
 * THE DEPLOYMENT VERIFIER TESTS (PL-044) — the positive walkthrough and
 * the E9 determinism evidence. The E8 negative rows live in
 * negative.test.ts; the committed-manifest evidence in manifest.test.ts;
 * the append-only journal in journal.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createFixedClock } from "../../services/ops/src/index.ts";
import { createCorpusDoors, honestTopologyPlan, DEPLOYMENT_TENANT } from "./corpus.ts";
import { mintDeploymentSeal, verifyDeploymentPlan, verifyDeploymentSeal } from "./verifier.ts";
import { deploymentPlanDigest } from "./model.ts";
import { DeploymentJournalService } from "./journal.ts";
import { DEPLOYMENT_VERIFIER_ID } from "./ports.ts";
import { isSealDigestHex } from "./digest.ts";

test("the honest topology verifies through the REAL doors: registry + CAS + release gate + profiles + lattice", () => {
  const doors = createCorpusDoors();
  const verification = verifyDeploymentPlan(honestTopologyPlan(), { doors, clock: createFixedClock(10_000) });
  assert.ok(verification.ok, verification.ok ? "" : `${verification.code}: ${verification.detail}`);
  assert.equal(verification.seal.units, 7);
  assert.equal(verification.seal.verifier, DEPLOYMENT_VERIFIER_ID);
  assert.ok(isSealDigestHex(verification.seal.sealDigest));
  assert.equal(verification.seal.planDigest, deploymentPlanDigest(honestTopologyPlan()));
});

test("E9 determinism: verifying the same plan twice (fresh doors, same clock) yields the IDENTICAL seal", () => {
  const first = verifyDeploymentPlan(honestTopologyPlan(), { doors: createCorpusDoors(), clock: createFixedClock(10_000) });
  const second = verifyDeploymentPlan(honestTopologyPlan(), { doors: createCorpusDoors(), clock: createFixedClock(10_000) });
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.seal, second.seal);
  // The corpus itself is deterministic: the same seals regenerate over
  // independently constructed doors (E9, run-twice evidence).
  assert.equal(first.seal.sealDigest, second.seal.sealDigest);
});

test("E9 determinism: the seal is a pure function of plan content + instant (a later instant seals differently)", () => {
  const early = verifyDeploymentPlan(honestTopologyPlan(), { doors: createCorpusDoors(), clock: createFixedClock(10_000) });
  const late = verifyDeploymentPlan(honestTopologyPlan(), { doors: createCorpusDoors(), clock: createFixedClock(20_000) });
  assert.ok(early.ok && late.ok);
  assert.notEqual(early.seal.sealDigest, late.seal.sealDigest);
  assert.equal(early.seal.planDigest, late.seal.planDigest);
  assert.equal(late.seal.verifiedAt, 20_000);
});

test("the seal recomputes: verifyDeploymentSeal accepts the minted seal and refuses a transplanted one", () => {
  const plan = honestTopologyPlan();
  const seal = mintDeploymentSeal(plan, createFixedClock(10_000));
  assert.deepEqual(verifyDeploymentSeal(seal, plan), { ok: true });
  const otherPlan = { ...plan, planId: "plan-not-this-one" };
  const transplant = verifyDeploymentSeal(seal, otherPlan);
  assert.ok(!transplant.ok);
  assert.equal(transplant.code, "seal-mismatch");
  const forged = verifyDeploymentSeal({ ...seal, verifiedAt: seal.verifiedAt + 1 }, plan);
  assert.ok(!forged.ok);
  assert.equal(forged.code, "seal-mismatch");
});

test("the verified plan records into the journal (E10) and re-recording the same seal is an idempotent duplicate", () => {
  const doors = createCorpusDoors();
  const clock = createFixedClock(10_000);
  const verification = verifyDeploymentPlan(honestTopologyPlan(), { doors, clock });
  assert.ok(verification.ok);
  const journal = new DeploymentJournalService(clock);
  const first = journal.record(verification.seal, honestTopologyPlan());
  assert.ok(first.ok && !first.duplicate);
  const again = journal.record(verification.seal, honestTopologyPlan());
  assert.ok(again.ok && again.duplicate);
  assert.equal(journal.entries().length, 1);
  assert.ok(journal.verify().ok);
});

test("the honest topology's units are tenant-scoped to the plan tenant (R20) and cover every ops health door", () => {
  const plan = honestTopologyPlan();
  for (const unit of plan.units) {
    assert.equal(unit.tenant, DEPLOYMENT_TENANT);
    assert.ok(unit.healthGates.length > 0);
    for (const grant of unit.rightsScope) {
      assert.equal(grant.tenant, unit.tenant);
    }
  }
  const doors = new Set(plan.units.flatMap((unit) => [...unit.healthGates]));
  assert.deepEqual([...doors].sort(), [
    "artifact-cas",
    "build-orchestrator",
    "ops-worker-journal",
    "package-registry",
    "platform-economy",
    "platform-integrity",
    "rights-authority",
    "web-host-composition",
  ]);
});
