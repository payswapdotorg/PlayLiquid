/**
 * THE E8 NEGATIVE BATTERY (PL-028) — every typed refusal, one file:
 *
 * 1. cross-tenant access is refused on every door (R20);
 * 2. tampered evidence digests are refused at admission AND at run time;
 * 3. duplicate evaluation admission returns the first receipt (E10);
 * 4. re-running an evaluation returns the recorded run (E10);
 * 5. calibration is append-only on immutable observations (E10, lock 27);
 * 6. estimate-label stripping is refused at the type boundary AND at
 *    the runtime guard (E11, lock 28/29);
 * 7. unmodeled suite metrics are honestly refused (E11);
 * 8. the canonical lab-contracts record refuses unlabeled results.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { LabeledEstimate, ObservedEvidence } from "@playliquid/lab-contracts";
import { recordCandidateEvaluation, asEvaluationSeed, asTimestampMs } from "@playliquid/lab-contracts";
import { LabSimulationService } from "./service.ts";
import { calibrateLabEvaluation } from "./calibration.ts";
import type { LabEvaluationSuite, ObservedOutcomeRecord } from "@playliquid/lab-contracts";
import {
  createLabSimulationFakes,
  createObservationLedger,
  labFixtureContext,
  labFixtureDigest,
  labFixtureEvidenceRecords,
  labFixtureForeignMetricSuite,
  labFixtureObservation,
  labFixtureSuite,
  labFixtureTeamOrganization,
} from "./fakes.ts";
import { evidenceBundleDigestOf } from "./digest.ts";
import { asLabEstimateResult } from "./records.ts";
import type { LabEvaluationRequest } from "./records.ts";

const tenant = asTenantId("tenant-negative")!;
const owner = asSubjectId("subject-negative-owner")!;
const otherTenant = asTenantId("tenant-negative-other")!;
const stranger = asSubjectId("subject-negative-stranger")!;
const evidence = labFixtureEvidenceRecords();

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
    parameters: { seed: asEvaluationSeed("seed-negative")!, tickBudget: 10 },
    requestedAt: asTimestampMs(1_000)!,
    ...over,
  };
}

test("negative: cross-tenant access is refused on every door (R20)", () => {
  const { service: lab } = createLabService();
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const evaluationId = admitted.record.evaluationId;
  const run = lab.runEvaluation({ evaluationId, as: { tenant, subject: owner } });
  assert.ok(run.ok);
  const cross = { tenant: otherTenant, subject: stranger };

  assert.equal(lab.getEvaluation(evaluationId, cross).ok, false);
  const crossRun = lab.runEvaluation({ evaluationId, as: cross });
  assert.ok(!crossRun.ok && crossRun.code === "cross-tenant");
  assert.ok(crossRun.detail.includes("R20"));
  const crossCalibrate = lab.calibrate({ evaluationId, as: cross, observedOutcomeIds: [] });
  assert.ok(!crossCalibrate.ok && crossCalibrate.code === "cross-tenant");
  assert.equal(lab.listEvaluations(cross).length, 0);
});

test("negative: a tampered declared digest is refused at admission (E8)", () => {
  const { service: lab } = createLabService();
  const result = lab.admitEvaluation(
    request({ evidence: { recordIds: evidence.map((record) => String(record.evidenceId)), declaredDigest: labFixtureDigest("tampered") } }),
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "evidence-digest-mismatch");
});

test("negative: duplicate admission is refused with the first receipt (E10)", () => {
  const { service: lab } = createLabService();
  const first = lab.admitEvaluation(request());
  assert.ok(first.ok);
  const duplicate = lab.admitEvaluation(request());
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.code, "duplicate-evaluation");
  assert.equal(duplicate.recorded, first.record);
});

test("negative: re-running an evaluation is refused with the recorded run (E10)", () => {
  const { service: lab } = createLabService();
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const first = lab.runEvaluation({ evaluationId: admitted.record.evaluationId, as: { tenant, subject: owner } });
  assert.ok(first.ok);
  const second = lab.runEvaluation({ evaluationId: admitted.record.evaluationId, as: { tenant, subject: owner } });
  assert.ok(!second.ok);
  assert.equal(second.code, "evaluation-already-run");
  assert.equal(second.recorded, first.run);
});

test("negative: calibration appends only; the observation history is immutable (E10)", () => {
  const observation = labFixtureObservation("observation-negative-1");
  const ledger = createObservationLedger([observation]);
  const { service: lab } = createLabService({ observations: [observation] });
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const run = lab.runEvaluation({ evaluationId: admitted.record.evaluationId, as: { tenant, subject: owner } });
  assert.ok(run.ok);

  const derivation = lab.calibrate({ evaluationId: admitted.record.evaluationId, as: { tenant, subject: owner }, observedOutcomeIds: [String(observation.observationId)] });
  assert.ok(derivation.ok);
  const before = ledger.ledger().observations;
  const appended = ledger.appendConclusion(derivation.conclusion);
  assert.ok(appended.ok);
  assert.ok(ledger.ledger().observations === before);
  const duplicate = ledger.appendConclusion(derivation.conclusion);
  assert.ok(!duplicate.ok);
});

test("negative: unknown observations cannot be calibrated from (E10 fail-closed)", () => {
  const ledger = createObservationLedger([labFixtureObservation("observation-negative-known")]);
  const { service: lab } = createLabService();
  const admitted = lab.admitEvaluation(request());
  assert.ok(admitted.ok);
  const run = lab.runEvaluation({ evaluationId: admitted.record.evaluationId, as: { tenant, subject: owner } });
  assert.ok(run.ok);
  const result = calibrateLabEvaluation({
    run: run.run,
    observedOutcomeIds: ["observation-negative-missing"],
    observations: ledger.view,
    calibratedAt: 3_000,
  });
  assert.ok(!result.ok);
  assert.equal(result.code, "unknown-observation");
});

test("negative: an observation cannot masquerade as a lab estimate (E11, compile-time)", () => {
  const observation: ObservedEvidence = { epistemic: "observed-evidence" };
  // @ts-expect-error — observed evidence carries the disjoint marker literal; the run-record result slot requires the estimate marker
  const asResult: LabeledEstimate = observation;
  assert.equal(asResult.epistemic, "observed-evidence");
});

test("negative: a lab estimate cannot masquerade as an observation (E11, compile-time)", () => {
  const estimate: LabeledEstimate = { epistemic: "labeled-estimate", method: "simulation", payload: [] };
  // @ts-expect-error — the estimate lacks the observed-evidence marker literal
  const asObservation: ObservedEvidence = estimate;
  assert.equal(asObservation.epistemic, "labeled-estimate");
});

test("negative: the runtime guard refuses stripped, swapped and forged labels (E11)", () => {
  const honest = { epistemic: "labeled-estimate", method: "simulation", payload: [{ metricId: "lab.metric.completed-work", value: { kind: "int", value: 1n } }] };
  assert.ok(asLabEstimateResult(honest) !== undefined);

  const stripped = { method: "simulation", payload: honest.payload };
  assert.equal(asLabEstimateResult(stripped), undefined);

  const swapped = { epistemic: "observed-evidence", method: "simulation", payload: honest.payload };
  assert.equal(asLabEstimateResult(swapped), undefined);

  const inventedMethod = { epistemic: "labeled-estimate", method: "guessing", payload: honest.payload };
  assert.equal(asLabEstimateResult(inventedMethod), undefined);

  const emptyPayload = { epistemic: "labeled-estimate", method: "simulation", payload: [] };
  assert.equal(asLabEstimateResult(emptyPayload), undefined);
});

test("negative: the canonical lab-contracts record refuses unlabeled results (E11)", () => {
  const result = recordCandidateEvaluation({
    evaluationId: "lab-eval-never" as never,
    cycleId: evidence[0]!.cycleId,
    organization: request().organization.id,
    suite: labFixtureSuite().ref,
    seed: asEvaluationSeed("seed-negative")!,
    result: { epistemic: "observed-evidence", method: "simulation", payload: [] } as never,
    evaluatedAt: asTimestampMs(2_000)!,
  });
  assert.ok(!result.ok);
  assert.equal(result.code, "result-not-estimate");
});

test("negative: unmodeled suite metrics are refused, never fabricated (E11)", () => {
  const { service: lab } = createLabService({ suites: [labFixtureSuite(), labFixtureForeignMetricSuite()] });
  const admitted = lab.admitEvaluation(
    request({ suite: labFixtureForeignMetricSuite().ref, parameters: { seed: asEvaluationSeed("seed-negative-foreign")!, tickBudget: 8 } }),
  );
  assert.ok(admitted.ok);
  const run = lab.runEvaluation({ evaluationId: admitted.record.evaluationId, as: { tenant, subject: owner } });
  assert.ok(!run.ok);
  assert.equal(run.code, "unmeasurable-metric");
});

function createLabService(options?: {
  readonly suites?: readonly LabEvaluationSuite[];
  readonly observations?: readonly ObservedOutcomeRecord[];
}) {
  const fakes = createLabSimulationFakes({
    suites: options?.suites,
    observations: options?.observations,
  });
  return { fakes, service: new LabSimulationService({ ports: fakes.ports }) };
}
