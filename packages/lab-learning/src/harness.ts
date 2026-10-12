/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full Lab learning journey over the REAL engines (the wired
 * PL-029 organization service searching + evaluating through the REAL
 * PL-028 simulation service): open a seeded search -> page the candidate
 * stream -> evaluate the generalist baseline and a capability-spread
 * candidate (labeled estimates, E11) -> derive + append the calibration
 * conclusion (the PL-028 seam) -> LEARN the cycle into a sealed,
 * content-addressed record -> identical re-submission returns the E10
 * duplicate receipt (one stored record) -> deterministic signals (E9:
 * two derivations, identical state digest; dimension affinities over the
 * searched tuples x the observed outcomes) -> recurring gap summaries
 * (R18: rung-classified, recurrence counts, one rung advanced through
 * lab-organization's own ladder door) -> search guidance (observed-only
 * class; estimate class with method+basis; the derived seed hint) -> the
 * guidance PARAMETERIZES the next lab-organization search request, which
 * is admitted (cycle 2) -> cycle 2 is learned -> the gap summary recurs
 * (recurrence 2) -> marker verification matches; a stripped marker is
 * refused (E11) -> negatives: non-monotonic sequence, conflicting cycle
 * content, cross-tenant read, estimate-label forgery, tampered restore ->
 * empty-state guidance is a typed baseline, not an exception ->
 * persistence restore round-trip (E6). Prints deterministic
 * machine-readable JSON and exits non-zero on any unexpected outcome. No
 * IO beyond stdout; no wall clock, no randomness, no network.
 */

import {
  asAgentRoleId,
  asCapabilityId,
  asEvaluationSeed,
  asLabCycleId,
  asTimestampMs,
  asZCodeModelRouteId,
} from "@playliquid/lab-contracts";
import type { GapRungAttempt, ObservedOutcomeRecord } from "@playliquid/lab-contracts";
import {
  evidenceBundleDigestOf,
  labFixtureContext,
  labFixtureEvidenceRecords,
  labFixtureGeneralistOrganization,
  labFixtureObservation,
  labFixtureSuite,
} from "@playliquid/lab-simulation";
import type { LabEvaluationRunRecord } from "@playliquid/lab-simulation";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { OrganizationSearchRequest, SearchedCandidate, SearchCursor } from "@playliquid/lab-organization";
import { LabLearningService } from "./service.ts";
import type { LabCycleLearningSubmission } from "./records.ts";
import { createLabLearningJourney, createLearningStore } from "./fakes.ts";

const tenant = asTenantId("tenant-harness")!;
const owner = asSubjectId("subject-lab-learning-lead")!;
const otherTenant = asTenantId("tenant-other")!;
const stranger = asSubjectId("subject-stranger")!;
const caller = { tenant, subject: owner };
const foreign = { tenant: otherTenant, subject: stranger };
const cycleOne = asLabCycleId("cycle-harness-1")!;
const cycleTwo = asLabCycleId("cycle-harness-2")!;
const evidence = labFixtureEvidenceRecords();
const evidenceBundle = {
  recordIds: evidence.map((record) => String(record.evidenceId)),
  declaredDigest: evidenceBundleDigestOf(evidence),
};
const suite = labFixtureSuite().ref;
const parameters = { seed: asEvaluationSeed("seed-harness-learning")!, tickBudget: 12 };

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

const observations: readonly ObservedOutcomeRecord[] = [
  labFixtureObservation("observation-harness-1", cycleOne),
  labFixtureObservation("observation-harness-2", cycleTwo),
];
const stack = createLabLearningJourney({ observations });

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
      modelCatalog: [{ authority: "zcode-model-routing", route: asZCodeModelRouteId("route-lab-learning-a")! }],
      toolCatalog: [],
      capabilityVocabulary: [asCapabilityId("lab-cap-engineering")!],
    },
    seed: asEvaluationSeed(seed)!,
    currentOrganization: labFixtureGeneralistOrganization(),
    requestedAt: asTimestampMs(1_000)!,
  };
}

function pageAll(searchId: string, first: SearchCursor): readonly SearchedCandidate[] {
  const collected: SearchedCandidate[] = [];
  let cursor: SearchCursor | undefined = first;
  let done = false;
  while (cursor !== undefined && !done) {
    const page = stack.organization.nextCandidates({ searchId, cursor, limit: 64, as: caller });
    if (!page.ok) {
      record("page-stream", "ok", `refused:${page.code}`);
      return collected;
    }
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
  cycleId: string,
  sequence: number,
  evaluations: readonly LabEvaluationRunRecord[],
  searchResults: readonly SearchedCandidate[],
): LabCycleLearningSubmission {
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

// --- Cycle 1: search -> evaluate -> calibrate -> learn ----------------------
const openedOne = stack.organization.openSearch(searchRequest(String(cycleOne), "seed-harness-search-1", 2));
record("open-search-1", "ok", openedOne.ok ? "ok" : `refused:${openedOne.code}`);
const searchIdOne = openedOne.ok ? openedOne.searchId : "";
const stream = openedOne.ok ? pageAll(searchIdOne, openedOne.cursor) : [];
record("stream-paged", "true", String(stream.length > 0));
const baselinePosition = stream.find((candidate) => candidate.isBaseline)?.position ?? -1;
const spreadOne = spreadPosition(stream, 1);
record("baseline-and-spread-found", "true", String(baselinePosition >= 0 && spreadOne >= 0));

const evaluatedBaseline = stack.organization.evaluateCandidate({ searchId: searchIdOne, position: baselinePosition, suite, evidence: evidenceBundle, parameters, as: caller });
record("evaluate-baseline", "ok", evaluatedBaseline.ok ? "ok" : `refused:${evaluatedBaseline.code}`);
record("estimate-labeled", "labeled-estimate", evaluatedBaseline.ok ? evaluatedBaseline.evidence.run.result.epistemic : "missing");
const evaluatedSpread = stack.organization.evaluateCandidate({ searchId: searchIdOne, position: spreadOne, suite, evidence: evidenceBundle, parameters, as: caller });
record("evaluate-spread", "ok", evaluatedSpread.ok ? "ok" : `refused:${evaluatedSpread.code}`);
record("gap-finding-recorded", "1", String(evaluatedSpread.ok ? evaluatedSpread.gapFindings.length : -1));

const calibrated = evaluatedBaseline.ok
  ? stack.simulation.calibrate({ evaluationId: evaluatedBaseline.evidence.evaluationId, as: caller, observedOutcomeIds: ["observation-harness-1"] })
  : { ok: false as const, code: "no-baseline" as const, detail: "" };
record("calibrate-cycle-1", "ok", calibrated.ok ? "ok" : `refused:${calibrated.code}`);
if (calibrated.ok) {
  const appended = stack.observations.appendConclusion(calibrated.conclusion);
  record("conclusion-appended", "true", String(appended.ok));
}

const runsOne = [evaluatedBaseline, evaluatedSpread].flatMap((result) => (result.ok ? [result.evidence.run] : []));
const learnedOne = stack.learning.learnCycle(submission(String(cycleOne), 1, runsOne, stream.slice(0, 12)));
record("learn-cycle-1", "ok", learnedOne.ok ? "ok" : `refused:${learnedOne.code}`);
const learnedAgain = stack.learning.learnCycle(submission(String(cycleOne), 1, runsOne, stream.slice(0, 12)));
record("duplicate-receipt", "true", String(learnedAgain.ok && learnedAgain.duplicate && learnedOne.ok && learnedAgain.record.recordId === learnedOne.record.recordId));
record("one-record-stored", "1", String(stack.learning.listLearningCycles(caller).length));

const signalsOne = stack.learning.deriveSignals(caller);
record("signals-derived", "ok", signalsOne.ok ? "ok" : "refused");
record("signals-affinities", "true", String(signalsOne.ok && signalsOne.signals.affinities.length > 0));
const signalsAgain = stack.learning.deriveSignals(caller);
record("signals-deterministic", "true", String(signalsOne.ok && signalsAgain.ok && String(signalsOne.signals.stateDigest) === String(signalsAgain.signals.stateDigest)));

const gapIdOne = evaluatedSpread.ok ? String(evaluatedSpread.gapFindings[0]?.gapId ?? "") : "";
const advanceAttempt: GapRungAttempt = { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" };
const advanced = stack.organization.advanceCapabilityGap({ gapId: gapIdOne, attempt: advanceAttempt, as: caller });
record("gap-advanced-one-rung", "ok", advanced.ok ? "ok" : `refused:${advanced.code}`);

const guidanceObserved = stack.learning.deriveSearchGuidance(caller, { mode: "observed-only" });
record("guidance-observed", "observed-evidence", guidanceObserved.ok ? guidanceObserved.guidance.epistemic : "refused");
record("guidance-adjustments", "true", String(guidanceObserved.ok && guidanceObserved.guidance.dimensionAdjustments.length > 0));
const guidanceEstimate = stack.learning.deriveSearchGuidance(caller, { mode: "with-estimates" });
record(
  "guidance-estimate",
  "labeled-estimate:simulation",
  guidanceEstimate.ok && guidanceEstimate.guidance.epistemic === "labeled-estimate"
    ? `${guidanceEstimate.guidance.epistemic}:${guidanceEstimate.guidance.method}`
    : "refused",
);
record("guidance-estimate-support", "true", String(guidanceEstimate.ok && guidanceEstimate.guidance.epistemic === "labeled-estimate" && guidanceEstimate.guidance.estimateSupport.length > 0));
const verified = stack.learning.verifyGuidance(caller, { mode: "with-estimates", guidance: guidanceEstimate.ok ? guidanceEstimate.guidance : null });
record("guidance-verifies", "matches", verified.ok && verified.matches ? "matches" : "no-match");
const stripped = guidanceEstimate.ok ? { ...guidanceEstimate.guidance, epistemic: "observed-evidence" as const } : null;
const strippedCheck = stripped === null ? undefined : stack.learning.verifyGuidance(caller, { mode: "with-estimates", guidance: stripped });
record("stripped-marker-refused", "refused:guidance-marker-forged", strippedCheck === undefined ? "no-guidance" : strippedCheck.ok ? "unexpected-ok" : `refused:${strippedCheck.code}`);

// --- Cycle 2: the guidance parameterizes the next search -------------------
const agentsPreferred = guidanceObserved.ok
  ? Number(guidanceObserved.guidance.dimensionAdjustments.find((adjustment) => adjustment.dimension === "agents")?.preferredValues[0] ?? 2)
  : 2;
const seedHint = guidanceEstimate.ok ? guidanceEstimate.guidance.seedHint : "seed-harness-search-2";
const openedTwo = stack.organization.openSearch(searchRequest(String(cycleTwo), seedHint, agentsPreferred));
record("open-search-2-guided", "ok", openedTwo.ok ? "ok" : `refused:${openedTwo.code}`);
const streamTwo = openedTwo.ok ? pageAll(openedTwo.searchId, openedTwo.cursor) : [];
const spreadCycleTwo = spreadPosition(streamTwo, 1);
const evaluatedTwo = stack.organization.evaluateCandidate({ searchId: openedTwo.ok ? openedTwo.searchId : "", position: spreadCycleTwo, suite, evidence: evidenceBundle, parameters, as: caller });
record("evaluate-cycle-2-spread", "ok", evaluatedTwo.ok ? "ok" : `refused:${evaluatedTwo.code}`);

const learnedTwo = stack.learning.learnCycle(submission(String(cycleTwo), 2, evaluatedTwo.ok ? [evaluatedTwo.evidence.run] : [], streamTwo.slice(0, 12)));
record("learn-cycle-2", "ok", learnedTwo.ok ? "ok" : `refused:${learnedTwo.code}`);
const summaries = stack.learning.summarizeGaps(caller);
const recurring = summaries.find((summary) => summary.missingCapability === "lab-cap-engineering");
record("gap-recurrence", "2", String(recurring?.recurrenceCount ?? 0));
record("gap-recurring-classified", "true", String(recurring?.recurring === true && recurring.cycleIds.length === 2));
record("gap-current-rung", "alternate-organization", String(recurring?.currentRung ?? "none"));
record("gap-not-auto-escalated", "false", String(recurring?.currentRung === "arena-escalation" || recurring?.currentRung === "blocked"));

// --- Negatives --------------------------------------------------------------
const nonMonotonic = stack.learning.learnCycle(submission("cycle-harness-3", 1, [], stream.slice(0, 3)));
record("non-monotonic-refused", "refused:non-monotonic-cycle-order", nonMonotonic.ok ? "unexpected-ok" : `refused:${nonMonotonic.code}`);
const conflicting = stack.learning.learnCycle(submission(String(cycleOne), 3, [], stream.slice(0, 3)));
record("conflicting-content-refused", "refused:conflicting-cycle-content", conflicting.ok ? "unexpected-ok" : `refused:${conflicting.code}`);
const crossRead = learnedOne.ok ? stack.learning.getLearningCycle(learnedOne.record.recordId, foreign) : undefined;
record("cross-tenant-refused", "refused:cross-tenant", crossRead !== undefined && !crossRead.ok ? `refused:${crossRead.code}` : "unexpected-ok");
const forgedRun = evaluatedBaseline.ok
  ? ({
      ...evaluatedBaseline.evidence.run,
      cycleId: asLabCycleId("cycle-harness-4")!,
      result: { ...evaluatedBaseline.evidence.run.result, epistemic: "observed-evidence" as never },
    } as LabEvaluationRunRecord)
  : undefined;
const forgedLearn = forgedRun === undefined ? undefined : stack.learning.learnCycle(submission("cycle-harness-4", 3, [forgedRun], stream.slice(0, 3)));
record("forged-estimate-refused", "refused:estimate-label-missing", forgedLearn === undefined ? "no-run" : forgedLearn.ok ? "unexpected-ok" : `refused:${forgedLearn.code}`);

const tamperStore = createLearningStore();
const document = stack.learning.document();
const tamperedRecord = learnedOne.ok ? { ...learnedOne.record, outcomes: [{ ...learnedOne.record.outcomes[0]!, summary: "tampered" }] } : undefined;
if (tamperedRecord !== undefined) {
  tamperStore.store.save({ ...document, records: document.records.map((entry) => (entry.recordId === tamperedRecord.recordId ? tamperedRecord : entry)) });
  const tamperedService = new LabLearningService({ ports: { clock: stack.clock.clock, store: tamperStore.store } });
  const restored = tamperedService.restore();
  record("tampered-restore-refused", "refused:tampered-content-digest", restored.ok ? "unexpected-ok" : `refused:${restored.code}`);
}

const emptyService = new LabLearningService({ ports: { clock: stack.clock.clock, store: createLearningStore().store } });
const emptyGuidance = emptyService.deriveSearchGuidance(caller, { mode: "with-estimates" });
record("empty-state-guidance", "observed-evidence:insufficient-evidence", emptyGuidance.ok ? `${emptyGuidance.guidance.epistemic}:${emptyGuidance.guidance.baseline.direction}` : "refused");
const restoredService = new LabLearningService({ ports: { clock: stack.clock.clock, store: stack.learningStore.store } });
const roundTrip = restoredService.restore();
record("restore-round-trip", "2", roundTrip.ok ? String(roundTrip.count) : `refused:${roundTrip.code}`);

const failures = steps.filter((step) => step.expected !== step.actual);
console.log(JSON.stringify({ harness: "lab-learning", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
