/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full Lab simulation/evaluation journey over the in-memory
 * fakes: admit a team-organization evaluation -> run it (deterministic,
 * labeled estimate, sealed + verified replay artifact in the CAS) ->
 * re-run returns the recorded receipt (E10) -> duplicate admission
 * returns the first intake record (E10) -> tampered evidence digest
 * refused (E8) -> unmodeled suite metric refused (E11 honesty) ->
 * determinism: a second service re-runs the same content to the SAME
 * replay identity (E9) -> cross-tenant read/run refused (R20) ->
 * calibration derives a conclusion from immutable observations and the
 * append-only fold keeps the observation list untouched (E10), with the
 * duplicate append refused -> persistence restore round-trip.
 * Prints deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no wall clock, no
 * randomness, no network.
 */

import { asEvaluationSeed, asTimestampMs } from "@playliquid/lab-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { LabSimulationService } from "./service.ts";
import { createLabSimulationFakes, labFixtureContext, labFixtureEvidenceRecords, labFixtureForeignMetricSuite, labFixtureObservation, labFixtureSuite, labFixtureTeamOrganization } from "./fakes.ts";
import { evidenceBundleDigestOf } from "./digest.ts";

const tenant = asTenantId("tenant-harness")!;
const owner = asSubjectId("subject-lab-lead")!;
const stranger = asSubjectId("subject-other-tenant")!;
const otherTenant = asTenantId("tenant-other")!;

const fakes = createLabSimulationFakes({ suites: [labFixtureSuite(), labFixtureForeignMetricSuite()] });
const service = new LabSimulationService({ ports: fakes.ports });

const steps: { readonly name: string; readonly expected: string; readonly actual: string; readonly pass: boolean }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual, pass: expected === actual });
}

const context = labFixtureContext();
const organization = labFixtureTeamOrganization();
const evidence = fakes.evidence.list();
const suite = labFixtureSuite();

const admitted = service.admitEvaluation({
  tenant,
  owner,
  cycleId: evidence[0]!.cycleId,
  organization,
  evidence: {
    recordIds: evidence.map((record) => String(record.evidenceId)),
    declaredDigest: evidenceBundleDigestOf(evidence),
  },
  suite: suite.ref,
  context,
  parameters: { seed: asEvaluationSeed("seed-harness-1")!, tickBudget: 12 },
  requestedAt: asTimestampMs(fakes.clock.now())!,
});
record("admit-team-evaluation", "ok", admitted.ok ? "ok" : `refused:${admitted.code}`);

const evaluationId = admitted.ok ? admitted.record.evaluationId : undefined;
const run = evaluationId !== undefined ? service.runEvaluation({ evaluationId, as: { tenant, subject: owner } }) : undefined;
record(
  "run-evaluation",
  "ok",
  run !== undefined && run.ok ? "ok" : run !== undefined && !run.ok ? `refused:${run.code}` : "no-id",
);
const estimateOk = run !== undefined && run.ok && run.run.result.epistemic === "labeled-estimate" && run.run.result.method === "simulation";
record("estimate-is-labeled", "true", String(estimateOk));
const replayStored = run !== undefined && run.ok ? fakes.replays.find(run.run.replay.replayId) !== undefined : false;
record("replay-in-cas", "true", String(replayStored));

const rerun = evaluationId !== undefined ? service.runEvaluation({ evaluationId, as: { tenant, subject: owner } }) : undefined;
record(
  "re-run-returns-receipt",
  "refused:evaluation-already-run",
  rerun !== undefined && !rerun.ok ? `refused:${rerun.code}` : "unexpected-ok",
);
const receiptIdentical =
  rerun !== undefined && !rerun.ok && rerun.recorded !== undefined && run !== undefined && run.ok
    ? rerun.recorded.replay.replayId === run.run.replay.replayId
    : false;
record("re-run-receipt-identical", "true", String(receiptIdentical));

const duplicate = service.admitEvaluation({
  tenant,
  owner,
  cycleId: evidence[0]!.cycleId,
  organization,
  evidence: {
    recordIds: evidence.map((record) => String(record.evidenceId)),
    declaredDigest: evidenceBundleDigestOf(evidence),
  },
  suite: suite.ref,
  context,
  parameters: { seed: asEvaluationSeed("seed-harness-1")!, tickBudget: 12 },
  requestedAt: asTimestampMs(fakes.clock.now())!,
});
record("duplicate-admission-receipt", "refused:duplicate-evaluation", duplicate.ok ? "unexpected-ok" : `refused:${duplicate.code}`);

const tampered = service.admitEvaluation({
  tenant,
  owner,
  cycleId: evidence[0]!.cycleId,
  organization,
  evidence: {
    recordIds: evidence.map((record) => String(record.evidenceId)),
    declaredDigest: evidenceBundleDigestOf(labFixtureEvidenceRecords(3, "swapped")),
  },
  suite: suite.ref,
  context,
  parameters: { seed: asEvaluationSeed("seed-harness-2")!, tickBudget: 12 },
  requestedAt: asTimestampMs(fakes.clock.now())!,
});
record("tampered-digest-refused", "refused:evidence-digest-mismatch", tampered.ok ? "unexpected-ok" : `refused:${tampered.code}`);

const foreignSuiteAdmission = service.admitEvaluation({
  tenant,
  owner,
  cycleId: evidence[0]!.cycleId,
  organization: labFixtureTeamOrganization(),
  evidence: {
    recordIds: evidence.map((record) => String(record.evidenceId)),
    declaredDigest: evidenceBundleDigestOf(evidence),
  },
  suite: labFixtureForeignMetricSuite().ref,
  context,
  parameters: { seed: asEvaluationSeed("seed-harness-3")!, tickBudget: 12 },
  requestedAt: asTimestampMs(fakes.clock.now())!,
});
const foreignRun =
  foreignSuiteAdmission.ok
    ? service.runEvaluation({ evaluationId: foreignSuiteAdmission.record.evaluationId, as: { tenant, subject: owner } })
    : undefined;
record(
  "unmodeled-metric-refused",
  "refused:unmeasurable-metric",
  foreignRun !== undefined && !foreignRun.ok ? `refused:${foreignRun.code}` : "unexpected-ok",
);

const crossRead = evaluationId !== undefined ? service.getEvaluation(evaluationId, { tenant: otherTenant, subject: stranger }) : undefined;
record("cross-tenant-read-refused", "refused:cross-tenant", crossRead !== undefined && !crossRead.ok ? `refused:${crossRead.code}` : "unexpected-ok");
const crossRun = evaluationId !== undefined ? service.runEvaluation({ evaluationId, as: { tenant: otherTenant, subject: stranger } }) : undefined;
record("cross-tenant-run-refused", "refused:cross-tenant", crossRun !== undefined && !crossRun.ok ? `refused:${crossRun.code}` : "unexpected-ok");

const observation = labFixtureObservation("observation-harness-1");
fakes.observations.appendObservation(observation);
const calibration = evaluationId !== undefined
  ? service.calibrate({ evaluationId, as: { tenant, subject: owner }, observedOutcomeIds: [String(observation.observationId)] })
  : undefined;
record("calibration-derives-conclusion", "ok", calibration !== undefined && calibration.ok ? "ok" : `refused:${calibration !== undefined ? calibration.code : "no-id"}`);

const observationsBefore = fakes.observations.ledger().observations;
if (calibration !== undefined && calibration.ok) {
  const appended = fakes.observations.appendConclusion(calibration.conclusion);
  record("calibration-appended", "true", String(appended.ok));
  const again = fakes.observations.appendConclusion(calibration.conclusion);
  record("duplicate-calibration-refused", "false", String(again.ok));
}
const appendOnly = fakes.observations.ledger().observations === observationsBefore;
record("observations-append-only", "true", String(appendOnly));

const secondFakes = createLabSimulationFakes({ evidence: fakes.evidence.list() });
const secondService = new LabSimulationService({ ports: secondFakes.ports });
const secondAdmission = secondService.admitEvaluation({
  tenant,
  owner,
  cycleId: evidence[0]!.cycleId,
  organization,
  evidence: {
    recordIds: evidence.map((record) => String(record.evidenceId)),
    declaredDigest: evidenceBundleDigestOf(evidence),
  },
  suite: suite.ref,
  context,
  parameters: { seed: asEvaluationSeed("seed-harness-1")!, tickBudget: 12 },
  requestedAt: asTimestampMs(fakes.clock.now())!,
});
const secondRun =
  secondAdmission.ok
    ? secondService.runEvaluation({ evaluationId: secondAdmission.record.evaluationId, as: { tenant, subject: owner } })
    : undefined;
const sameReplay =
  secondRun !== undefined && secondRun.ok && run !== undefined && run.ok
    ? secondRun.run.replay.replayId === run.run.replay.replayId
    : false;
record("determinism-same-replay-identity", "true", String(sameReplay));

const restored = new LabSimulationService({ ports: fakes.ports });
const restoreResult = restored.restore();
// Two admissions were stored: the golden team evaluation and the
// foreign-metric-suite evaluation (its RUN is refused; its intake is not).
record("restore-round-trip", "ok:2", restoreResult.ok ? `ok:${restoreResult.count}` : "failed");

const allPass = steps.every((step) => step.pass);
const report = { pass: allPass, steps };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!allPass) {
  process.exit(1);
}
