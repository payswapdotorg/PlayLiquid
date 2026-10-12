/**
 * THE HOSTILE JOURNEY WALK (PL-040 qa/e2e-lab) — `runHostileJourney()` runs
 * the WHOLE thesis over the SAME public surfaces as the canonical example
 * but under the hostile world's DIFFERENT fixtures (ids.ts), recording every
 * step — INCLUDING the rung-skip refusal it meets on the way — into the
 * append-only hash-chained hostile journal (E10) and sealing a
 * content-addressed run digest (E9: run twice, identical journal + seal).
 *
 * The route deliberately differs from the example's walk: the ladder rungs
 * are ATTEMPTED (and stay unresolved) rather than unavailable/declined, the
 * evidence ledger holds different records, the seeds/cycles/observations
 * differ, and the closing contribution is AI-DISCLOSED. The suite's negative
 * files then attack every stage of THIS walk with forgeries, replays and
 * cross-tenant moves.
 */

import type { GapSeamFacts } from "../../../packages/community/src/index.ts";
import { CYCLE_ONE, CYCLE_TWO, HOSTILE_MAINTAINER, HOSTILE_SUBJECT, HOSTILE_TENANT, JOURNAL_CLOCK_START, JOURNAL_CLOCK_STEP_MS, SEARCH_SEED_ONE, SEARCH_SEED_TWO } from "./ids.ts";
import { createHostileJournal, sealHostileRun } from "./hostile-journal.ts";
import type { HostileJournal, HostileRunSeal } from "./hostile-journal.ts";
import { createHostileArena, hostileAskDigestOf, hostileEscalationRefOf } from "./hostile-arena.ts";
import { createHostileCommunity, hostileGapLinkOf } from "./hostile-community.ts";
import { createHostileWorld } from "./hostile-rig.ts";
import type { HostileCycleOutcome } from "./hostile-rig.ts";

/** The typed facts of one completed hostile run (the tests' accessors). */
export interface HostileJourneyFacts {
  readonly lab: {
    readonly searchId: string;
    readonly streamSize: number;
    readonly evidenceRows: readonly { readonly contentKey: string; readonly epistemic: string; readonly method: string }[];
    readonly learningRecords: readonly { readonly recordId: string; readonly cycleId: string; readonly sequence: number }[];
    readonly signalsDigest: string;
    readonly guidanceDigests: { readonly observed: string; readonly estimate: string };
    readonly gapId: string;
    readonly rungsWalked: readonly string[];
  };
  readonly arena: {
    readonly sourceKey: string;
    readonly caseId: string;
    readonly duplicate: boolean;
    readonly lifecycleTrail: readonly string[];
    readonly evidenceVerdict: string;
    readonly labels: readonly { readonly externalClass: string; readonly epistemic: string }[];
    readonly escalationRef: { readonly external: string; readonly escalationId: string; readonly requestDigest: string };
  };
  readonly community: {
    readonly contributionId: string;
    readonly trail: readonly string[];
    readonly status: string;
    readonly aiGenerated: boolean;
    readonly gapId: string;
    readonly gapFacts: GapSeamFacts;
  };
}

/** One completed hostile run: the seal + journal + facts + the live rigs. */
export interface HostileJourneyRun {
  readonly seal: HostileRunSeal;
  readonly journal: HostileJournal;
  readonly facts: HostileJourneyFacts;
  /** The live Lab world the walk drove (the tests' read side). */
  readonly world: ReturnType<typeof createHostileWorld>;
  /** The live Arena phase the walk drove. */
  readonly arenaRig: ReturnType<typeof createHostileArena>;
  /** The live Community phase the walk drove. */
  readonly communityRig: ReturnType<typeof createHostileCommunity>;
}

/** The hostile world's DIFFERENT ladder route: every rung ATTEMPTED, unresolved. */
const HOSTILE_LADDER_ROUTE = [
  { rung: "alternate-organization", disposition: "attempted", outcome: "unresolved" },
  { rung: "package-platform-capability", disposition: "attempted", outcome: "unresolved" },
  { rung: "user-community-contribution", disposition: "attempted", outcome: "unresolved" },
] as const;

/** Runs the complete hostile journey once (deterministic, E9). */
export async function runHostileJourney(): Promise<HostileJourneyRun> {
  const journal = createHostileJournal(JOURNAL_CLOCK_START, JOURNAL_CLOCK_STEP_MS);

  // ---- LAB ----------------------------------------------------------------
  const lab = createHostileWorld();
  const caller = lab.caller;
  journal.record("hostile-world-wired", {
    tenant: String(HOSTILE_TENANT),
    subject: String(HOSTILE_SUBJECT),
    evidenceVariant: "qa-hostile",
  });

  const requested = lab.commandPort.dispatch({
    kind: "request-search", tenant: String(HOSTILE_TENANT), subject: String(HOSTILE_SUBJECT),
    cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 2,
  });
  if (!requested.ok || requested.kind !== "search-opened") {
    throw new Error(`hostile journey: request-search refused: ${requested.ok ? requested.kind : requested.detail}`);
  }
  journal.record("request-search", { searchId: requested.searchId, size: requested.size, duplicate: requested.duplicate });

  const cycleOne: HostileCycleOutcome = lab.runHostileCycle({ cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 3 });
  journal.record("loop-cycle-one", {
    searchId: cycleOne.searchId,
    streamSize: cycleOne.streamSize,
    baselinePosition: cycleOne.baselinePosition,
    spreadPosition: cycleOne.spreadPosition,
    evidenceKeys: cycleOne.evidenceKeys,
    gapIds: cycleOne.gapIds,
    learnedRecordId: cycleOne.learnedRecordId,
  });
  const gapId = cycleOne.gapIds[0];
  if (gapId === undefined) throw new Error("hostile journey: no capability gap was discovered in cycle one (R18: never silently skipped)");

  const evidenceRows = lab.stack.organization.listEvidence(caller).map((row) => ({
    contentKey: String(row.contentKey),
    epistemic: row.run.result.epistemic,
    method: row.run.result.method,
    tickBudget: row.tickBudget,
  }));
  journal.record("evidence-ledger", { count: evidenceRows.length, rows: evidenceRows });

  const learningRecords = lab.stack.learning.listLearningCycles(caller).map((record) => ({
    recordId: String(record.recordId),
    cycleId: String(record.cycleId),
    sequence: record.sequence,
  }));
  const signals = lab.stack.learning.deriveSignals(caller);
  if (!signals.ok) throw new Error(`hostile journey: signals refused: ${signals.detail}`);
  journal.record("learning", { recordCount: learningRecords.length, records: learningRecords, signalsDigest: String(signals.signals.stateDigest) });

  const guidanceObserved = lab.stack.learning.deriveSearchGuidance(caller, { mode: "observed-only" });
  const guidanceEstimate = lab.stack.learning.deriveSearchGuidance(caller, { mode: "with-estimates" });
  if (!guidanceObserved.ok || !guidanceEstimate.ok) throw new Error("hostile journey: guidance refused");
  if (guidanceEstimate.guidance.epistemic !== "labeled-estimate" || guidanceObserved.guidance.epistemic !== "observed-evidence") {
    throw new Error("hostile journey: the guidance epistemic classes are not the disjoint E11 pair");
  }
  journal.record("guidance", {
    observed: { epistemic: guidanceObserved.guidance.epistemic, digest: String(guidanceObserved.guidance.digest) },
    estimate: { epistemic: guidanceEstimate.guidance.epistemic, digest: String(guidanceEstimate.guidance.digest) },
  });

  const gapBefore = lab.stack.organization.getCapabilityGap(gapId, caller);
  if (!gapBefore.ok) throw new Error(`hostile journey: gap read refused: ${gapBefore.detail}`);
  journal.record("gaps-before-advance", {
    gapId,
    currentRung: gapBefore.gap.attempts[gapBefore.gap.attempts.length - 1]?.rung ?? null,
    attempts: gapBefore.gap.attempts.length,
  });

  // The ladder-skip attempt the walk meets (and records): two rungs at once.
  const skip = lab.commandPort.dispatch({
    kind: "advance-gap-rung", tenant: String(HOSTILE_TENANT), subject: String(HOSTILE_SUBJECT),
    gapId, rung: "user-community-contribution", disposition: "declined",
  });
  if (skip.ok) throw new Error("hostile journey: the rung skip was not refused");
  journal.record("gap-rung-skip-refused", { code: skip.code, detail: skip.detail });

  const rungsWalked: string[] = [];
  for (const attempt of HOSTILE_LADDER_ROUTE) {
    const advanced = lab.commandPort.dispatch({
      kind: "advance-gap-rung", tenant: String(HOSTILE_TENANT), subject: String(HOSTILE_SUBJECT), gapId, ...attempt,
    });
    if (!advanced.ok || advanced.kind !== "gap-advanced") {
      throw new Error(`hostile journey: advancing ${attempt.rung} refused: ${advanced.ok ? advanced.kind : advanced.detail}`);
    }
    rungsWalked.push(advanced.rung);
  }
  journal.record("gap-ladder-advanced", { gapId, rungsWalked });

  // ---- ARENA --------------------------------------------------------------
  const arena = createHostileArena();
  const walkedGap = lab.stack.organization.getCapabilityGap(gapId, caller);
  if (!walkedGap.ok) throw new Error(`hostile journey: gap re-read refused: ${walkedGap.detail}`);
  const registered = arena.registerGapSource(walkedGap.gap);
  journal.record("arena-source-registered", {
    sourceKey: registered.sourceKey,
    sourceKind: "gap-record",
    missingCapability: walkedGap.gap.missingCapability,
    duplicate: registered.duplicate,
  });

  const command = arena.decidedCommand({ requestPayload: hostileAskDigestOf(walkedGap.gap), sourceKey: registered.sourceKey });
  const opened = arena.service.openEscalationCase(arena.caller, command);
  if (!opened.ok) throw new Error(`hostile journey: arena case refused: ${opened.detail}`);
  journal.record("arena-case-opened", {
    caseId: String(opened.case.caseId),
    duplicate: opened.duplicate,
    decidedBy: String(opened.case.decidedBy),
    requestKind: opened.case.request.requestKind,
    requestDigest: String(opened.case.request.requestDigest),
  });

  const driven = await arena.service.driveCase(arena.caller, String(opened.case.caseId));
  if (!driven.ok || driven.outcome.status !== "ingested") {
    throw new Error(`hostile journey: arena drive did not ingest: ${driven.ok ? driven.outcome.status : driven.detail}`);
  }
  const arenaCase = driven.outcome.case;
  if (arenaCase.evidencePackage === undefined || arenaCase.evidencePackage.verdict !== "admitted") {
    throw new Error("hostile journey: the ingested case carries no admitted evidence package");
  }
  journal.record("arena-case-driven", {
    caseId: String(arenaCase.caseId),
    status: driven.outcome.status,
    lifecycleTrail: arenaCase.lifecycle.history.map((entry) => `${entry.from}->${entry.to}`),
    evidenceVerdict: arenaCase.evidencePackage.verdict,
  });

  const labels = arena.service.labeledEvidence(arena.caller, String(arenaCase.caseId));
  if (!labels.ok) throw new Error(`hostile journey: labels refused: ${labels.detail}`);
  journal.record("arena-evidence-labeled", {
    labels: labels.labels.map((label) => ({ externalClass: label.externalClass, epistemic: label.epistemic })),
  });

  const escalationRef = hostileEscalationRefOf(arenaCase);
  const arenaRung = lab.commandPort.dispatch({
    kind: "advance-gap-rung", tenant: String(HOSTILE_TENANT), subject: String(HOSTILE_SUBJECT), gapId,
    rung: "arena-escalation", disposition: "attempted", outcome: "unresolved", external: escalationRef,
  });
  if (!arenaRung.ok || arenaRung.kind !== "gap-advanced") {
    throw new Error(`hostile journey: the arena rung was refused: ${arenaRung.ok ? arenaRung.kind : arenaRung.detail}`);
  }
  rungsWalked.push(arenaRung.rung);
  journal.record("gap-arena-rung-recorded", { gapId, external: escalationRef, outcome: "unresolved" });

  // Cycle two: the gap recurs with the walked trail (R18).
  const cycleTwo: HostileCycleOutcome = lab.runHostileCycle({ cycleId: String(CYCLE_TWO), seed: SEARCH_SEED_TWO, maxAgents: 2 });
  journal.record("loop-cycle-two", {
    searchId: cycleTwo.searchId,
    learnedRecordId: cycleTwo.learnedRecordId,
    gapIds: cycleTwo.gapIds,
    learningRecordCount: lab.stack.learning.listLearningCycles(caller).length,
  });

  // ---- COMMUNITY ----------------------------------------------------------
  const community = createHostileCommunity(lab.stack, caller);
  const submitted = community.submitArenaOutcome({
    outcome: {
      caseId: String(arenaCase.caseId),
      escalationId: escalationRef.escalationId,
      requestDigest: escalationRef.requestDigest,
      lifecycleState: arenaCase.lifecycle.state,
      evidenceVerdict: arenaCase.evidencePackage.verdict,
    },
    gapRecord: walkedGap.gap,
  });
  if (!submitted.accepted) throw new Error(`hostile journey: contribution refused: ${submitted.code} — ${submitted.detail}`);
  const contributionId = String(submitted.contribution.contributionId);
  journal.record("community-contribution-submitted", {
    contributionId,
    kind: submitted.contribution.kind,
    gapId: String(submitted.contribution.gap?.gapId ?? ""),
    aiGenerated: submitted.contribution.provenance.aiGenerated,
    status: submitted.contribution.status,
  });

  const steps: readonly { readonly command: "triage" | "review" | "accept"; readonly step: string; readonly reason: string }[] = [
    { command: "triage", step: "triaged", reason: "hostile triage: the Arena outcome addresses the recorded capability gap" },
    { command: "review", step: "reviewed", reason: "reviewing the ingested Arena evidence package under adversarial audit" },
    { command: "accept", step: "accepted", reason: "lineage base published and provenance passes — qualified at accept (E8)" },
  ];
  for (const entry of steps) {
    const advanced = community.advance({ contributionId, command: entry.command, actor: HOSTILE_MAINTAINER, reason: entry.reason });
    if (!advanced.accepted) {
      throw new Error(`hostile journey: ${entry.command} refused: ${advanced.code} — ${advanced.detail}`);
    }
    journal.record(`community-contribution-${entry.step}`, { contributionId, from: advanced.record.from, to: advanced.record.to });
  }

  const record = community.service.contribution(HOSTILE_TENANT, submitted.contribution.contributionId);
  if (record === undefined) throw new Error("hostile journey: the accepted contribution cannot be read back");
  const history = community.service.history(HOSTILE_TENANT, submitted.contribution.contributionId);
  journal.record("community-loop-closed", {
    status: record.status,
    trail: history.map((entry) => `${entry.from}->${entry.to}`),
    aiGenerated: record.provenance.aiGenerated,
    gapContributions: community.service.gapContributions(HOSTILE_TENANT, gapId).length,
  });

  // ---- SEAL ---------------------------------------------------------------
  const learningFinal = lab.stack.learning.listLearningCycles(caller).map((entry) => ({
    recordId: String(entry.recordId),
    cycleId: String(entry.cycleId),
    sequence: entry.sequence,
  }));
  const seal = sealHostileRun({
    tenant: String(HOSTILE_TENANT),
    journal,
    phases: {
      lab: { searchId: cycleOne.searchId, gapId, rungsWalked, learningRecords: learningFinal.length },
      arena: { caseId: String(arenaCase.caseId), lifecycle: arenaCase.lifecycle.state, evidenceVerdict: arenaCase.evidencePackage.verdict },
      community: { contributionId, status: record.status, gapId },
    },
  });
  journal.record("hostile-run-sealed", { sealDigest: seal.sealDigest, journalLength: journal.size() });

  return {
    seal,
    journal,
    world: lab,
    arenaRig: arena,
    communityRig: community,
    facts: {
      lab: {
        searchId: cycleOne.searchId,
        streamSize: cycleOne.streamSize,
        evidenceRows: evidenceRows.map(({ contentKey, epistemic, method }) => ({ contentKey, epistemic, method })),
        learningRecords: learningFinal,
        signalsDigest: String(signals.signals.stateDigest),
        guidanceDigests: { observed: String(guidanceObserved.guidance.digest), estimate: String(guidanceEstimate.guidance.digest) },
        gapId,
        rungsWalked,
      },
      arena: {
        sourceKey: registered.sourceKey,
        caseId: String(arenaCase.caseId),
        duplicate: opened.duplicate,
        lifecycleTrail: arenaCase.lifecycle.history.map((entry) => `${entry.from}->${entry.to}`),
        evidenceVerdict: arenaCase.evidencePackage.verdict,
        labels: labels.labels.map((label) => ({ externalClass: label.externalClass, epistemic: label.epistemic })),
        escalationRef: { external: escalationRef.external, escalationId: escalationRef.escalationId, requestDigest: escalationRef.requestDigest },
      },
      community: {
        contributionId,
        trail: history.map((entry) => `${entry.from}->${entry.to}`),
        status: record.status,
        aiGenerated: record.provenance.aiGenerated,
        gapId: record.gap === undefined ? "" : String(record.gap.gapId),
        gapFacts: community.gaps.factsOf(hostileGapLinkOf(walkedGap.gap)),
      },
    },
  };
}
