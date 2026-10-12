/**
 * THE HOSTILE LAB WORLD (PL-040 qa/e2e-lab) — the REAL Lab loop engines
 * driven by an adversary over DIFFERENT fixtures than every sibling suite:
 *
 * - `createLabLearningJourney` (lab-learning's public journey stack): the
 *   REAL PL-029 organization compiler/search + PL-028 simulation engine +
 *   PL-030 learning service, wired over THIS suite's own fixture set (a
 *   4-record "qa-hostile" evidence ledger, different cycles, observations,
 *   seeds, capability and model route than examples/lab-journey and
 *   qa/browser — a shared fixture bug can never pass both suites at once);
 * - the TYPED hostile command port (hostile-port.ts): caller-carrying
 *   intents → the authoritative doors, refusal codes VERBATIM (E8),
 *   malformed intents refused BEFORE any domain call;
 * - `runHostileCycle`: one complete loop step — request-search → the seeded
 *   candidate stream → evaluate (baseline + spread) → calibrate against the
 *   observed outcome → learn/seal the cycle's artifacts into a learning
 *   record.
 *
 * TEST-SUPPORT RIG (lock rule 44): the lab packages' own deterministic
 * in-memory journey stack — no production integration implied. Determinism
 * (E9): fixed clock advanced by fixed steps, fixed seeds.
 */

import {
  asEvaluationSeed,
  asLabCycleId,
  asTimestampMs,
} from "../../../packages/lab-contracts/src/index.ts";
import {
  evidenceBundleDigestOf,
  labFixtureContext,
  labFixtureEvidenceRecords,
  labFixtureGeneralistOrganization,
  labFixtureObservation,
  labFixtureSuite,
} from "../../../packages/lab-simulation/src/index.ts";
import type { EvidenceBundleRef } from "../../../packages/lab-simulation/src/index.ts";
import { createLabLearningJourney } from "../../../packages/lab-learning/src/index.ts";
import type { LabCycleLearningSubmission, LabJourneyStack } from "../../../packages/lab-learning/src/index.ts";
import type {
  LabOrganizationCaller,
  OrganizationSearchRequest,
  SearchCursor,
  SearchOpenRefusalCode,
  SearchedCandidate,
} from "../../../packages/lab-organization/src/index.ts";
import type { GapDoorRefusalCode } from "../../../packages/lab-organization/src/index.ts";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import {
  CYCLE_ONE,
  CYCLE_TWO,
  EVALUATION_SEED,
  EVALUATION_TICK_BUDGET,
  HOSTILE_CAPABILITY,
  HOSTILE_EVIDENCE_COUNT,
  HOSTILE_EVIDENCE_VARIANT,
  HOSTILE_FOREIGN_SUBJECT,
  HOSTILE_FOREIGN_TENANT,
  HOSTILE_MODEL_ROUTE,
  HOSTILE_ROLE_VOCABULARY,
  HOSTILE_SUBJECT,
  HOSTILE_TENANT,
  OBSERVATION_ONE,
  OBSERVATION_TWO,
} from "./ids.ts";
import { gapDoorCodes, narrowDoorCode, rungAttemptOf, searchOpenCodes } from "./hostile-port.ts";
import type { HostileCommandIntent, HostileCommandReceipt } from "./hostile-port.ts";

/** One complete hostile Lab loop cycle's outcome. */
export interface HostileCycleOutcome {
  readonly searchId: string;
  readonly streamSize: number;
  readonly baselinePosition: number;
  readonly spreadPosition: number;
  readonly evidenceKeys: readonly string[];
  readonly gapIds: readonly string[];
  readonly learnedRecordId: string;
  readonly observationId: string;
}

/** The hostile world rig: the real engines + the caller-carrying port. */
export interface HostileWorldRig {
  readonly stack: LabJourneyStack;
  readonly caller: LabOrganizationCaller;
  readonly foreignCaller: LabOrganizationCaller;
  readonly commandPort: { dispatch(intent: HostileCommandIntent): HostileCommandReceipt };
  /** The hostile evidence bundle (a DIFFERENT fixture set than the example's). */
  readonly evidenceBundle: EvidenceBundleRef;
  /** The host-expanded hostile search request (time is caller-supplied, E9). */
  searchRequest(input: {
    readonly cycleId: string;
    readonly seed: string;
    readonly maxAgents: number;
    readonly as: LabOrganizationCaller;
    readonly now: number;
  }): OrganizationSearchRequest;
  /** Pages one opened search's whole candidate stream in cursor order. */
  pageStream(searchId: string, first: SearchCursor, as: LabOrganizationCaller): readonly SearchedCandidate[];
  /** Runs ONE complete hostile loop cycle (search → evaluate → calibrate → learn). */
  runHostileCycle(input: { readonly cycleId: string; readonly seed: string; readonly maxAgents: number }): HostileCycleOutcome;
}

/** Creates the hostile Lab world over the REAL engines + the typed port. */
export function createHostileWorld(): HostileWorldRig {
  const stack = createLabLearningJourney({
    observations: [labFixtureObservation(OBSERVATION_ONE, CYCLE_ONE), labFixtureObservation(OBSERVATION_TWO, CYCLE_TWO)],
    evidence: labFixtureEvidenceRecords(HOSTILE_EVIDENCE_COUNT, HOSTILE_EVIDENCE_VARIANT),
  });
  const caller: LabOrganizationCaller = { tenant: HOSTILE_TENANT, subject: HOSTILE_SUBJECT };
  const foreignCaller: LabOrganizationCaller = { tenant: HOSTILE_FOREIGN_TENANT, subject: HOSTILE_FOREIGN_SUBJECT };
  const streams = new Map<string, readonly SearchedCandidate[]>();
  const evidence = labFixtureEvidenceRecords(HOSTILE_EVIDENCE_COUNT, HOSTILE_EVIDENCE_VARIANT);
  const evidenceBundle: EvidenceBundleRef = {
    recordIds: evidence.map((record) => String(record.evidenceId)),
    declaredDigest: evidenceBundleDigestOf(evidence),
  };
  const suite = labFixtureSuite().ref;

  function searchRequest(input: {
    readonly cycleId: string;
    readonly seed: string;
    readonly maxAgents: number;
    readonly as: LabOrganizationCaller;
    readonly now: number;
  }): OrganizationSearchRequest {
    return {
      tenant: input.as.tenant,
      owner: input.as.subject,
      cycleId: asLabCycleId(input.cycleId)!,
      context: labFixtureContext(),
      bounds: {
        maxAgents: input.maxAgents,
        roleVocabulary: [...HOSTILE_ROLE_VOCABULARY],
        bodyCatalog: [],
        modelCatalog: [{ authority: "zcode-model-routing", route: HOSTILE_MODEL_ROUTE }],
        toolCatalog: [],
        capabilityVocabulary: [HOSTILE_CAPABILITY],
      },
      seed: asEvaluationSeed(input.seed)!,
      currentOrganization: labFixtureGeneralistOrganization(),
      requestedAt: asTimestampMs(input.now)!,
    };
  }

  function pageStream(searchId: string, first: SearchCursor, as: LabOrganizationCaller): readonly SearchedCandidate[] {
    const collected: SearchedCandidate[] = [];
    let cursor: SearchCursor | undefined = first;
    let done = false;
    while (cursor !== undefined && !done) {
      const page = stack.organization.nextCandidates({ searchId, cursor, limit: 64, as });
      if (!page.ok) return collected;
      collected.push(...page.candidates);
      done = page.done;
      cursor = page.nextCursor;
    }
    return collected;
  }

  function runHostileCycle(input: { readonly cycleId: string; readonly seed: string; readonly maxAgents: number }): HostileCycleOutcome {
    const opened = stack.organization.openSearch(searchRequest({ ...input, as: caller, now: stack.clock.now() }));
    if (!opened.ok) throw new Error(`hostile rig: search refused: ${opened.detail}`);
    stack.clock.advance(10);
    const stream = pageStream(opened.searchId, opened.cursor, caller);
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
    if (!evaluatedBaseline.ok) throw new Error(`hostile rig: baseline evaluation refused: ${evaluatedBaseline.detail}`);
    const evaluatedSpread = stack.organization.evaluateCandidate({
      searchId: opened.searchId, position: spreadPosition, suite, evidence: evidenceBundle,
      parameters: { seed: EVALUATION_SEED, tickBudget: EVALUATION_TICK_BUDGET }, as: caller,
    });
    if (!evaluatedSpread.ok) throw new Error(`hostile rig: spread evaluation refused: ${evaluatedSpread.detail}`);
    stack.clock.advance(10);
    const calibrated = stack.simulation.calibrate({
      evaluationId: evaluatedBaseline.evidence.evaluationId,
      as: caller,
      observedOutcomeIds: [input.cycleId === String(CYCLE_TWO) ? OBSERVATION_TWO : OBSERVATION_ONE],
    });
    if (calibrated.ok) {
      const appended = stack.observations.appendConclusion(calibrated.conclusion);
      if (!appended.ok) throw new Error(`hostile rig: conclusion append refused: ${String(appended)}`);
    }
    const runs = [evaluatedBaseline.evidence.run, evaluatedSpread.evidence.run];
    const submission: LabCycleLearningSubmission = {
      tenant: HOSTILE_TENANT,
      owner: HOSTILE_SUBJECT,
      cycleId: asLabCycleId(input.cycleId)!,
      sequence: stack.learning.listLearningCycles(caller).length + 1,
      observations: stack.observations.ledger(),
      evaluations: runs as LabCycleLearningSubmission["evaluations"],
      searchResults: stream.slice(0, 12),
      gaps: [...stack.organization.listCapabilityGaps(caller)],
      learnedAt: asTimestampMs(stack.clock.now())!,
    };
    const learned = stack.learning.learnCycle(submission);
    if (!learned.ok) throw new Error(`hostile rig: learn refused: ${learned.detail}`);
    stack.clock.advance(10);
    return {
      searchId: opened.searchId,
      streamSize: stream.length,
      baselinePosition,
      spreadPosition,
      evidenceKeys: [String(evaluatedBaseline.evidence.contentKey), String(evaluatedSpread.evidence.contentKey)],
      gapIds: evaluatedSpread.gapFindings.map((finding) => String(finding.gapId)),
      learnedRecordId: String(learned.record.recordId),
      observationId: input.cycleId === String(CYCLE_TWO) ? OBSERVATION_TWO : OBSERVATION_ONE,
    };
  }

  // The typed hostile command port: caller-carrying intents → the
  // authoritative doors. Malformed identities/shapes are refused BEFORE any
  // domain call; door codes come back VERBATIM (E8), cross-tenant included.
  const commandPort = {
    dispatch(intent: HostileCommandIntent): HostileCommandReceipt {
      const as =
        asTenantId(intent.tenant) === undefined || asSubjectId(intent.subject) === undefined
          ? undefined
          : { tenant: asTenantId(intent.tenant)!, subject: asSubjectId(intent.subject)! };
      if (intent.kind === "request-search") {
        if (!Number.isInteger(intent.maxAgents) || intent.maxAgents < 1) {
          return { ok: false, code: "invalid-intent", detail: `maxAgents must be a positive integer, got ${String(intent.maxAgents)}` };
        }
        if (as === undefined) {
          return { ok: false, code: "invalid-intent", detail: `caller ${intent.tenant}/${intent.subject} is not valid platform id text` };
        }
        const opened = stack.organization.openSearch(searchRequest({ ...intent, as, now: stack.clock.now() }));
        if (!opened.ok) {
          return { ok: false, code: narrowDoorCode<SearchOpenRefusalCode>(searchOpenCodes, opened.code, "search door"), detail: opened.detail };
        }
        stack.clock.advance(10);
        streams.set(opened.searchId, pageStream(opened.searchId, opened.cursor, as));
        return { ok: true, kind: "search-opened", searchId: opened.searchId, size: opened.size, duplicate: opened.duplicate };
      }
      if (intent.kind === "advance-gap-rung") {
        if (as === undefined) {
          return { ok: false, code: "invalid-intent", detail: `caller ${intent.tenant}/${intent.subject} is not valid platform id text` };
        }
        const attempt = rungAttemptOf(intent);
        if (attempt === null) {
          return {
            ok: false,
            code: "invalid-intent",
            detail: `rung ${intent.rung} cannot take disposition ${intent.disposition} through this intent (the authoritative rung-attempt union rejects it)`,
          };
        }
        const advanced = stack.organization.advanceCapabilityGap({ gapId: intent.gapId, attempt, as });
        if (!advanced.ok) {
          return { ok: false, code: narrowDoorCode<GapDoorRefusalCode>(gapDoorCodes, advanced.code, "gap door"), detail: advanced.detail };
        }
        return { ok: true, kind: "gap-advanced", gapId: intent.gapId, rung: intent.rung };
      }
      return { ok: false, code: "invalid-intent", detail: `unknown intent kind ${String((intent as { kind?: string }).kind)}` };
    },
  };

  return { stack, caller, foreignCaller, commandPort, evidenceBundle, searchRequest, pageStream, runHostileCycle };
}
