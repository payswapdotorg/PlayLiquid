/**
 * Calibration seam tests (E10 immutability, E11 estimate labeling):
 * derivation refusals, the append-only fold, and the idempotent
 * content-addressed conclusion.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { asEvaluationSeed, asTimestampMs } from "@playliquid/lab-contracts";
import { calibrateLabEvaluation, appendLabCalibrationConclusion } from "./calibration.ts";
import {
  createObservationLedger,
  createReplayStore,
  createSuiteDirectory,
  labFixtureContext,
  labFixtureEvidenceRecords,
  labFixtureObservation,
  labFixtureSuite,
  labFixtureTeamOrganization,
} from "./fakes.ts";
import { runLabEvaluation } from "./runner.ts";
import { evidenceBundleDigestOf, labEvaluationIdentityDigest, labEvaluationSlugId } from "./digest.ts";
import type { LabEvaluationRunRecord } from "./records.ts";

const evidence = labFixtureEvidenceRecords();
const suites = createSuiteDirectory([labFixtureSuite()]);
const replays = createReplayStore().sink;

function runFixture(): LabEvaluationRunRecord {
  const request = {
    tenant: asTenantId("tenant-calibration")!,
    owner: asSubjectId("subject-calibration")!,
    cycleId: evidence[0]!.cycleId,
    organization: labFixtureTeamOrganization(),
    evidence: {
      recordIds: evidence.map((record) => String(record.evidenceId)),
      declaredDigest: evidenceBundleDigestOf(evidence),
    },
    suite: labFixtureSuite().ref,
    context: labFixtureContext(),
    parameters: { seed: asEvaluationSeed("seed-calibration")!, tickBudget: 10 },
    requestedAt: asTimestampMs(1_000)!,
  };
  const digest = labEvaluationIdentityDigest(request);
  const result = runLabEvaluation({
    intake: {
      evaluationId: labEvaluationSlugId(digest),
      identityDigest: digest,
      tenant: request.tenant,
      owner: request.owner,
      cycleId: request.cycleId,
      organization: request.organization.id,
      suite: request.suite,
      evidenceRecordIds: request.evidence.recordIds,
      evidenceBundleDigest: evidenceBundleDigestOf(evidence),
      seed: request.parameters.seed,
      tickBudget: request.parameters.tickBudget,
      requestedAt: request.requestedAt,
      admittedAt: asTimestampMs(1_500)!,
    },
    organization: request.organization,
    context: request.context,
    evidence,
    suite: suites.resolver(request.suite)!,
    runAt: 2_000,
    replaySink: replays,
  });
  assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.detail}`);
  return result.run;
}

const observationA = labFixtureObservation("observation-calib-a");
const observationB = labFixtureObservation("observation-calib-b");
const foreignCycle = labFixtureObservation("observation-foreign-cycle", "cycle-other-1" as never);

test("derives a conclusion citing the immutable observations (E10)", () => {
  const ledger = createObservationLedger([observationA, observationB]);
  const run = runFixture();
  const result = calibrateLabEvaluation({
    run,
    observedOutcomeIds: [String(observationB.observationId), String(observationA.observationId)],
    observations: ledger.view,
    calibratedAt: 3_000,
  });
  assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.detail}`);
  assert.deepEqual(
    result.conclusion.derivedFrom.map((id) => String(id)).sort(),
    [String(observationA.observationId), String(observationB.observationId)].sort(),
  );
  assert.equal(String(result.conclusion.cycleId), String(run.cycleId));
  const statement = JSON.parse(result.conclusion.statement) as {
    estimate: { method: string; simulator: string; metrics: unknown[] };
    observations: { observationId: string }[];
  };
  assert.equal(statement.estimate.method, "simulation");
  assert.equal(statement.estimate.metrics.length, 8);
  assert.equal(statement.observations.length, 2);
});

test("derivation is deterministic and content-addressed (E9/E10)", () => {
  const ledger = createObservationLedger([observationA]);
  const run = runFixture();
  const first = calibrateLabEvaluation({ run, observedOutcomeIds: [String(observationA.observationId)], observations: ledger.view, calibratedAt: 3_000 });
  const second = calibrateLabEvaluation({ run, observedOutcomeIds: [String(observationA.observationId)], observations: ledger.view, calibratedAt: 3_000 });
  assert.ok(first.ok && second.ok);
  assert.equal(String(first.conclusion.calibrationId), String(second.conclusion.calibrationId));
  assert.equal(first.conclusion.statement, second.conclusion.statement);
  const otherTime = calibrateLabEvaluation({ run, observedOutcomeIds: [String(observationA.observationId)], observations: ledger.view, calibratedAt: 4_000 });
  assert.ok(otherTime.ok);
  assert.notEqual(String(otherTime.conclusion.calibrationId), String(first.conclusion.calibrationId));
});

test("unknown observation ids are refused (fail closed)", () => {
  const ledger = createObservationLedger([observationA]);
  const run = runFixture();
  const result = calibrateLabEvaluation({ run, observedOutcomeIds: ["observation-missing"], observations: ledger.view, calibratedAt: 3_000 });
  assert.ok(!result.ok);
  assert.equal(result.code, "unknown-observation");
});

test("empty observation citations are refused", () => {
  const ledger = createObservationLedger([observationA]);
  const run = runFixture();
  const result = calibrateLabEvaluation({ run, observedOutcomeIds: [], observations: ledger.view, calibratedAt: 3_000 });
  assert.ok(!result.ok);
  assert.equal(result.code, "unknown-observation");
});

test("cross-cycle observations are refused (one Lab cycle per calibration)", () => {
  const ledger = createObservationLedger([observationA, foreignCycle]);
  const run = runFixture();
  const result = calibrateLabEvaluation({
    run,
    observedOutcomeIds: [String(observationA.observationId), String(foreignCycle.observationId)],
    observations: ledger.view,
    calibratedAt: 3_000,
  });
  assert.ok(!result.ok);
  assert.equal(result.code, "cycle-mismatch");
});

test("a run whose estimate label was stripped is refused (E11)", () => {
  const ledger = createObservationLedger([observationA]);
  const run = runFixture();
  const stripped = { ...run, result: { ...run.result, epistemic: "observed-evidence" as never } };
  const result = calibrateLabEvaluation({ run: stripped, observedOutcomeIds: [String(observationA.observationId)], observations: ledger.view, calibratedAt: 3_000 });
  assert.ok(!result.ok);
  assert.equal(result.code, "estimate-label-missing");
});

test("invalid calibration times are refused", () => {
  const ledger = createObservationLedger([observationA]);
  const run = runFixture();
  const result = calibrateLabEvaluation({ run, observedOutcomeIds: [String(observationA.observationId)], observations: ledger.view, calibratedAt: Number.NaN });
  assert.ok(!result.ok);
  assert.equal(result.code, "invalid-request-time");
});

test("append-only fold: observations carried over by reference (E10, lock 27)", () => {
  const ledger = createObservationLedger([observationA, observationB]);
  const run = runFixture();
  const derivation = calibrateLabEvaluation({ run, observedOutcomeIds: [String(observationA.observationId)], observations: ledger.view, calibratedAt: 3_000 });
  assert.ok(derivation.ok);

  const before = ledger.ledger().observations;
  const appended = appendLabCalibrationConclusion(ledger.ledger(), derivation.conclusion);
  assert.ok(appended.ok);
  assert.equal(appended.ledger.observations, before);
  assert.equal(appended.ledger.conclusions.length, 1);
  assert.equal(String(appended.ledger.conclusions[0]!.calibrationId), String(derivation.conclusion.calibrationId));

  const duplicate = appendLabCalibrationConclusion(appended.ledger, derivation.conclusion);
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.code, "duplicate-calibration-id");
  assert.equal(duplicate.ledger, appended.ledger);

  const second = calibrateLabEvaluation({ run, observedOutcomeIds: [String(observationB.observationId)], observations: ledger.view, calibratedAt: 3_100 });
  assert.ok(second.ok);
  const both = appendLabCalibrationConclusion(appended.ledger, second.conclusion);
  assert.ok(both.ok);
  assert.equal(both.ledger.observations, before);
  assert.equal(both.ledger.conclusions.length, 2);
});

test("a conclusion citing observations outside the ledger is refused on append (E10)", () => {
  const emptyLedger = createObservationLedger([]);
  const run = runFixture();
  const derivedAgainstOtherLedger = calibrateLabEvaluation({
    run,
    observedOutcomeIds: [String(observationA.observationId)],
    observations: createObservationLedger([observationA]).view,
    calibratedAt: 3_000,
  });
  assert.ok(derivedAgainstOtherLedger.ok);
  const result = appendLabCalibrationConclusion(emptyLedger.ledger(), derivedAgainstOtherLedger.conclusion);
  assert.ok(!result.ok);
  assert.equal(result.code, "unknown-observation-reference");
  assert.ok(result.detail.includes(String(observationA.observationId)));
});
