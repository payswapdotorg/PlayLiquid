/**
 * Service tests: the golden journey, tenant isolation (R20), run-once
 * receipts (E10), post-admission evidence tampering (E8), calibration
 * through the service, and persistence round-trips (E6).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { asEvaluationSeed, asTimestampMs } from "@playliquid/lab-contracts";
import { LabSimulationService } from "./service.ts";
import {
  createLabSimulationFakes,
  labFixtureContext,
  labFixtureDigest,
  labFixtureEvidenceRecords,
  labFixtureObservation,
  labFixtureSuite,
  labFixtureTeamOrganization,
} from "./fakes.ts";
import { evidenceBundleDigestOf } from "./digest.ts";
import type { LabEvaluationRequest } from "./records.ts";

const tenant = asTenantId("tenant-service")!;
const owner = asSubjectId("subject-lab-owner")!;
const otherTenant = asTenantId("tenant-other")!;
const stranger = asSubjectId("subject-stranger")!;
const evidence = labFixtureEvidenceRecords();

function service() {
  const fakes = createLabSimulationFakes();
  return { fakes, service: new LabSimulationService({ ports: fakes.ports }) };
}

function request(over: Partial<LabEvaluationRequest> = {}): LabEvaluationRequest {
  return {
    tenant,
    owner,
    cycleId: evidence[0]!.cycleId,
    organization: labFixtureTeamOrganization(),
    evidence: {
      recordIds: evidence.map((record) => String(record.evidenceId)),
      declaredDigest: evidenceBundleDigestOf(evidence),
    },
    suite: labFixtureSuite().ref,
    context: labFixtureContext(),
    parameters: { seed: asEvaluationSeed("seed-service")!, tickBudget: 10 },
    requestedAt: asTimestampMs(1_000)!,
    ...over,
  };
}

test("golden journey: admit → run → read → calibrate", () => {
  const { fakes, service: lab } = service();
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const evaluationId = admitted.record.evaluationId;

  const run = lab.runEvaluation({ evaluationId, as: { tenant, subject: owner } });
  assert.ok(run.ok, run.ok ? "" : `${run.code}: ${run.detail}`);
  assert.equal(run.run.result.epistemic, "labeled-estimate");

  const read = lab.getEvaluation(evaluationId, { tenant, subject: owner });
  assert.ok(read.ok);
  assert.equal(read.stored.run, run.run);
  assert.ok(read.stored.evaluation !== undefined);
  assert.equal(String(read.stored.evaluation.evaluationId), String(evaluationId));

  const observation = labFixtureObservation("observation-service-1");
  fakes.observations.appendObservation(observation);
  const calibration = lab.calibrate({ evaluationId, as: { tenant, subject: owner }, observedOutcomeIds: [String(observation.observationId)] });
  assert.ok(calibration.ok, calibration.ok ? "" : `${calibration.code}: ${calibration.detail}`);
  const appended = fakes.observations.appendConclusion(calibration.conclusion);
  assert.equal(appended.ok, true);
});

test("cross-tenant run, read and calibrate are refused (R20)", () => {
  const { service: lab } = service();
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const evaluationId = admitted.record.evaluationId;
  const cross = { tenant: otherTenant, subject: stranger };

  const run = lab.runEvaluation({ evaluationId, as: cross });
  assert.ok(!run.ok);
  assert.equal(run.code, "cross-tenant");

  const read = lab.getEvaluation(evaluationId, cross);
  assert.ok(!read.ok);
  assert.equal(read.code, "cross-tenant");
  assert.ok(read.detail.includes("(R20)"));

  const calibrate = lab.calibrate({ evaluationId, as: cross, observedOutcomeIds: ["observation-x"] });
  assert.ok(!calibrate.ok);
  assert.equal(calibrate.code, "cross-tenant");

  const listing = lab.listEvaluations(cross);
  assert.equal(listing.length, 0);
});

test("second run returns the recorded receipt, never a second run (E10)", () => {
  const { service: lab } = service();
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const evaluationId = admitted.record.evaluationId;

  const first = lab.runEvaluation({ evaluationId, as: { tenant, subject: owner } });
  assert.ok(first.ok);
  const second = lab.runEvaluation({ evaluationId, as: { tenant, subject: owner } });
  assert.ok(!second.ok);
  assert.equal(second.code, "evaluation-already-run");
  assert.equal(second.recorded, first.run);
});

test("duplicate admission returns the first intake record (E10)", () => {
  const { service: lab } = service();
  const first = lab.admitEvaluation(request());
  assert.ok(first.ok);
  const duplicate = lab.admitEvaluation(request());
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.code, "duplicate-evaluation");
  assert.equal(duplicate.recorded, first.record);
  const listing = lab.listEvaluations({ tenant, subject: owner });
  assert.equal(listing.length, 1);
});

test("evidence mutated after admission refuses the run (E8)", () => {
  const fakes = createLabSimulationFakes();
  let current: (recordId: string) => ReturnType<typeof fakes.evidence.view> = fakes.evidence.view;
  const lab = new LabSimulationService({ ports: { ...fakes.ports, evidence: (recordId: string) => current(recordId) } });
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const evaluationId = admitted.record.evaluationId;

  // The host ledger "changes" behind the read view after admission —
  // the same record id now resolves to different CONTENT (the ledger
  // identity stays, the bytes do not).
  const original = fakes.evidence.list()[0]!;
  const tampered = { ...original, summary: "tampered after admission", contentDigest: labFixtureDigest("tampered") };
  current = (recordId) => (recordId === String(original.evidenceId) ? tampered : fakes.evidence.view(recordId));

  const run = lab.runEvaluation({ evaluationId, as: { tenant, subject: owner } });
  assert.ok(!run.ok);
  assert.equal(run.code, "evidence-digest-mismatch");
});

test("unknown evaluation ids are refused on run, read and calibrate", () => {
  const { service: lab } = service();
  const missing = "lab-eval-missing" as Parameters<typeof lab.runEvaluation>[0]["evaluationId"];
  const run = lab.runEvaluation({ evaluationId: missing, as: { tenant, subject: owner } });
  assert.ok(!run.ok);
  assert.equal(run.code, "intake-unknown");
  const read = lab.getEvaluation(missing, { tenant, subject: owner });
  assert.ok(!read.ok);
  assert.equal(read.code, "intake-unknown");
  const calibrate = lab.calibrate({ evaluationId: missing, as: { tenant, subject: owner }, observedOutcomeIds: [] });
  assert.ok(!calibrate.ok);
  assert.equal(calibrate.code, "intake-unknown");
});

test("calibrating an unrun evaluation is refused", () => {
  const { service: lab } = service();
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const calibration = lab.calibrate({
    evaluationId: admitted.record.evaluationId,
    as: { tenant, subject: owner },
    observedOutcomeIds: ["observation-x"],
  });
  assert.ok(!calibration.ok);
  assert.equal(calibration.code, "run-missing");
});

test("persistence: every mutation snapshots; restore round-trips (E6)", () => {
  const { fakes, service: lab } = service();
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const documentsAfterAdmission = fakes.store.documents().length;
  const run = lab.runEvaluation({ evaluationId: admitted.record.evaluationId, as: { tenant, subject: owner } });
  assert.ok(run.ok);
  assert.ok(fakes.store.documents().length > documentsAfterAdmission);

  const restored = new LabSimulationService({ ports: fakes.ports });
  const result = restored.restore();
  assert.ok(result.ok);
  assert.equal(result.count, 1);
  const read = restored.getEvaluation(admitted.record.evaluationId, { tenant, subject: owner });
  assert.ok(read.ok);
  assert.equal(read.stored.run, run.run);
  const rerun = restored.runEvaluation({ evaluationId: admitted.record.evaluationId, as: { tenant, subject: owner } });
  assert.ok(!rerun.ok);
  assert.equal(rerun.code, "evaluation-already-run");
});

test("documents are content-addressed: identical states produce identical digests", () => {
  const first = service();
  const second = service();
  first.service.admitEvaluation(request());
  second.service.admitEvaluation(request());
  assert.equal(first.service.document().stateDigest, second.service.document().stateDigest);
});
