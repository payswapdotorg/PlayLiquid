/**
 * JOURNEY TESTS (PL-030) — the full Lab learning journey over the REAL
 * engines (fakes.ts wires the PL-029 organization service with the PL-028
 * simulation service as its evaluation port): search → evaluate (labeled
 * estimates) → calibrate → learn → duplicate receipt → signals → recurring
 * gaps (R18) → guidance of both epistemic classes → the guidance
 * parameterizes the NEXT search → cycle 2 is learned → recurrence grows.
 * The estimates consumed here are produced by the true PL-028 engine,
 * never hand-mocked.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asAgentRoleId,
  asCapabilityId,
  asEvaluationSeed,
  asLabCycleId,
  asTimestampMs,
  asZCodeModelRouteId,
} from "@playliquid/lab-contracts";
import type { GapRungAttempt, ObservedOutcomeRecord } from "@playliquid/lab-contracts";
import { evidenceBundleDigestOf, labFixtureContext, labFixtureEvidenceRecords, labFixtureGeneralistOrganization, labFixtureObservation, labFixtureSuite } from "@playliquid/lab-simulation";
import type { LabEvaluationRunRecord } from "@playliquid/lab-simulation";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { OrganizationSearchRequest, SearchedCandidate, SearchCursor } from "@playliquid/lab-organization";
import { createLabLearningJourney } from "./fakes.ts";

const tenant = asTenantId("tenant-journey")!;
const owner = asSubjectId("subject-journey-lead")!;
const caller = { tenant, subject: owner };
const cycleOne = asLabCycleId("cycle-journey-1")!;
const cycleTwo = asLabCycleId("cycle-journey-2")!;
const evidence = labFixtureEvidenceRecords();
const evidenceBundle = { recordIds: evidence.map((record) => String(record.evidenceId)), declaredDigest: evidenceBundleDigestOf(evidence) };
const suite = labFixtureSuite().ref;
const parameters = { seed: asEvaluationSeed("seed-journey-learning")!, tickBudget: 12 };

function searchRequest(cycleId: string, seed: string, maxAgents: number): OrganizationSearchRequest {
  return {
    tenant,
    owner,
    cycleId: asLabCycleId(cycleId)!,
    context: labFixtureContext(),
    bounds: {
      maxAgents,
      roleVocabulary: [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!],
      bodyCatalog: [],
      modelCatalog: [{ authority: "zcode-model-routing", route: asZCodeModelRouteId("route-journey-a")! }],
      toolCatalog: [],
      capabilityVocabulary: [asCapabilityId("lab-cap-engineering")!],
    },
    seed: asEvaluationSeed(seed)!,
    currentOrganization: labFixtureGeneralistOrganization(),
    requestedAt: asTimestampMs(1_000)!,
  };
}

function pageAll(stack: ReturnType<typeof createLabLearningJourney>, searchId: string, first: SearchCursor): readonly SearchedCandidate[] {
  const collected: SearchedCandidate[] = [];
  let cursor: SearchCursor | undefined = first;
  let done = false;
  while (cursor !== undefined && !done) {
    const page = stack.organization.nextCandidates({ searchId, cursor, limit: 64, as: caller });
    assert.ok(page.ok);
    collected.push(...page.candidates);
    done = page.done;
    cursor = page.nextCursor;
  }
  return collected;
}

function spreadPosition(candidates: readonly SearchedCandidate[], nth: number): number {
  let seen = 0;
  for (const candidate of candidates) {
    if (candidate.blueprint?.capabilitySpread === undefined || candidate.blueprint.capabilitySpread === "none") continue;
    seen += 1;
    if (seen === nth) return candidate.position;
  }
  return -1;
}

function submission(
  stack: ReturnType<typeof createLabLearningJourney>,
  cycleId: string,
  sequence: number,
  evaluations: readonly LabEvaluationRunRecord[],
  searchResults: readonly SearchedCandidate[],
) {
  return {
    tenant,
    owner,
    cycleId: asLabCycleId(cycleId)!,
    sequence,
    observations: stack.observations.ledger(),
    evaluations,
    searchResults,
    gaps: [...stack.organization.listCapabilityGaps(caller)],
    learnedAt: asTimestampMs(stack.clock.now())!,
  };
}

test("journey: search → evaluate → calibrate → learn over the real engines", () => {
  const observations: readonly ObservedOutcomeRecord[] = [
    labFixtureObservation("observation-journey-1", cycleOne),
    labFixtureObservation("observation-journey-2", cycleTwo),
  ];
  const stack = createLabLearningJourney({ observations });

  // --- Cycle 1 -------------------------------------------------------------
  const opened = stack.organization.openSearch(searchRequest(String(cycleOne), "seed-journey-search-1", 2));
  assert.ok(opened.ok);
  const stream = pageAll(stack, opened.searchId, opened.cursor);
  assert.ok(stream.length > 0);
  const baselinePosition = stream.find((candidate) => candidate.isBaseline)?.position ?? -1;
  const spreadOne = spreadPosition(stream, 1);
  assert.ok(baselinePosition >= 0 && spreadOne >= 0);

  const baseline = stack.organization.evaluateCandidate({ searchId: opened.searchId, position: baselinePosition, suite, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(baseline.ok);
  assert.equal(baseline.evidence.run.result.epistemic, "labeled-estimate");
  const spread = stack.organization.evaluateCandidate({ searchId: opened.searchId, position: spreadOne, suite, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(spread.ok);
  assert.equal(spread.gapFindings.length, 1);

  const calibrated = stack.simulation.calibrate({ evaluationId: baseline.evidence.evaluationId, as: caller, observedOutcomeIds: ["observation-journey-1"] });
  assert.ok(calibrated.ok);
  const appended = stack.observations.appendConclusion(calibrated.conclusion);
  assert.ok(appended.ok);

  const runsOne = [baseline.evidence.run, spread.evidence.run];
  const learned = stack.learning.learnCycle(submission(stack, String(cycleOne), 1, runsOne, stream.slice(0, 12)));
  assert.ok(learned.ok);
  const relearned = stack.learning.learnCycle(submission(stack, String(cycleOne), 1, runsOne, stream.slice(0, 12)));
  assert.ok(relearned.ok && relearned.duplicate && relearned.record.recordId === learned.record.recordId);
  assert.equal(stack.learning.listLearningCycles(caller).length, 1);

  const signals = stack.learning.deriveSignals(caller);
  assert.ok(signals.ok);
  assert.ok(signals.signals.affinities.length > 0);
  assert.ok(signals.signals.conclusionCount >= 1);
  const signalsAgain = stack.learning.deriveSignals(caller);
  assert.ok(signalsAgain.ok);
  assert.equal(String(signals.signals.stateDigest), String(signalsAgain.signals.stateDigest));

  // --- Guidance + the ladder door (R18) -------------------------------------
  const gapId = String(spread.gapFindings[0]!.gapId);
  const advance: GapRungAttempt = { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" };
  const advanced = stack.organization.advanceCapabilityGap({ gapId, attempt: advance, as: caller });
  assert.ok(advanced.ok);

  const observed = stack.learning.deriveSearchGuidance(caller, { mode: "observed-only" });
  assert.ok(observed.ok);
  assert.equal(observed.guidance.epistemic, "observed-evidence");
  assert.ok(observed.guidance.dimensionAdjustments.length > 0);
  const estimate = stack.learning.deriveSearchGuidance(caller, { mode: "with-estimates" });
  assert.ok(estimate.ok);
  assert.equal(estimate.guidance.epistemic, "labeled-estimate");
  assert.equal(estimate.guidance.method, "simulation");
  const verified = stack.learning.verifyGuidance(caller, { mode: "with-estimates", guidance: estimate.guidance });
  assert.ok(verified.ok && verified.matches);

  // --- Cycle 2: the guidance parameterizes the NEXT search ------------------
  const preferredAgents = Number(observed.guidance.dimensionAdjustments.find((adjustment) => adjustment.dimension === "agents")?.preferredValues[0] ?? 2);
  const openedTwo = stack.organization.openSearch(searchRequest(String(cycleTwo), estimate.guidance.seedHint, preferredAgents));
  assert.ok(openedTwo.ok);
  const streamTwo = pageAll(stack, openedTwo.searchId, openedTwo.cursor);
  const spreadTwo = spreadPosition(streamTwo, 1);
  const evaluatedTwo = stack.organization.evaluateCandidate({ searchId: openedTwo.searchId, position: spreadTwo, suite, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(evaluatedTwo.ok);

  const learnedTwo = stack.learning.learnCycle(submission(stack, String(cycleTwo), 2, [evaluatedTwo.evidence.run], streamTwo.slice(0, 12)));
  assert.ok(learnedTwo.ok);
  const summaries = stack.learning.summarizeGaps(caller);
  const recurring = summaries.find((summary) => summary.missingCapability === "lab-cap-engineering");
  assert.ok(recurring);
  assert.equal(recurring.recurrenceCount, 2);
  assert.equal(recurring.recurring, true);
  assert.equal(recurring.currentRung, "alternate-organization");
  assert.equal(recurring.blocked, false);
});
