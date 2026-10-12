/**
 * LAB JOURNEY RIG — the HOST side of the Game Engineering Lab workbench
 * journey (PL-043): the REAL Lab loop engines and the REAL ports.
 *
 * - The loop engine: `createLabLearningJourney` (lab-learning's public
 *   journey stack) — its organization service searches and evaluates
 *   through the REAL PL-029 compiler/search over the REAL PL-028
 *   simulation engine, and its learning service seals the learned cycles.
 * - The Arena case: `createArenaRuntimeJourney` (arena-integration-
 *   runtime), decided and driven to `ingested`.
 * - `dataPort`: a REAL `LabDataPort` whose `load()` re-reads the services'
 *   read doors (refreshes see the live loop state).
 * - `commandPort`: a REAL `LabCommandPort` forwarding the workbench's
 *   TYPED user intents to the authoritative doors — `request-search` →
 *   `LabOrganizationService.openSearch` (the host expands the small intent
 *   into a full request over its own catalogs) and `advance-gap-rung` →
 *   `advanceCapabilityGap`. Refusal codes come back VERBATIM (E8 — the
 *   authoritative vocabularies, never forked).
 *
 * TEST-SUPPORT RIG (lock rule 44): the Lab packages' own deterministic
 * in-memory journey stack — no production integration implied. Determinism
 * (E9): fixed clock advanced by fixed steps, fixed seeds, content-derived
 * digests; creating the rig twice yields identical trajectories.
 */

import {
  asAgentRoleId,
  asCapabilityId,
  asEvaluationSeed,
  asLabCycleId,
  asTimestampMs,
  asZCodeModelRouteId,
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
import type {
  LabCycleLearningSubmission,
  LabJourneyStack,
} from "../../../packages/lab-learning/src/index.ts";
import type {
  LabOrganizationCaller,
  OrganizationSearchRequest,
  SearchedCandidate,
  SearchCursor,
} from "../../../packages/lab-organization/src/index.ts";
import type { GapLadderRung, GapRungAttempt } from "../../../packages/lab-contracts/src/index.ts";
import type { GapDoorRefusalCode } from "../../../packages/lab-organization/src/index.ts";
import { arenaAuthorizationScope } from "../../../packages/arena-integration/src/index.ts";
import { createArenaRuntimeJourney } from "../../../packages/arena-integration-runtime/src/index.ts";
import type { ArenaEscalationCase } from "../../../packages/arena-integration-runtime/src/index.ts";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
// gameos-lab is reached through the Node-surface adapter (see lab-ui.ts:
// the package entrypoint re-exports .tsx components the Node runner cannot
// load — E11 browser honesty, no bundler here).
import type {
  LabCommandIntent,
  LabCommandPort,
  LabCommandReceipt,
  LabDataPort,
} from "./lab-ui.ts";
import type { LabDataSnapshot } from "./lab-ui.ts";

/** The journey's read-model viewer (tenant scope, R20). */
export const JOURNEY_LAB_TENANT = asTenantId("tenant-lab-journey")!;
export const JOURNEY_LAB_SUBJECT = asSubjectId("subject-lab-journey-lead")!;
/** A second tenant for the R20 cross-tenant refusals. */
export const JOURNEY_LAB_FOREIGN_TENANT = asTenantId("tenant-lab-foreign")!;
export const JOURNEY_LAB_FOREIGN_SUBJECT = asSubjectId("subject-lab-foreign")!;

const caller: LabOrganizationCaller = { tenant: JOURNEY_LAB_TENANT, subject: JOURNEY_LAB_SUBJECT };
const foreign: LabOrganizationCaller = { tenant: JOURNEY_LAB_FOREIGN_TENANT, subject: JOURNEY_LAB_FOREIGN_SUBJECT };
const evidence = labFixtureEvidenceRecords();
const evidenceBundle = {
  recordIds: evidence.map((record) => String(record.evidenceId)),
  declaredDigest: evidenceBundleDigestOf(evidence),
};
const suite = labFixtureSuite().ref;
const parameters = { seed: asEvaluationSeed("seed-lab-journey-evaluation")!, tickBudget: 12 };

/** One Lab loop cycle's full outcome (the host-side walk evidence). */
export interface LabLoopOutcome {
  readonly searchId: string;
  readonly duplicate: boolean;
  readonly streamSize: number;
  readonly baselinePosition: number;
  readonly spreadPosition: number;
  readonly evidenceKeys: readonly string[];
  readonly gapIds: readonly string[];
  readonly learned: boolean;
  readonly learnedRecordId: string;
}

/** The host-expanded search request of one `request-search` intent. */
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
      roleVocabulary: [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!],
      bodyCatalog: [],
      modelCatalog: [
        { authority: "zcode-model-routing", route: asZCodeModelRouteId("route-lab-journey-a")! },
      ],
      toolCatalog: [],
      capabilityVocabulary: [asCapabilityId("lab-cap-journey-engineering")!],
    },
    seed: asEvaluationSeed(intent.seed)!,
    currentOrganization: labFixtureGeneralistOrganization(),
    requestedAt: asTimestampMs(intent.now)!,
  };
}

/** Narrow one flattened intent attempt into the authoritative union shape. */
function rungAttemptOf(intent: {
  readonly rung: GapLadderRung;
  readonly disposition: "attempted" | "unavailable" | "declined";
  readonly outcome?: "resolved" | "unresolved";
}): GapRungAttempt | null {
  if (intent.rung === "blocked") return null; // the terminal rung needs a reason the intent cannot carry
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
  return {
    rung: intent.rung,
    disposition: intent.disposition,
    ...(intent.outcome === undefined ? {} : { outcome: intent.outcome }),
  };
}

/** The frozen gap-door refusal vocabulary (records.ts), for narrowing only. */
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
 * Narrow the door's widened `string` code into the frozen vocabulary. The
 * VALUE flows through verbatim (E8); an unknown code is a contract defect
 * and fails loudly — never silently passed, never faked.
 */
function gapDoorCodeOf(code: string): GapDoorRefusalCode {
  if (!GAP_DOOR_REFUSAL_CODES.includes(code)) {
    throw new Error(`lab journey rig: gap door returned an unknown refusal code "${code}" (not the frozen vocabulary)`);
  }
  return code as GapDoorRefusalCode;
}

/** The complete journey rig: the loop engines + the real UI ports. */
export interface LabJourneyRig {
  readonly stack: LabJourneyStack;
  readonly arenaCase: ArenaEscalationCase;
  readonly dataPort: LabDataPort;
  readonly commandPort: LabCommandPort;
  /** The streams the host paged for each opened search (display grouping). */
  readonly streams: Map<string, readonly SearchedCandidate[]>;
  /** The pages of one search, walked in cursor order (single-use cursors). */
  pageStream(searchId: string, first: SearchCursor): readonly SearchedCandidate[];
  /** Run ONE Lab loop cycle end to end (search → evaluate → learn). */
  runLabLoopCycle(input: { readonly cycleId: string; readonly seed: string; readonly maxAgents: number }): LabLoopOutcome;
  /** The current read-model snapshot, read through the services' doors. */
  snapshot(): LabDataSnapshot;
}

/** Create the complete Lab journey rig (deterministic, E9). */
export async function createLabJourneyRig(cycleIds: readonly string[]): Promise<LabJourneyRig> {
  const stack = createLabLearningJourney({
    observations: cycleIds.map((cycleId, index) =>
      labFixtureObservation(`observation-lab-journey-${index + 1}`, asLabCycleId(cycleId)!),
    ),
  });
  const streams = new Map<string, readonly SearchedCandidate[]>();
  const learningCaller = { tenant: JOURNEY_LAB_TENANT, subject: JOURNEY_LAB_SUBJECT };

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
    const opened = stack.organization.openSearch(
      searchRequestFor({ ...input, as: caller, now: stack.clock.now() }),
    );
    if (!opened.ok) throw new Error(`lab journey rig: search refused: ${opened.detail}`);
    stack.clock.advance(10);
    const stream = pageStream(opened.searchId, opened.cursor);
    streams.set(opened.searchId, stream);
    const baselinePosition = stream.find((candidate) => candidate.isBaseline)?.position ?? -1;
    const spreadCandidate = stream.find(
      (candidate) => candidate.blueprint?.capabilitySpread !== undefined && candidate.blueprint.capabilitySpread !== "none",
    );
    const spreadPosition = spreadCandidate?.position ?? -1;
    const evaluatedBaseline = stack.organization.evaluateCandidate({
      searchId: opened.searchId,
      position: baselinePosition,
      suite,
      evidence: evidenceBundle,
      parameters,
      as: caller,
    });
    if (!evaluatedBaseline.ok) throw new Error(`lab journey rig: baseline evaluation refused: ${evaluatedBaseline.detail}`);
    const evaluatedSpread = stack.organization.evaluateCandidate({
      searchId: opened.searchId,
      position: spreadPosition,
      suite,
      evidence: evidenceBundle,
      parameters,
      as: caller,
    });
    if (!evaluatedSpread.ok) throw new Error(`lab journey rig: spread evaluation refused: ${evaluatedSpread.detail}`);
    stack.clock.advance(10);
    const calibrated = stack.simulation.calibrate({
      evaluationId: evaluatedBaseline.evidence.evaluationId,
      as: caller,
      observedOutcomeIds: [`observation-lab-journey-${cycleIds.indexOf(input.cycleId) + 1}`],
    });
    if (calibrated.ok) {
      const appended = stack.observations.appendConclusion(calibrated.conclusion);
      if (!appended.ok) throw new Error(`lab journey rig: conclusion append refused: ${String(appended)}`);
    }
    const runs = [evaluatedBaseline.evidence.run, evaluatedSpread.evidence.run];
    const submission: LabCycleLearningSubmission = {
      tenant: learningCaller.tenant,
      owner: learningCaller.subject,
      cycleId: asLabCycleId(input.cycleId)!,
      sequence: stack.learning.listLearningCycles(learningCaller).length + 1,
      observations: stack.observations.ledger(),
      evaluations: runs as LabCycleLearningSubmission["evaluations"],
      searchResults: stream.slice(0, 12),
      gaps: [...stack.organization.listCapabilityGaps(caller)],
      learnedAt: asTimestampMs(stack.clock.now())!,
    };
    const learned = stack.learning.learnCycle(submission);
    if (!learned.ok) throw new Error(`lab journey rig: learn refused: ${learned.detail}`);
    stack.clock.advance(10);
    return {
      searchId: opened.searchId,
      duplicate: opened.duplicate,
      streamSize: stream.length,
      baselinePosition,
      spreadPosition,
      evidenceKeys: [String(evaluatedBaseline.evidence.contentKey), String(evaluatedSpread.evidence.contentKey)],
      gapIds: evaluatedSpread.gapFindings.map((finding) => String(finding.gapId)),
      learned: true,
      learnedRecordId: String(learned.record.recordId),
    };
  }

  // The command port: typed intents → the authoritative doors (E8 verbatim).
  const commandPort: LabCommandPort = {
    dispatch(intent: LabCommandIntent): LabCommandReceipt {
      if (intent.kind === "request-search") {
        if (!Number.isInteger(intent.maxAgents) || intent.maxAgents < 1) {
          return {
            ok: false,
            code: "invalid-intent",
            detail: `maxAgents must be a positive integer, got ${String(intent.maxAgents)}`,
          };
        }
        const opened = stack.organization.openSearch(
          searchRequestFor({ ...intent, as: caller, now: stack.clock.now() }),
        );
        if (!opened.ok) return { ok: false, code: opened.code, detail: opened.detail };
        stack.clock.advance(10);
        streams.set(opened.searchId, pageStream(opened.searchId, opened.cursor));
        return {
          ok: true,
          kind: "search-opened",
          searchId: opened.searchId,
          size: opened.size,
          spaceDigest: String(opened.spaceDigest),
          position: opened.position,
          duplicate: opened.duplicate,
        };
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
        const attempted = stack.organization.advanceCapabilityGap({
          gapId: intent.gapId,
          attempt,
          as: { tenant: intent.tenant, subject: intent.subject },
        });
        if (!attempted.ok) return { ok: false, code: gapDoorCodeOf(attempted.code), detail: attempted.detail };
        return { ok: true, kind: "gap-advanced", gapId: intent.gapId, rung: intent.rung, duplicate: false };
      }
      return { ok: false, code: "invalid-intent", detail: `unknown intent kind ${String((intent as { kind?: string }).kind)}` };
    },
  };

  // The data port: every load() re-reads the live read doors.
  const dataPort: LabDataPort = {
    load(): ReturnType<LabDataPort["load"]> {
      return { ok: true, data: rig.snapshot() };
    },
  };

  // One decided + ingested Arena escalation case (R18; E10/E11).
  const arenaJourney = createArenaRuntimeJourney({
    tenant: String(JOURNEY_LAB_TENANT),
    requestKind: "artifact.skill",
  });
  const arenaCaseOpened = arenaJourney.service.openEscalationCase(
    arenaJourney.caller,
    arenaJourney.decidedCommand({ authorization: arenaAuthorizationScope(["skill"]) }),
  );
  if (!arenaCaseOpened.ok) throw new Error(`lab journey rig: arena case refused: ${arenaCaseOpened.detail}`);
  const driven = await arenaJourney.service.driveCase(arenaJourney.caller, String(arenaCaseOpened.case.caseId));
  if (!driven.ok || driven.outcome.status !== "ingested") {
    throw new Error(`lab journey rig: arena drive did not ingest: ${driven.ok ? driven.outcome.status : driven.detail}`);
  }
  const arenaCase = driven.outcome.case;

  const rig: LabJourneyRig = {
    stack,
    arenaCase,
    dataPort,
    commandPort,
    streams,
    pageStream,
    runLabLoopCycle,
    snapshot(): LabDataSnapshot {
      const document = stack.organization.document();
      const signals = stack.learning.deriveSignals(learningCaller);
      if (!signals.ok) throw new Error(`lab journey rig: signals refused: ${signals.detail}`);
      const guidanceObserved = stack.learning.deriveSearchGuidance(learningCaller, { mode: "observed-only" });
      if (!guidanceObserved.ok) throw new Error(`lab journey rig: observed guidance refused: ${guidanceObserved.detail}`);
      const guidanceEstimate = stack.learning.deriveSearchGuidance(learningCaller, { mode: "with-estimates" });
      if (!guidanceEstimate.ok) throw new Error(`lab journey rig: estimate guidance refused: ${guidanceEstimate.detail}`);
      return {
        viewer: { tenant: JOURNEY_LAB_TENANT, subject: JOURNEY_LAB_SUBJECT },
        searches: document.searches,
        candidateStreams: Object.fromEntries(streams),
        evidence: document.evidence,
        learningRecords: stack.learning.listLearningCycles(learningCaller),
        signals: signals.signals,
        guidance: [guidanceObserved.guidance, guidanceEstimate.guidance],
        gapSummaries: stack.learning.summarizeGaps(learningCaller),
        arenaCases: [arenaCase],
      } satisfies LabDataSnapshot;
    },
  };
  return rig;
}

/** Open one search in the FOREIGN tenant (the R20 guard demo row). */
export function openForeignSearch(rig: LabJourneyRig, cycleId: string, seed: string): string {
  const opened = rig.stack.organization.openSearch(
    searchRequestFor({ cycleId, seed, maxAgents: 2, as: foreign, now: rig.stack.clock.now() }),
  );
  if (!opened.ok) throw new Error(`lab journey rig: foreign search refused: ${opened.detail}`);
  return opened.searchId;
}
