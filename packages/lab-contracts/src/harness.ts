/**
 * Runtime pure-check harness (PL-006 evidence).
 *
 * Run with: `node src/harness.ts` (Node >= 24 type stripping).
 * Assembles synthetic Lab records at runtime from fragments, then
 * exercises each PL-006 keystone contract with deliberately hostile
 * inputs: the generalist baseline, the E10 evidence ledger (including an
 * attempted rewrite), the E11 estimate/observation split, the R18
 * capability-gap ladder (including Arena-as-first-resort), the lab-loop
 * stage walk and the evaluation-suite seam through the in-memory fakes.
 * Prints deterministic outputs — real runtime evidence that the pure
 * contract functions work. No assertions; those live in tests.
 */

import { asAgentId } from "@playliquid/game-contracts";
import {
  appendCalibrationConclusion,
  appendObservation,
  appendProjectEvidence,
  EMPTY_OBSERVATION_LEDGER,
  EMPTY_PROJECT_EVIDENCE_LEDGER,
} from "./evidence.ts";
import type { ObservationLedger, ObservedOutcomeRecord, ProjectEvidenceRecord } from "./evidence.ts";
import { epistemicClassOf } from "./estimates.ts";
import { recordCandidateEvaluation, validateCandidateEvaluationRecord } from "./evaluation.ts";
import { appendGapRungAttempt, validateGapRecord } from "./gap-ladder.ts";
import type { CapabilityGapRecord, GapRungAttempt } from "./gap-ladder.ts";
import { appendLoopStage } from "./loop.ts";
import { validateLabCycle } from "./loop-validation.ts";
import type { LabCycleRecord, LabLoopStageRecord } from "./loop.ts";
import { generalistBaselineOrganization, isGeneralistBaselineOrganization } from "./organization.ts";
import { validateOrganization } from "./organization-validation.ts";
import {
  asArenaEscalationId,
  asCalibrationId,
  asCandidateEvaluationId,
  asDiagnosisId,
  asEvidenceRecordId,
  asGapRecordId,
  asHypothesisId,
  asImplementationCandidateId,
  asLabCycleId,
  asObservationId,
  asOrganizationId,
  asReleaseId,
} from "./primitives.ts";
import {
  fakeOrganizationEvaluator,
  fakeSuiteResolver,
  fixtureCommitRef,
  fixtureDigest,
  fixtureEvaluationId,
  fixtureGameIdentity,
  fixtureModelRoute,
  fixtureSeed,
  fixtureSuite,
  fixtureTimestamp,
} from "./fixtures.ts";

const cycle = asLabCycleId("cycle-harness")!;
const baseline = generalistBaselineOrganization({
  organizationId: asOrganizationId("org-generalist-baseline")!,
  agent: asAgentId("agent-lab")!,
  model: fixtureModelRoute(),
});

// 1. The generalist baseline is valid and canonical (lock 26).
const organizationCheck = validateOrganization(baseline);
console.log(
  `baseline: valid=${organizationCheck.ok} generalist=${isGeneralistBaselineOrganization(baseline)} agents=${baseline.agents.length}`,
);

// 2. E10: evidence appends immutably; a rewrite attempt is refused.
const evidenceRecord: ProjectEvidenceRecord = {
  epistemic: "observed-evidence",
  evidenceId: asEvidenceRecordId("evidence-harness")!,
  cycleId: cycle,
  kind: "repository-metrics",
  source: fixtureCommitRef("harness-evidence"),
  contentDigest: fixtureDigest("harness-evidence"),
  summary: "Cycle velocity metrics captured from the project repository.",
  observedAt: fixtureTimestamp(),
};
const evidenceAppended = appendProjectEvidence(EMPTY_PROJECT_EVIDENCE_LEDGER, evidenceRecord);
console.log(`evidence-append: ok=${evidenceAppended.ok}`);
if (evidenceAppended.ok) {
  const sealed = evidenceAppended.ledger.records[0]!;
  let rewriteRejected = false;
  try {
    (sealed as { summary: string }).summary = "rewritten history";
  } catch {
    rewriteRejected = true;
  }
  const duplicate = appendProjectEvidence(evidenceAppended.ledger, {
    ...evidenceRecord,
    summary: "history has been rewritten",
  });
  console.log(
    `evidence-rewrite: mutationRejected=${rewriteRejected} duplicateRefused=${!duplicate.ok} code=${duplicate.ok ? "-" : duplicate.code}`,
  );
}

// 3. E10: calibration appends conclusions derived from immutable observations.
const observation: ObservedOutcomeRecord = {
  epistemic: "observed-evidence",
  observationId: asObservationId("observation-harness")!,
  cycleId: cycle,
  release: asReleaseId("release-harness")!,
  contentDigest: fixtureDigest("harness-observation"),
  summary: "Release outcome: defect density halved with the reviewer role.",
  observedAt: fixtureTimestamp(),
};
const observed = appendObservation(EMPTY_OBSERVATION_LEDGER, observation);
let observationLedger: ObservationLedger = EMPTY_OBSERVATION_LEDGER;
if (observed.ok) {
  observationLedger = observed.ledger;
  const calibrated = appendCalibrationConclusion(observed.ledger, {
    calibrationId: asCalibrationId("calibration-harness")!,
    cycleId: cycle,
    derivedFrom: [observation.observationId],
    statement: "Reviewer-role organizations reduced rework in this context.",
  });
  console.log(
    `calibration: ok=${calibrated.ok} observationsUntouched=${calibrated.ok ? calibrated.ledger.observations === observed.ledger.observations : "-"} conclusions=${calibrated.ok ? calibrated.ledger.conclusions.length : "-"}`,
  );
  if (calibrated.ok) {
    observationLedger = calibrated.ledger;
  }
  const bogus = appendCalibrationConclusion(observed.ledger, {
    calibrationId: asCalibrationId("calibration-bogus")!,
    cycleId: cycle,
    derivedFrom: [asObservationId("observation-ghost")!],
    statement: "derived from nothing",
  });
  console.log(`calibration-audit-chain: bogusCiteRefused=${!bogus.ok} code=${bogus.ok ? "-" : bogus.code}`);
}

// 4. E11: estimates and observations classify into disjoint epistemic classes.
const estimatePayload = fakeOrganizationEvaluator()({
  organization: baseline,
  suite: fixtureSuite(),
  context: { game: fixtureGameIdentity(), phase: "production", taskDifficulty: "moderate" },
  seed: fixtureSeed("harness-seed"),
});
console.log(
  `epistemic: estimate=${epistemicClassOf(estimatePayload)} observation=${epistemicClassOf(observation)} unlabeled=${epistemicClassOf({ score: 1 })}`,
);

// 5. The evaluation-suite seam: fake resolver + evaluator + record assembly.
const suite = fixtureSuite();
const resolved = fakeSuiteResolver([suite])(suite.ref);
const evaluation = recordCandidateEvaluation({
  evaluationId: fixtureEvaluationId(),
  cycleId: cycle,
  organization: baseline.id,
  suite: suite.ref,
  seed: fixtureSeed("harness-seed"),
  result: estimatePayload,
  evaluatedAt: fixtureTimestamp(),
});
const evaluationValidation = evaluation.ok && resolved !== undefined
  ? validateCandidateEvaluationRecord(evaluation.record, resolved)
  : { ok: false };
console.log(
  `evaluation: resolved=${resolved !== undefined} recorded=${evaluation.ok} readingsMatchKernelShapes=${evaluationValidation.ok} method=${estimatePayload.method}`,
);

// 6. R18: the capability-gap ladder walk, with Arena-first-resort refused.
let gap: CapabilityGapRecord = {
  gapId: asGapRecordId("gap-harness")!,
  cycleId: cycle,
  missingCapability: "capability-shader-pipeline",
  summary: "Nobody in the organization can author shader pipelines.",
  openedAt: fixtureTimestamp(),
  attempts: [],
};
const arenaFirst: GapRungAttempt = {
  rung: "arena-escalation",
  disposition: "attempted",
  outcome: "unresolved",
  external: {
    external: "arena-external",
    escalationId: asArenaEscalationId("escalation-harness")!,
    requestDigest: fixtureDigest("escalation-harness"),
  },
};
const arenaFirstResult = appendGapRungAttempt(gap, arenaFirst);
console.log(`gap-arena-first-resort: refused=${!arenaFirstResult.ok} code=${arenaFirstResult.ok ? "-" : arenaFirstResult.code}`);
const walk: GapRungAttempt[] = [
  { rung: "existing-organization", disposition: "attempted", outcome: "unresolved", organization: baseline.id },
  { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved", organization: asOrganizationId("org-specialists")! },
  { rung: "package-platform-capability", disposition: "unavailable" },
  { rung: "user-community-contribution", disposition: "declined" },
  { rung: "arena-escalation", disposition: "declined" },
  { rung: "blocked", reason: "no resolution path without the capability" },
];
for (const attempt of walk) {
  const step = appendGapRungAttempt(gap, attempt);
  if (step.ok) gap = step.gap;
}
const gapValidation = validateGapRecord(gap);
console.log(
  `gap-ladder: walkedAllRungs=${gap.attempts.length === 6} valid=${gapValidation.ok} terminal=${gap.attempts[5]?.rung}`,
);

// 7. The lab loop: full stage walk with linkage validation.
const evidenceLedger = appendProjectEvidence(EMPTY_PROJECT_EVIDENCE_LEDGER, evidenceRecord);
let labCycle: LabCycleRecord = {
  cycleId: cycle,
  project: fixtureGameIdentity(),
  stages: [],
};
const stages: LabLoopStageRecord[] = [
  { stage: "project-evidence", cycleId: cycle, collected: [evidenceRecord.evidenceId] },
  {
    stage: "diagnosis",
    cycleId: cycle,
    diagnosisId: asDiagnosisId("diagnosis-harness")!,
    fromEvidence: [evidenceRecord.evidenceId],
    findings: ["Rework concentrates in review-less merges."],
  },
  {
    stage: "hypothesis",
    cycleId: cycle,
    hypothesisId: asHypothesisId("hypothesis-harness")!,
    diagnosis: asDiagnosisId("diagnosis-harness")!,
    statement: "A dedicated reviewer role reduces rework.",
  },
  {
    stage: "organization-search",
    cycleId: cycle,
    hypothesis: asHypothesisId("hypothesis-harness")!,
    context: { game: fixtureGameIdentity(), phase: "production", taskDifficulty: "moderate" },
    baseline: baseline.id,
    candidates: [baseline.id, asOrganizationId("org-specialists")!],
  },
  { stage: "simulation-evaluation", cycleId: cycle, evaluation: asCandidateEvaluationId("evaluation-1")! },
  {
    stage: "implementation-candidate",
    cycleId: cycle,
    candidateId: asImplementationCandidateId("candidate-harness")!,
    evaluation: asCandidateEvaluationId("evaluation-1")!,
    organization: asOrganizationId("org-specialists")!,
    contentDigest: fixtureDigest("candidate-harness"),
  },
  { stage: "pr", cycleId: cycle, candidate: asImplementationCandidateId("candidate-harness")!, pr: fixtureCommitRef("pr-harness") },
  {
    stage: "release",
    cycleId: cycle,
    releaseId: asReleaseId("release-harness")!,
    candidate: asImplementationCandidateId("candidate-harness")!,
    released: fixtureCommitRef("release-harness"),
  },
  { stage: "observed-outcome", cycleId: cycle, observation: observation.observationId, release: asReleaseId("release-harness")! },
  { stage: "calibration", cycleId: cycle, calibration: asCalibrationId("calibration-harness")!, observations: [observation.observationId] },
];
for (const stage of stages) {
  const step = appendLoopStage(labCycle, stage);
  if (step.ok) labCycle = step.cycle;
}
const cycleValidation = evidenceLedger.ok
  ? validateLabCycle(labCycle, {
      evidence: evidenceLedger.ledger,
      observations: observationLedger,
      organizations: [
        baseline,
        generalistBaselineOrganization({
          organizationId: asOrganizationId("org-specialists")!,
          agent: asAgentId("agent-architect")!,
          model: fixtureModelRoute("route-architect"),
        }),
      ],
    })
  : { ok: false };
console.log(`lab-loop: stages=${labCycle.stages.length}/10 linksValid=${cycleValidation.ok}`);

// 8. The model seam stays opaque end-to-end (lock 5).
console.log(
  `zcode-seam: route=${fixtureModelRoute().route} authority=${fixtureModelRoute().authority} agent=${asAgentId("agent-lab")}`,
);
