/**
 * DEMO LAB WORKBENCH FIXTURE (harness + tests + web preview mount): ONE
 * authoritative `LabDataSnapshot` assembled from the REAL sibling
 * engines — the PL-030 learning journey stack (`createLabLearningJourney`,
 * whose organization service searches and evaluates through the REAL
 * PL-029 compiler/search over the REAL PL-028 simulation engine) plus the
 * PL-031 Arena runtime journey (`createArenaRuntimeJourney`, whose
 * decided escalation is driven through the real lifecycle to `ingested`).
 *
 * TEST-SUPPORT / DEMO FIXTURE ONLY (lock rule 44): nothing here is a
 * production integration. Every Lab object is REAL sibling-package data:
 * two learned cycles, immutable evaluation evidence (labeled estimates,
 * E11), derived signals, BOTH guidance epistemic classes, a recurring
 * rung-classified gap summary, and an ingested Arena case.
 *
 * One deliberately confused row: a search session of ANOTHER tenant is
 * included so the R20 tenancy guard (the store's typed cross-tenant
 * selection refusal) is visible and testable — the demo HOST assembled a
 * mixed-tenant snapshot on purpose; a production host returns
 * viewer-scoped read models.
 *
 * Async because the Arena lifecycle drive is await-based; the result is
 * a plain frozen data snapshot afterwards. No IO, no wall clock, no
 * randomness (E9 — the fixed clock of the journey stacks).
 */

import {
  asAgentRoleId,
  asCapabilityId,
  asEvaluationSeed,
  asLabCycleId,
  asTimestampMs,
  asZCodeModelRouteId,
} from "../../../../lab-contracts/src/index.ts";
import {
  evidenceBundleDigestOf,
  labFixtureContext,
  labFixtureEvidenceRecords,
  labFixtureGeneralistOrganization,
  labFixtureObservation,
  labFixtureSuite,
} from "../../../../lab-simulation/src/index.ts";
import type {
  OrganizationSearchRequest,
  SearchedCandidate,
  SearchCursor,
} from "../../../../lab-organization/src/index.ts";
import { createLabLearningJourney } from "../../../../lab-learning/src/index.ts";
import type { LabCycleLearningSubmission } from "../../../../lab-learning/src/index.ts";
import { arenaAuthorizationScope } from "../../../../arena-integration/src/index.ts";
import { createArenaRuntimeJourney } from "../../../../arena-integration-runtime/src/index.ts";
import { asSubjectId, asTenantId } from "../../../../platform-contracts/src/index.ts";
import type { LabDataSnapshot } from "../view/lab-view.ts";

/** The demo read model's viewer (tenant scope, R20). */
export const DEMO_LAB_TENANT = asTenantId("tenant-lab-demo")!;
export const DEMO_LAB_SUBJECT = asSubjectId("subject-lab-lead")!;
/** The confused-host foreign tenant (see module docs). */
export const DEMO_LAB_FOREIGN_TENANT = asTenantId("tenant-b-demo")!;
export const DEMO_LAB_FOREIGN_SUBJECT = asSubjectId("subject-foreign")!;

const cycleOne = asLabCycleId("cycle-lab-demo-1")!;
const cycleTwo = asLabCycleId("cycle-lab-demo-2")!;
const caller = { tenant: DEMO_LAB_TENANT, subject: DEMO_LAB_SUBJECT };
const foreign = { tenant: DEMO_LAB_FOREIGN_TENANT, subject: DEMO_LAB_FOREIGN_SUBJECT };

const evidence = labFixtureEvidenceRecords();
const evidenceBundle = {
  recordIds: evidence.map((record) => String(record.evidenceId)),
  declaredDigest: evidenceBundleDigestOf(evidence),
};
const suite = labFixtureSuite().ref;
const parameters = { seed: asEvaluationSeed("seed-lab-demo-evaluation")!, tickBudget: 12 };

function searchRequest(
  cycleId: string,
  seed: string,
  maxAgents: number,
  as: typeof caller,
): OrganizationSearchRequest {
  return {
    tenant: as.tenant,
    owner: as.subject,
    cycleId: asLabCycleId(cycleId)!,
    context: labFixtureContext(),
    bounds: {
      maxAgents,
      roleVocabulary: [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!],
      bodyCatalog: [],
      modelCatalog: [
        { authority: "zcode-model-routing", route: asZCodeModelRouteId("route-lab-demo-a")! },
      ],
      toolCatalog: [],
      capabilityVocabulary: [asCapabilityId("lab-cap-engineering")!],
    },
    seed: asEvaluationSeed(seed)!,
    currentOrganization: labFixtureGeneralistOrganization(),
    requestedAt: asTimestampMs(1_000)!,
  };
}

function pageAll(
  organization: ReturnType<typeof createLabLearningJourney>["organization"],
  searchId: string,
  first: SearchCursor,
): readonly SearchedCandidate[] {
  const collected: SearchedCandidate[] = [];
  let cursor: SearchCursor | undefined = first;
  let done = false;
  while (cursor !== undefined && !done) {
    const page = organization.nextCandidates({ searchId, cursor, limit: 64, as: caller });
    if (!page.ok) return collected;
    collected.push(...page.candidates);
    done = page.done;
    cursor = page.nextCursor;
  }
  return collected;
}

function spreadPosition(candidates: readonly SearchedCandidate[], nth: number): number {
  let seen = 0;
  for (const candidate of candidates) {
    if (candidate.blueprint?.capabilitySpread === undefined || candidate.blueprint.capabilitySpread === "none") {
      continue;
    }
    seen += 1;
    if (seen === nth) return candidate.position;
  }
  return -1;
}

/** Assemble the demo Lab read-model snapshot from the REAL engines. */
export async function demoLabSnapshot(): Promise<LabDataSnapshot> {
  const observations = [
    labFixtureObservation("observation-lab-demo-1", cycleOne),
    labFixtureObservation("observation-lab-demo-2", cycleTwo),
  ];
  const stack = createLabLearningJourney({ observations });

  const submission = (
    cycleId: string,
    sequence: number,
    evaluations: readonly unknown[],
    searchResults: readonly SearchedCandidate[],
  ): LabCycleLearningSubmission => ({
    tenant: caller.tenant,
    owner: caller.subject,
    cycleId: asLabCycleId(cycleId)!,
    sequence,
    observations: stack.observations.ledger(),
    evaluations: evaluations as LabCycleLearningSubmission["evaluations"],
    searchResults,
    gaps: [...stack.organization.listCapabilityGaps(caller)],
    learnedAt: asTimestampMs(stack.clock.now())!,
  });

  // --- Cycle 1: search -> evaluate (estimates, E11) -> calibrate -> learn ---
  const openedOne = stack.organization.openSearch(
    searchRequest(String(cycleOne), "seed-lab-demo-search-1", 2, caller),
  );
  if (!openedOne.ok) throw new Error(`demo: search 1 refused: ${openedOne.detail}`);
  const streamOne = pageAll(stack.organization, openedOne.searchId, openedOne.cursor);
  const baselinePosition = streamOne.find((candidate) => candidate.isBaseline)?.position ?? -1;
  const spreadOne = spreadPosition(streamOne, 1);
  const evaluatedBaseline = stack.organization.evaluateCandidate({
    searchId: openedOne.searchId,
    position: baselinePosition,
    suite,
    evidence: evidenceBundle,
    parameters,
    as: caller,
  });
  if (!evaluatedBaseline.ok) throw new Error(`demo: baseline evaluation refused: ${evaluatedBaseline.detail}`);
  const evaluatedSpread = stack.organization.evaluateCandidate({
    searchId: openedOne.searchId,
    position: spreadOne,
    suite,
    evidence: evidenceBundle,
    parameters,
    as: caller,
  });
  if (!evaluatedSpread.ok) throw new Error(`demo: spread evaluation refused: ${evaluatedSpread.detail}`);
  const calibrated = stack.simulation.calibrate({
    evaluationId: evaluatedBaseline.evidence.evaluationId,
    as: caller,
    observedOutcomeIds: ["observation-lab-demo-1"],
  });
  if (calibrated.ok) {
    const appended = stack.observations.appendConclusion(calibrated.conclusion);
    if (!appended.ok) throw new Error(`demo: conclusion append refused: ${appended}`);
  }
  const runsOne = [evaluatedBaseline.evidence.run, evaluatedSpread.evidence.run];
  const learnedOne = stack.learning.learnCycle(submission(String(cycleOne), 1, runsOne, streamOne.slice(0, 12)));
  if (!learnedOne.ok) throw new Error(`demo: learn 1 refused: ${learnedOne.detail}`);

  // Advance the discovered gap ONE rung (the honest autonomous attempt).
  const gapIdOne = String(evaluatedSpread.gapFindings[0]?.gapId ?? "");
  const advanced = stack.organization.advanceCapabilityGap({
    gapId: gapIdOne,
    attempt: { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" },
    as: caller,
  });
  if (!advanced.ok) throw new Error(`demo: gap advance refused: ${advanced.detail}`);

  const signals = stack.learning.deriveSignals(caller);
  if (!signals.ok) throw new Error(`demo: signals refused: ${signals.detail}`);
  const guidanceObserved = stack.learning.deriveSearchGuidance(caller, { mode: "observed-only" });
  if (!guidanceObserved.ok) throw new Error(`demo: observed guidance refused: ${guidanceObserved.detail}`);
  const guidanceEstimate = stack.learning.deriveSearchGuidance(caller, { mode: "with-estimates" });
  if (!guidanceEstimate.ok) throw new Error(`demo: estimate guidance refused: ${guidanceEstimate.detail}`);

  // --- Cycle 2: the guidance parameterizes the next search (R16/R17) -------
  const agentsPreferred = Number(
    guidanceObserved.guidance.dimensionAdjustments.find((adjustment) => adjustment.dimension === "agents")
      ?.preferredValues[0] ?? 2,
  );
  const openedTwo = stack.organization.openSearch(
    searchRequest(String(cycleTwo), guidanceEstimate.guidance.seedHint, agentsPreferred, caller),
  );
  if (!openedTwo.ok) throw new Error(`demo: search 2 refused: ${openedTwo.detail}`);
  const streamTwo = pageAll(stack.organization, openedTwo.searchId, openedTwo.cursor);
  const evaluatedTwo = stack.organization.evaluateCandidate({
    searchId: openedTwo.searchId,
    position: spreadPosition(streamTwo, 1),
    suite,
    evidence: evidenceBundle,
    parameters,
    as: caller,
  });
  if (!evaluatedTwo.ok) throw new Error(`demo: cycle 2 evaluation refused: ${evaluatedTwo.detail}`);
  const learnedTwo = stack.learning.learnCycle(
    submission(String(cycleTwo), 2, [evaluatedTwo.evidence.run], streamTwo.slice(0, 12)),
  );
  if (!learnedTwo.ok) throw new Error(`demo: learn 2 refused: ${learnedTwo.detail}`);

  // --- The confused-host foreign search (R20 guard demo; see module docs) --
  const openedForeign = stack.organization.openSearch(
    searchRequest("cycle-tenant-b", "seed-lab-demo-foreign", 2, foreign),
  );
  if (!openedForeign.ok) throw new Error(`demo: foreign search refused: ${openedForeign.detail}`);

  // --- One decided Arena escalation, driven to `ingested` (R18/E10/E11) ----
  const arenaJourney = createArenaRuntimeJourney({ tenant: "tenant-lab-demo", requestKind: "artifact.skill" });
  const arenaCase = arenaJourney.service.openEscalationCase(
    arenaJourney.caller,
    arenaJourney.decidedCommand({ authorization: arenaAuthorizationScope(["skill"]) }),
  );
  if (!arenaCase.ok) throw new Error(`demo: arena case refused: ${arenaCase.detail}`);
  const driven = await arenaJourney.service.driveCase(arenaJourney.caller, String(arenaCase.case.caseId));
  if (!driven.ok || driven.outcome.status !== "ingested") {
    throw new Error(`demo: arena drive did not ingest: ${driven.ok ? driven.outcome.status : driven.detail}`);
  }

  // --- Read the assembled state back through the public read doors ---------
  const document = stack.organization.document();
  return {
    viewer: caller,
    searches: document.searches,
    candidateStreams: {
      [openedOne.searchId]: streamOne,
      [openedTwo.searchId]: streamTwo,
    },
    evidence: document.evidence,
    learningRecords: stack.learning.listLearningCycles(caller),
    signals: signals.signals,
    guidance: [guidanceObserved.guidance, guidanceEstimate.guidance],
    gapSummaries: stack.learning.summarizeGaps(caller),
    arenaCases: [driven.outcome.case],
  } satisfies LabDataSnapshot;
}
