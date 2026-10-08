import { test } from "node:test";
import assert from "node:assert/strict";
import { asAgentId } from "@playliquid/game-contracts";
import {
  LAB_LOOP_STAGE_KINDS,
  LAB_LOOP_TRANSITIONS,
  appendLoopStage,
  canTransitionLoopStage,
  isLabLoopStageKind,
  validateLabCycle,
} from "./loop.ts";
import type { LabCycleRecord, LabLoopStageKind, LabLoopStageRecord } from "./loop.ts";
import {
  appendCalibrationConclusion,
  appendObservation,
  appendProjectEvidence,
} from "./evidence.ts";
import type { ProjectEvidenceRecord, ObservedOutcomeRecord } from "./evidence.ts";
import {
  asCalibrationId,
  asCandidateEvaluationId,
  asDiagnosisId,
  asEvidenceRecordId,
  asHypothesisId,
  asImplementationCandidateId,
  asLabCycleId,
  asObservationId,
  asOrganizationId,
  asReleaseId,
} from "./primitives.ts";
import {
  fixtureCommitRef,
  fixtureDigest,
  fixtureGameIdentity,
  fixtureGeneralistOrganization,
  fixtureTimestamp,
} from "./fixtures.ts";
import { generalistBaselineOrganization } from "./organization.ts";
import type { ProjectEvidenceLedger, ObservationLedger } from "./evidence.ts";
import { fixtureModelRoute } from "./fixtures.ts";

const CYCLE = asLabCycleId("cycle-1")!;

function evidence(id: string): ProjectEvidenceRecord {
  return {
    epistemic: "observed-evidence",
    evidenceId: asEvidenceRecordId(id)!,
    cycleId: CYCLE,
    kind: "repository-metrics",
    source: fixtureCommitRef(id),
    contentDigest: fixtureDigest(id),
    summary: `Evidence ${id}.`,
    observedAt: fixtureTimestamp(),
  };
}

function observation(id: string, release: string, cycle = CYCLE): ObservedOutcomeRecord {
  return {
    epistemic: "observed-evidence",
    observationId: asObservationId(id)!,
    cycleId: cycle,
    release: asReleaseId(release)!,
    contentDigest: fixtureDigest(id),
    summary: `Outcome ${id}.`,
    observedAt: fixtureTimestamp(),
  };
}

function stages(): LabLoopStageRecord[] {
  return [
    { stage: "project-evidence", cycleId: CYCLE, collected: [asEvidenceRecordId("evidence-1")!] },
    {
      stage: "diagnosis",
      cycleId: CYCLE,
      diagnosisId: asDiagnosisId("diagnosis-1")!,
      fromEvidence: [asEvidenceRecordId("evidence-1")!],
      findings: ["Iteration velocity degrades after merge conflicts."],
    },
    {
      stage: "hypothesis",
      cycleId: CYCLE,
      hypothesisId: asHypothesisId("hypothesis-1")!,
      diagnosis: asDiagnosisId("diagnosis-1")!,
      statement: "A reviewer-role agent reduces rework.",
    },
    {
      stage: "organization-search",
      cycleId: CYCLE,
      hypothesis: asHypothesisId("hypothesis-1")!,
      context: { game: fixtureGameIdentity(), phase: "production", taskDifficulty: "moderate" },
      baseline: asOrganizationId("org-generalist-baseline")!,
      candidates: [asOrganizationId("org-generalist-baseline")!, asOrganizationId("org-specialists")!],
    },
    { stage: "simulation-evaluation", cycleId: CYCLE, evaluation: asCandidateEvaluationId("evaluation-1")! },
    {
      stage: "implementation-candidate",
      cycleId: CYCLE,
      candidateId: asImplementationCandidateId("candidate-1")!,
      evaluation: asCandidateEvaluationId("evaluation-1")!,
      organization: asOrganizationId("org-specialists")!,
      contentDigest: fixtureDigest("candidate-1"),
    },
    { stage: "pr", cycleId: CYCLE, candidate: asImplementationCandidateId("candidate-1")!, pr: fixtureCommitRef("pr-1") },
    {
      stage: "release",
      cycleId: CYCLE,
      releaseId: asReleaseId("release-1")!,
      candidate: asImplementationCandidateId("candidate-1")!,
      released: fixtureCommitRef("release-1"),
    },
    { stage: "observed-outcome", cycleId: CYCLE, observation: asObservationId("observation-1")!, release: asReleaseId("release-1")! },
    { stage: "calibration", cycleId: CYCLE, calibration: asCalibrationId("calibration-1")!, observations: [asObservationId("observation-1")!] },
  ];
}

function emptyCycle(): LabCycleRecord {
  return { cycleId: CYCLE, project: fixtureGameIdentity(), stages: [] };
}

function buildStores(): {
  readonly evidenceLedger: ProjectEvidenceLedger;
  readonly observationLedger: ObservationLedger;
  readonly organizations: readonly ReturnType<typeof generalistBaselineOrganization>[];
} {
  let evidenceLedger: ProjectEvidenceLedger = { records: [] };
  for (const record of [evidence("evidence-1"), evidence("evidence-2")]) {
    const step = appendProjectEvidence(evidenceLedger, record);
    if (step.ok) evidenceLedger = step.ledger;
  }
  let observationLedger: ObservationLedger = { observations: [], conclusions: [] };
  const observed = appendObservation(observationLedger, observation("observation-1", "release-1"));
  if (observed.ok) {
    const concluded = appendCalibrationConclusion(observed.ledger, {
      calibrationId: asCalibrationId("calibration-1")!,
      cycleId: CYCLE,
      derivedFrom: [asObservationId("observation-1")!],
      statement: "The specialist organization outperformed the baseline.",
    });
    if (concluded.ok) observationLedger = concluded.ledger;
  }
  const organizations = [
    fixtureGeneralistOrganization().descriptor,
    generalistBaselineOrganization({
      organizationId: asOrganizationId("org-specialists")!,
      agent: asAgentId("agent-architect")!,
      model: fixtureModelRoute("route-architect"),
    }),
  ];
  return { evidenceLedger, observationLedger, organizations };
}

test("loop: the stage vocabulary is frozen and matches the canonical loop", () => {
  assert.ok(Object.isFrozen(LAB_LOOP_STAGE_KINDS));
  assert.equal(LAB_LOOP_STAGE_KINDS.length, 10);
  assert.deepEqual([...LAB_LOOP_STAGE_KINDS], [
    "project-evidence",
    "diagnosis",
    "hypothesis",
    "organization-search",
    "simulation-evaluation",
    "implementation-candidate",
    "pr",
    "release",
    "observed-outcome",
    "calibration",
  ]);
  for (const kind of LAB_LOOP_STAGE_KINDS) {
    assert.ok(isLabLoopStageKind(kind));
  }
  assert.equal(isLabLoopStageKind("arena-escalation"), false);
});

test("loop: the transition table is the canonical chain plus the loop edge", () => {
  assert.ok(Object.isFrozen(LAB_LOOP_TRANSITIONS));
  // The canonical chain.
  const chain: [LabLoopStageKind, LabLoopStageKind][] = [
    ["project-evidence", "diagnosis"],
    ["diagnosis", "hypothesis"],
    ["hypothesis", "organization-search"],
    ["organization-search", "simulation-evaluation"],
    ["simulation-evaluation", "implementation-candidate"],
    ["implementation-candidate", "pr"],
    ["pr", "release"],
    ["release", "observed-outcome"],
    ["observed-outcome", "calibration"],
    ["calibration", "organization-search"],
  ];
  for (const [from, to] of chain) {
    assert.equal(canTransitionLoopStage(from, to), true, `${from} -> ${to}`);
  }
  // The loop edge: calibration closes the loop into the next search.
  assert.equal(canTransitionLoopStage("calibration", "organization-search"), true);
  // Skipping stages is refused.
  assert.equal(canTransitionLoopStage("project-evidence", "hypothesis"), false);
  assert.equal(canTransitionLoopStage("diagnosis", "release"), false);
  assert.equal(canTransitionLoopStage("calibration", "project-evidence"), false);
});

test("loop: appendLoopStage walks the full canonical cycle (happy path)", () => {
  let cycle = emptyCycle();
  for (const stage of stages()) {
    const result = appendLoopStage(cycle, stage);
    assert.equal(result.ok, true, `append of ${stage.stage} failed`);
    if (!result.ok) return;
    cycle = result.cycle;
  }
  assert.equal(cycle.stages.length, 10);
  // Pure copy-on-write: the empty starting cycle is untouched.
  assert.equal(emptyCycle().stages.length, 0);
});

test("loop: appending stages out of order or twice is refused", () => {
  const stageList = stages();
  // Fresh cycle must start at project-evidence.
  const wrongFirst = appendLoopStage(emptyCycle(), stageList[1]!);
  assert.equal(wrongFirst.ok, false);
  if (wrongFirst.ok) return;
  assert.equal(wrongFirst.code, "first-stage-must-collect-evidence");

  let cycle = emptyCycle();
  const first = appendLoopStage(cycle, stageList[0]!);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  cycle = first.cycle;
  // Skipping diagnosis: hypothesis directly after project-evidence.
  const skip = appendLoopStage(cycle, stageList[2]!);
  assert.equal(skip.ok, false);
  if (skip.ok) return;
  assert.equal(skip.code, "illegal-stage-transition");
  // Duplicate stage kind.
  const duplicate = appendLoopStage(cycle, stageList[0]!);
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.equal(duplicate.code, "duplicate-stage-kind");
  // A second organization-search after calibration is the loop edge trying
  // to fire INSIDE one cycle — refused by the one-stage-per-kind rule.
  let full = emptyCycle();
  for (const stage of stageList) {
    const step = appendLoopStage(full, stage);
    assert.equal(step.ok, true);
    if (!step.ok) return;
    full = step.cycle;
  }
  const repeatSearch = appendLoopStage(full, stageList[3]!);
  assert.equal(repeatSearch.ok, false);
  if (repeatSearch.ok) return;
  assert.equal(repeatSearch.code, "duplicate-stage-kind");
});

test("loop: a stage from another cycle cannot be appended (cycle-id-mismatch)", () => {
  const foreign = { ...stages()[0]!, cycleId: asLabCycleId("cycle-9")! } as LabLoopStageRecord;
  const result = appendLoopStage(emptyCycle(), foreign);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "cycle-id-mismatch");
});

test("loop: validateLabCycle accepts a fully-linked cycle (typed links resolve)", () => {
  const { evidenceLedger, observationLedger, organizations } = buildStores();
  const cycle: LabCycleRecord = { cycleId: CYCLE, project: fixtureGameIdentity(), stages: stages() };
  const validation = validateLabCycle(cycle, {
    evidence: evidenceLedger,
    observations: observationLedger,
    organizations,
  });
  assert.equal(validation.ok, true);
});

test("loop: validateLabCycle refuses broken typed links (E8 negative paths)", () => {
  const { evidenceLedger, observationLedger, organizations } = buildStores();
  const baseStores = { evidence: evidenceLedger, observations: observationLedger, organizations };
  const cycle = (stagesList: LabLoopStageRecord[]): LabCycleRecord => ({
    cycleId: CYCLE,
    project: fixtureGameIdentity(),
    stages: stagesList,
  });

  // Unknown evidence reference in the collected set.
  const ghostEvidence = stages().map((stage) =>
    stage.stage === "project-evidence"
      ? { ...stage, collected: [asEvidenceRecordId("evidence-ghost")!] }
      : stage,
  );
  const badEvidence = validateLabCycle(cycle(ghostEvidence), baseStores);
  assert.equal(badEvidence.ok, false);
  if (badEvidence.ok) return;
  assert.ok(badEvidence.violations.some((v) => v.code === "unknown-evidence-reference"));

  // The baseline organization missing from the candidates (lock 26).
  const noBaseline = stages().map((stage) =>
    stage.stage === "organization-search"
      ? { ...stage, candidates: [asOrganizationId("org-specialists")!] }
      : stage,
  );
  const badBaseline = validateLabCycle(cycle(noBaseline), baseStores);
  assert.equal(badBaseline.ok, false);
  if (badBaseline.ok) return;
  assert.ok(badBaseline.violations.some((v) => v.code === "baseline-not-among-candidates"));

  // Observation does not belong to the cited release.
  const swappedRelease = stages().map((stage) =>
    stage.stage === "observed-outcome"
      ? { ...stage, release: asReleaseId("release-ghost")! }
      : stage,
  );
  const badRelease = validateLabCycle(cycle(swappedRelease), baseStores);
  assert.equal(badRelease.ok, false);
  if (badRelease.ok) return;
  assert.ok(badRelease.violations.some((v) => v.code === "unknown-release-reference"));

  // Calibration conclusion missing from the ledger.
  const ghostCalibration = stages().map((stage) =>
    stage.stage === "calibration"
      ? { ...stage, calibration: asCalibrationId("calibration-ghost")! }
      : stage,
  );
  const badCalibration = validateLabCycle(cycle(ghostCalibration), baseStores);
  assert.equal(badCalibration.ok, false);
  if (badCalibration.ok) return;
  assert.ok(badCalibration.violations.some((v) => v.code === "unknown-calibration-reference"));

  // Out-of-order stages.
  const reordered = [stages()[1]!, stages()[0]!, ...stages().slice(2)];
  const badOrder = validateLabCycle(cycle(reordered), baseStores);
  assert.equal(badOrder.ok, false);
  if (badOrder.ok) return;
  assert.ok(badOrder.violations.some((v) => v.code === "first-stage-violation" || v.code === "stage-order-violation"));

  // Unknown observation reference.
  const ghostObservation = stages().map((stage) =>
    stage.stage === "calibration"
      ? { ...stage, observations: [asObservationId("observation-ghost")!] }
      : stage,
  );
  const badObservation = validateLabCycle(cycle(ghostObservation), baseStores);
  assert.equal(badObservation.ok, false);
  if (badObservation.ok) return;
  assert.ok(badObservation.violations.some((v) => v.code === "unknown-observation-reference"));

  // A cycle whose stage record carries a foreign cycleId.
  const foreign = stages().map((stage, index) =>
    index === 2 ? { ...stage, cycleId: asLabCycleId("cycle-9")! } : stage,
  );
  const badCycleId = validateLabCycle(cycle(foreign), baseStores);
  assert.equal(badCycleId.ok, false);
  if (badCycleId.ok) return;
  assert.ok(badCycleId.violations.some((v) => v.code === "stage-cycle-id-mismatch"));
});

test("loop: an empty cycle is a typed validation failure, not a crash", () => {
  const { evidenceLedger, observationLedger } = buildStores();
  const validation = validateLabCycle(emptyCycle(), { evidence: evidenceLedger, observations: observationLedger });
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.deepEqual(validation.violations.map((v) => v.code), ["empty-cycle"]);
});

test("loop: cycle lineage is carried as data (previousCycle)", () => {
  const next = appendLoopStage(
    { cycleId: asLabCycleId("cycle-2")!, project: fixtureGameIdentity(), previousCycle: CYCLE, stages: [] },
    {
      stage: "project-evidence",
      cycleId: asLabCycleId("cycle-2")!,
      collected: [asEvidenceRecordId("evidence-1")!],
    },
  );
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.cycle.previousCycle, CYCLE);
  assert.equal(next.cycle.stages.length, 1);
});
