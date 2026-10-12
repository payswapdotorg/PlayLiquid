/**
 * INTERNAL TEST SUPPORT (PL-030) — shared builders for the test battery.
 *
 * NOT part of the public surface (not exported from index.ts; the
 * lab-organization house pattern keeps fakes out of the barrel — here the
 * builders are not even ports, just hand-built artifacts for unit tests).
 * The journey tests (journey.test.ts) use the REAL engines instead
 * (fakes.ts wires PL-029 + PL-028).
 *
 * Everything here is deterministic: no IO, no timers, no randomness. The
 * lab-contracts/lab-simulation fixture vocabulary is reused (never
 * re-declared) where it exists.
 */

import type {
  CapabilityGapRecord,
  GapRungAttempt,
  ObservedOutcomeRecord,
} from "@playliquid/lab-contracts";
import {
  asCandidateEvaluationId,
  asEvaluationSeed,
  asLabCycleId,
  asLabEvaluationMetricId,
  asObservationId,
  asOrganizationId,
  asTimestampMs,
} from "@playliquid/lab-contracts";
import type { LabEvaluationRunRecord } from "@playliquid/lab-simulation";
import {
  LAB_METRIC_IDS,
  createObservationLedger,
  labFixtureDigest,
  labFixtureObservation,
  labFixtureSuite,
  labFixtureTeamOrganization,
} from "@playliquid/lab-simulation";
import type { CandidateBlueprint, SearchedCandidate } from "@playliquid/lab-organization";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import type { LabCycleLearningSubmission } from "./records.ts";

export const testTenant = asTenantId("tenant-lab-learning-test")!;
export const testOwner = asSubjectId("subject-lab-learning-test")!;
export const testCycle = asLabCycleId("cycle-lab-learning-test-1")!;

/** One hand-built observed outcome (the lab-simulation fixture, cycle-pinned). */
export function testObservation(id = "observation-test-1", cycleId = testCycle): ObservedOutcomeRecord {
  return labFixtureObservation(id, cycleId);
}

/** An observation ledger with one observation + one appended conclusion. */
export function testLedger(cycleId = testCycle, observationCount = 1) {
  const ledger = createObservationLedger([]);
  const ids: string[] = [];
  for (let index = 1; index <= observationCount; index += 1) {
    const observation = testObservation(`observation-test-${index}`, cycleId);
    ledger.appendObservation(observation);
    ids.push(String(observation.observationId));
  }
  const calibration = {
    calibrationId: `calibration-test-${String(cycleId)}` as never,
    cycleId,
    derivedFrom: Object.freeze(ids.map((id) => asObservationId(id)!)),
    statement: `test calibration of ${String(cycleId)}`,
  };
  const appended = ledger.appendConclusion(calibration);
  if (!appended.ok) throw new Error(`testkit: conclusion append refused: ${appended.detail}`);
  return ledger;
}

/** A hand-built PL-028 evaluation run record (a labeled estimate, E11). */
export function testRun(options?: {
  readonly cycleId?: string;
  readonly evaluationId?: string;
  readonly completedWork?: number;
  readonly method?: "simulation" | "analytical-model" | "counterfactual-replay" | "expert-judgment";
  readonly tenant?: TenantId;
  readonly owner?: SubjectId;
  readonly organization?: string;
}): LabEvaluationRunRecord {
  const completedWork = options?.completedWork ?? 5;
  return {
    evaluationId: asCandidateEvaluationId(options?.evaluationId ?? "lab-eval-test-1")!,
    tenant: options?.tenant ?? testTenant,
    owner: options?.owner ?? testOwner,
    cycleId: asLabCycleId(options?.cycleId ?? String(testCycle))!,
    organization: asOrganizationId(options?.organization ?? String(labFixtureTeamOrganization().id))!,
    suite: labFixtureSuite().ref,
    seed: asEvaluationSeed("seed-lab-learning-test")!,
    simulator: "lab-simulation-headless-v1",
    runAt: asTimestampMs(1_000)!,
    statistics: {
      ticks: 12,
      commandsAdmitted: 6,
      brokerGrants: 6,
      brokerDenials: 0,
      eventsEmitted: 12,
      completedWork,
      openWork: 1,
      defects: 0,
      progressUnits: completedWork,
      capabilityCoverage: 1,
    },
    result: {
      epistemic: "labeled-estimate",
      method: options?.method ?? "simulation",
      payload: Object.freeze([
        { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.completedWork)!, value: { kind: "int" as const, value: BigInt(completedWork) } },
      ]),
    },
    replay: {
      replayId: "replay-lab-learning-test",
      commandStream: labFixtureDigest("replay-command-test"),
      eventWitness: labFixtureDigest("replay-witness-test"),
    },
  };
}

/** A full twelve-field candidate blueprint (lab-organization vocabulary). */
export function testBlueprint(over: Partial<CandidateBlueprint> = {}): CandidateBlueprint {
  return {
    agentCount: 3,
    roleAssignment: "vocabulary-split",
    bodyBinding: "none",
    modelRouting: "uniform",
    toolSet: "none",
    capabilitySpread: "all-agents",
    topology: "star",
    memory: "shared-store",
    humanParticipation: "none",
    budget: "standard",
    scheduling: "event-driven",
    review: "lead-reviewer",
    ...over,
  };
}

/** A hand-built PL-029 search result (a candidate with a dimension tuple). */
export function testSearchResult(over: Partial<SearchedCandidate> = {}): SearchedCandidate {
  return {
    position: 1,
    spaceIndex: 1,
    isBaseline: false,
    blueprint: testBlueprint(),
    organization: labFixtureTeamOrganization(),
    contentDigest: labFixtureDigest("candidate-test-1"),
    ...over,
  };
}

/** A lab-contracts-valid capability-gap record walking the ladder. */
export function testGapRecord(gapId = "gap-test-1", cycleId = testCycle, attempts?: readonly GapRungAttempt[]): CapabilityGapRecord {
  const trail: readonly GapRungAttempt[] =
    attempts ?? [
      { rung: "existing-organization", disposition: "unavailable", outcome: "unresolved", organization: labFixtureTeamOrganization().id },
    ];
  return {
    gapId: gapId as never,
    cycleId: asLabCycleId(String(cycleId))!,
    missingCapability: "lab-cap-engineering",
    summary: "test gap: the current organization lacks lab-cap-engineering",
    openedAt: asTimestampMs(1_000)!,
    attempts: Object.freeze([...trail]),
  };
}

/** A complete, valid learning submission (every artifact kind present). */
export function testSubmission(over: Partial<LabCycleLearningSubmission> = {}): LabCycleLearningSubmission {
  const ledger = testLedger();
  return {
    tenant: testTenant,
    owner: testOwner,
    cycleId: testCycle,
    sequence: 1,
    observations: ledger.ledger(),
    evaluations: [testRun()],
    searchResults: [testSearchResult()],
    gaps: [testGapRecord()],
    learnedAt: asTimestampMs(2_000)!,
    ...over,
  };
}

/** A second, distinct submission shape (for multi-cycle folds). */
export function secondSubmission(): LabCycleLearningSubmission {
  const cycle = asLabCycleId("cycle-lab-learning-test-2")!;
  const ledger = testLedger(cycle, 2);
  return {
    tenant: testTenant,
    owner: testOwner,
    cycleId: cycle,
    sequence: 2,
    observations: ledger.ledger(),
    evaluations: [testRun({ cycleId: String(cycle), evaluationId: "lab-eval-test-2", completedWork: 9 })],
    searchResults: [
      testSearchResult({ blueprint: testBlueprint({ agentCount: 2, capabilitySpread: "lead-agent", memory: "private-only" }), contentDigest: labFixtureDigest("candidate-test-2") }),
    ],
    gaps: [testGapRecord("gap-test-2", cycle)],
    learnedAt: asTimestampMs(3_000)!,
  };
}

/**
 * A cycle-consistent submission for ANY cycle id + sequence (every artifact
 * is rebuilt pinned to that cycle: ledger, evaluation run, gap record).
 */
export function cycleSubmission(cycleId: string, sequence: number): LabCycleLearningSubmission {
  const cycle = asLabCycleId(cycleId)!;
  const ledger = testLedger(cycle, 1);
  return {
    tenant: testTenant,
    owner: testOwner,
    cycleId: cycle,
    sequence,
    observations: ledger.ledger(),
    evaluations: [testRun({ cycleId, evaluationId: `lab-eval-${cycleId}` })],
    searchResults: [testSearchResult({ contentDigest: labFixtureDigest(`candidate-${cycleId}`) })],
    gaps: [testGapRecord(`gap-${cycleId}`, cycle)],
    learnedAt: asTimestampMs(4_000)!,
  };
}
