/**
 * THE LAB PHASE of the canonical journey (PL-040) — the Game Engineering
 * Lab workbench walked over its REAL public engines:
 *
 * - `createLabLearningJourney` (lab-learning's public journey stack): the
 *   REAL PL-029 organization compiler/search + the REAL PL-028 simulation
 *   engine + the REAL PL-030 learning service, over lab-simulation's own
 *   deterministic fixtures (E9 — fixed clock, fixed seeds);
 * - a TYPED command port (the workbench seam, the qa/browser precedent):
 *   small user intents expand host-side into full requests and reach the
 *   authoritative doors; refusal codes come back VERBATIM (E8), and a
 *   malformed intent is refused BEFORE any domain call;
 * - `runLabLoopCycle`: the complete loop step — request-search → the seeded
 *   candidate stream → evaluate (baseline + spread) → calibrate against the
 *   observed outcome → learn/seal the cycle's artifacts into a learning
 *   record.
 *
 * TEST-SUPPORT RIG (lock rule 44): the deterministic in-memory journey stack
 * the lab packages themselves ship; no production integration implied.
 */

import {
  asEvaluationSeed,
  asLabCycleId,
  asTimestampMs,
} from "../../../packages/lab-contracts/src/index.ts";
import type {
  ArenaEscalationRef,
  GapLadderRung,
  GapRungAttempt,
} from "../../../packages/lab-contracts/src/index.ts";
import {
  evidenceBundleDigestOf,
  labFixtureContext,
  labFixtureEvidenceRecords,
  labFixtureGeneralistOrganization,
  labFixtureObservation,
  labFixtureSuite,
} from "../../../packages/lab-simulation/src/index.ts";
import { createLabLearningJourney } from "../../../packages/lab-learning/src/index.ts";
import type { LabCycleLearningSubmission, LabJourneyStack } from "../../../packages/lab-learning/src/index.ts";
import type {
  GapDoorRefusalCode,
  LabOrganizationCaller,
  OrganizationSearchRequest,
  SearchCursor,
  SearchOpenRefusalCode,
  SearchedCandidate,
} from "../../../packages/lab-organization/src/index.ts";
import {
  CYCLE_A,
  CYCLE_B,
  EVALUATION_SEED,
  EVALUATION_TICK_BUDGET,
  JOURNEY_CAPABILITY,
  JOURNEY_FOREIGN_SUBJECT,
  JOURNEY_FOREIGN_TENANT,
  JOURNEY_MODEL_ROUTE,
  JOURNEY_SUBJECT,
  JOURNEY_TENANT,
  OBSERVATION_A,
  OBSERVATION_B,
  SEARCH_ROLE_VOCABULARY,
  SEARCH_SEED_A,
} from "./ids.ts";

/** One typed user intent of the journey's Lab command port. */
export type LabCommandIntent =
  | { readonly kind: "request-search"; readonly cycleId: string; readonly seed: string; readonly maxAgents: number }
  | {
      readonly kind: "advance-gap-rung";
      readonly gapId: string;
      readonly rung: GapLadderRung;
      readonly disposition: "attempted" | "unavailable" | "declined";
      readonly outcome?: "resolved" | "unresolved";
      readonly external?: ArenaEscalationRef;
    };

/** The refusal vocabulary the port surfaces (the doors', verbatim, + its own). */
export type LabCommandRefusalCode = "invalid-intent" | SearchOpenRefusalCode | GapDoorRefusalCode;

/** The typed receipt of one Lab command intent. */
export type LabCommandReceipt =
  | { readonly ok: true; readonly kind: "search-opened"; readonly searchId: string; readonly size: number; readonly duplicate: boolean }
  | { readonly ok: true; readonly kind: "gap-advanced"; readonly gapId: string; readonly rung: GapLadderRung }
  | { readonly ok: false; readonly code: LabCommandRefusalCode; readonly detail: string };

/** One complete Lab loop cycle's outcome (the walk's host-side evidence). */
export interface LabLoopOutcome {
  readonly searchId: string;
  readonly streamSize: number;
  readonly baselinePosition: number;
  readonly spreadPosition: number;
  readonly evidenceKeys: readonly string[];
  readonly gapIds: readonly string[];
  readonly learnedRecordId: string;
  readonly observationId: string;
}

/** The Lab phase rig: the real stack + caller + typed command port. */
export interface LabPhaseRig {
  readonly stack: LabJourneyStack;
  readonly caller: LabOrganizationCaller;
  readonly foreignCaller: LabOrganizationCaller;
  readonly commandPort: { dispatch(intent: LabCommandIntent): LabCommandReceipt };
  /** Pages one opened search's whole candidate stream in cursor order. */
  pageStream(searchId: string, first: SearchCursor): readonly SearchedCandidate[];
  /** Runs ONE complete loop cycle (search → evaluate → calibrate → learn). */
  runLabLoopCycle(input: { readonly cycleId: string; readonly seed: string; readonly maxAgents: number }): LabLoopOutcome;
}

/** The host-expanded search request of one request-search intent. */
function searchRequestFor(intent: {
  readonly cycleId: string;
  readonly seed: string;
  readonly maxAgents: number;
  readonly as: LabOrganizationCaller;
  readonly now: number;
}): OrganizationSearchRequest {
  return {
    tenant: intent.as.tenant,
    owner: intent.as.subject,
    cycleId: asLabCycleId(intent.cycleId)!,
    context: labFixtureContext(),
    bounds: {
      maxAgents: intent.maxAgents,
      roleVocabulary: [...SEARCH_ROLE_VOCABULARY],
      bodyCatalog: [],
      modelCatalog: [{ authority: "zcode-model-routing", route: JOURNEY_MODEL_ROUTE }],
      toolCatalog: [],
      capabilityVocabulary: [JOURNEY_CAPABILITY],
    },
    seed: asEvaluationSeed(intent.seed)!,
    currentOrganization: labFixtureGeneralistOrganization(),
    requestedAt: asTimestampMs(intent.now)!,
  };
}

/** Narrows one flattened intent into the authoritative rung-attempt union. */
function rungAttemptOf(intent: {
  readonly rung: GapLadderRung;
  readonly disposition: "attempted" | "unavailable" | "declined";
  readonly outcome?: "resolved" | "unresolved";
  readonly external?: ArenaEscalationRef;
}): GapRungAttempt | null {
  if (intent.rung === "blocked") return null; // the terminal rung needs a reason this intent cannot carry
  if (
    intent.rung === "existing-organization" ||
    intent.rung === "alternate-organization" ||
    intent.rung === "package-platform-capability"
  ) {
    if (intent.disposition === "declined") return null; // autonomous rungs attempt or are unavailable
    return {
      rung: intent.rung,
      disposition: intent.disposition,
      ...(intent.outcome === undefined ? {} : { outcome: intent.outcome }),
    };
  }
  if (intent.rung === "arena-escalation" && intent.disposition === "attempted" && intent.external === undefined) {
    return null; // an actual Arena attempt requires the provider-neutral external ref (lock 32)
  }
  return {
    rung: intent.rung,
    disposition: intent.disposition,
    ...(intent.outcome === undefined ? {} : { outcome: intent.outcome }),
    ...(intent.rung === "arena-escalation" && intent.external !== undefined ? { external: intent.external } : {}),
  };
}

/** The observation backing one cycle's calibration (cycle-keyed, fixed). */
function observationOf(cycleId: string): string {
  return cycleId === String(CYCLE_B) ? OBSERVATION_B : OBSERVATION_A;
}

/** The frozen gap-door refusal vocabulary (lab-organization records.ts), for narrowing only. */
const GAP_DOOR_REFUSAL_CODES: readonly string[] = [
  "gap-unknown",
  "cross-tenant",
  "invalid-attempt",
  "arena-first-resort",
  "rung-skip",
  "blocked-is-terminal",
  "gap-already-resolved",
];

/**
 * Narrows the door's widened `string` code into the frozen vocabulary. The
 * VALUE flows through verbatim (E8); an unknown code is a contract defect
 * and fails loudly — never silently passed, never faked.
 */
function gapDoorCodeOf(code: string): GapDoorRefusalCode {
  if (!GAP_DOOR_REFUSAL_CODES.includes(code)) {
    throw new Error(`journey lab: gap door returned an unknown refusal code "${code}" (not the frozen vocabulary)`);
  }
  return code as GapDoorRefusalCode;
}

/** Creates the Lab phase: the real engines, the typed port, the cycle runner. */
export function createJourneyLab(): LabPhaseRig {
  const stack = createLabLearningJourney({
    observations: [labFixtureObservation(OBSERVATION_A, CYCLE_A), labFixtureObservation(OBSERVATION_B, CYCLE_B)],
  });
  const caller: LabOrganizationCaller = { tenant: JOURNEY_TENANT, subject: JOURNEY_SUBJECT };
  const foreignCaller: LabOrganizationCaller = { tenant: JOURNEY_FOREIGN_TENANT, subject: JOURNEY_FOREIGN_SUBJECT };
  const streams = new Map<string, readonly SearchedCandidate[]>();
  const evidence = labFixtureEvidenceRecords();
  const evidenceBundle = {
    recordIds: evidence.map((record) => String(record.evidenceId)),
    declaredDigest: evidenceBundleDigestOf(evidence),
  };
  const suite = labFixtureSuite().ref;

  function pageStream(searchId: string, first: SearchCursor): readonly SearchedCandidate[] {
    const collected: SearchedCandidate[] = [];
    let cursor: SearchCursor | undefined = first;
    let done = false;
    while (cursor !== undefined && !done) {
      const page = stack.organization.nextCandidates({ searchId, cursor, limit: 64, as: caller });
      if (!page.ok) return collected;
      collected.push(...page.candidates);
      done = page.done;
      cursor = page.nextCursor;
    }
    return collected;
  }

  function runLabLoopCycle(input: { readonly cycleId: string; readonly seed: string; readonly maxAgents: number }): LabLoopOutcome {
    const opened = stack.organization.openSearch(searchRequestFor({ ...input, as: caller, now: stack.clock.now() }));
    if (!opened.ok) throw new Error(`journey lab: search refused: ${opened.detail}`);
    stack.clock.advance(10);
    const stream = pageStream(opened.searchId, opened.cursor);
    streams.set(opened.searchId, stream);
    const baselinePosition = stream.find((candidate) => candidate.isBaseline)?.position ?? -1;
    const spreadCandidate = stream.find(
      (candidate) => candidate.blueprint?.capabilitySpread !== undefined && candidate.blueprint.capabilitySpread !== "none",
    );
    const spreadPosition = spreadCandidate?.position ?? -1;
    const evaluatedBaseline = stack.organization.evaluateCandidate({
      searchId: opened.searchId, position: baselinePosition, suite, evidence: evidenceBundle,
      parameters: { seed: EVALUATION_SEED, tickBudget: EVALUATION_TICK_BUDGET }, as: caller,
    });
    if (!evaluatedBaseline.ok) throw new Error(`journey lab: baseline evaluation refused: ${evaluatedBaseline.detail}`);
    const evaluatedSpread = stack.organization.evaluateCandidate({
      searchId: opened.searchId, position: spreadPosition, suite, evidence: evidenceBundle,
      parameters: { seed: EVALUATION_SEED, tickBudget: EVALUATION_TICK_BUDGET }, as: caller,
    });
    if (!evaluatedSpread.ok) throw new Error(`journey lab: spread evaluation refused: ${evaluatedSpread.detail}`);
    stack.clock.advance(10);
    const calibrated = stack.simulation.calibrate({
      evaluationId: evaluatedBaseline.evidence.evaluationId,
      as: caller,
      observedOutcomeIds: [observationOf(input.cycleId)],
    });
    if (calibrated.ok) {
      const appended = stack.observations.appendConclusion(calibrated.conclusion);
      if (!appended.ok) throw new Error(`journey lab: conclusion append refused: ${String(appended)}`);
    }
    const runs = [evaluatedBaseline.evidence.run, evaluatedSpread.evidence.run];
    const submission: LabCycleLearningSubmission = {
      tenant: JOURNEY_TENANT,
      owner: JOURNEY_SUBJECT,
      cycleId: asLabCycleId(input.cycleId)!,
      sequence: stack.learning.listLearningCycles(caller).length + 1,
      observations: stack.observations.ledger(),
      evaluations: runs as LabCycleLearningSubmission["evaluations"],
      searchResults: stream.slice(0, 12),
      gaps: [...stack.organization.listCapabilityGaps(caller)],
      learnedAt: asTimestampMs(stack.clock.now())!,
    };
    const learned = stack.learning.learnCycle(submission);
    if (!learned.ok) throw new Error(`journey lab: learn refused: ${learned.detail}`);
    stack.clock.advance(10);
    return {
      searchId: opened.searchId,
      streamSize: stream.length,
      baselinePosition,
      spreadPosition,
      evidenceKeys: [String(evaluatedBaseline.evidence.contentKey), String(evaluatedSpread.evidence.contentKey)],
      gapIds: evaluatedSpread.gapFindings.map((finding) => String(finding.gapId)),
      learnedRecordId: String(learned.record.recordId),
      observationId: observationOf(input.cycleId),
    };
  }

  // The typed command port: intents → the authoritative doors (E8 verbatim;
  // malformed intents are refused BEFORE any domain call). The port speaks
  // for the journey's own caller — cross-tenant attempts go to the SERVICE
  // doors directly (the R20 negatives, the real authority).
  const commandPort = {
    dispatch(intent: LabCommandIntent): LabCommandReceipt {
      if (intent.kind === "request-search") {
        if (!Number.isInteger(intent.maxAgents) || intent.maxAgents < 1) {
          return { ok: false, code: "invalid-intent", detail: `maxAgents must be a positive integer, got ${String(intent.maxAgents)}` };
        }
        const opened = stack.organization.openSearch(searchRequestFor({ ...intent, as: caller, now: stack.clock.now() }));
        if (!opened.ok) return { ok: false, code: opened.code, detail: opened.detail };
        stack.clock.advance(10);
        streams.set(opened.searchId, pageStream(opened.searchId, opened.cursor));
        return { ok: true, kind: "search-opened", searchId: opened.searchId, size: opened.size, duplicate: opened.duplicate };
      }
      if (intent.kind === "advance-gap-rung") {
        const attempt = rungAttemptOf(intent);
        if (attempt === null) {
          return {
            ok: false,
            code: "invalid-intent",
            detail: `rung ${intent.rung} cannot take disposition ${intent.disposition} through this intent (the authoritative rung-attempt union rejects it)`,
          };
        }
        const advanced = stack.organization.advanceCapabilityGap({ gapId: intent.gapId, attempt, as: caller });
        if (!advanced.ok) return { ok: false, code: gapDoorCodeOf(advanced.code), detail: advanced.detail };
        return { ok: true, kind: "gap-advanced", gapId: intent.gapId, rung: intent.rung };
      }
      return { ok: false, code: "invalid-intent", detail: `unknown intent kind ${String((intent as { kind?: string }).kind)}` };
    },
  };

  return { stack, caller, foreignCaller, commandPort, pageStream, runLabLoopCycle };
}

/** The first request-search intent the canonical journey dispatches. */
export function initialSearchIntent(): LabCommandIntent {
  return { kind: "request-search", cycleId: String(CYCLE_A), seed: SEARCH_SEED_A, maxAgents: 2 };
}
