/**
 * THE CANONICAL LAB/ARENA/COMMUNITY JOURNEY (PL-040) —
 * `runCanonicalLabArenaJourney()` walks the WHOLE product thesis over REAL
 * public surfaces only, recording every step into an append-only,
 * hash-chained journal (E10) and sealing a content-addressed journey
 * document (E9: run twice, identical journal + digests):
 *
 *   LAB       a seeded gap: request-search through the typed command port
 *             → the candidate stream → runLabLoopCycle (evaluate →
 *             calibrate → learn → seal) → the append-only evidence ledger
 *             (PL-028 labeled estimates, E11) → learning records + the
 *             signals fold → the gap ladder advanced ONE RUNG AT A TIME
 *             (after the authoritative rung-skip refusal, E8) up to the
 *             community rung;
 *   ARENA     the DECIDED escalation: the Lab's own walked gap record
 *             registered as the escalation source → the decided command
 *             (decision digest re-derived) → the content-addressed case →
 *             driveCase through the arena-integration lifecycle to INGESTED
 *             → the E11 epistemic labels of the admitted evidence package →
 *             the arena rung recorded on the ladder with the provider-neutral
 *             external ref (lock 32);
 *   COMMUNITY the Arena outcome surfaced as a contribution through the REAL
 *             CommunityService: submit (gap-linked through the Lab-backed
 *             R18 seam) → triage → review → ACCEPT with the E8 trust flip
 *             (the third-party lineage base qualified at accept) and the
 *             provenance chain — the thesis loop closed:
 *             Lab discovers → Arena adjudicates → Community curates.
 */

import type { GapSeamFacts } from "../../../packages/community/src/index.ts";
import { askDigestOf, arenaEscalationRefOf, createJourneyArena } from "./arena-phase.ts";
import { createJourneyCommunity, gapLinkOf, provenanceFactsOf, trailOf } from "./community-phase.ts";
import { CYCLE_A, CYCLE_B, JOURNAL_CLOCK_START, JOURNAL_CLOCK_STEP_MS, JOURNEY_MAINTAINER, JOURNEY_SUBJECT, JOURNEY_TENANT, SEARCH_SEED_A } from "./ids.ts";
import { createJourneyJournal, sealJourneyDocument } from "./journal.ts";
import type { JourneyDocument, JourneyJournal } from "./journal.ts";
import { createJourneyLab, initialSearchIntent } from "./lab-phase.ts";
import type { LabLoopOutcome } from "./lab-phase.ts";

/** The typed facts of one completed journey run (the tests' accessors). */
export interface CanonicalJourneyFacts {
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
    readonly provenance: ReturnType<typeof provenanceFactsOf>;
    readonly gapFacts: GapSeamFacts;
  };
}

/** One completed canonical journey run: the sealed document + journal + facts. */
export interface CanonicalJourneyRun {
  readonly document: JourneyDocument;
  readonly journal: JourneyJournal;
  readonly facts: CanonicalJourneyFacts;
}

/** Runs the complete canonical journey once (deterministic, E9). */
export async function runCanonicalLabArenaJourney(): Promise<CanonicalJourneyRun> {
  const journal = createJourneyJournal(JOURNAL_CLOCK_START, JOURNAL_CLOCK_STEP_MS);

  // ---- LAB ----------------------------------------------------------------
  const lab = createJourneyLab();
  const caller = lab.caller;
  journal.record("lab-wired", {
    tenant: String(JOURNEY_TENANT),
    subject: String(JOURNEY_SUBJECT),
    engines: ["lab-organization", "lab-simulation", "lab-learning"],
  });

  const requested = lab.commandPort.dispatch(initialSearchIntent());
  if (!requested.ok || requested.kind !== "search-opened") {
    throw new Error(`journey: request-search refused: ${requested.ok ? requested.kind : requested.detail}`);
  }
  journal.record("request-search", { searchId: requested.searchId, size: requested.size, duplicate: requested.duplicate });

  const cycleA: LabLoopOutcome = lab.runLabLoopCycle({ cycleId: CYCLE_A, seed: SEARCH_SEED_A, maxAgents: 3 });
  journal.record("loop-cycle-a", {
    searchId: cycleA.searchId,
    streamSize: cycleA.streamSize,
    baselinePosition: cycleA.baselinePosition,
    spreadPosition: cycleA.spreadPosition,
    evidenceKeys: cycleA.evidenceKeys,
    gapIds: cycleA.gapIds,
    learnedRecordId: cycleA.learnedRecordId,
  });
  const gapId = cycleA.gapIds[0];
  if (gapId === undefined) throw new Error("journey: no capability gap was discovered in cycle A (R18: never silently skipped)");

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
  if (!signals.ok) throw new Error(`journey: signals refused: ${signals.detail}`);
  journal.record("learning", {
    recordCount: learningRecords.length,
    records: learningRecords,
    signalsDigest: String(signals.signals.stateDigest),
  });

  const guidanceObserved = lab.stack.learning.deriveSearchGuidance(caller, { mode: "observed-only" });
  const guidanceEstimate = lab.stack.learning.deriveSearchGuidance(caller, { mode: "with-estimates" });
  if (!guidanceObserved.ok || !guidanceEstimate.ok) throw new Error("journey: guidance refused");
  if (guidanceEstimate.guidance.epistemic !== "labeled-estimate" || guidanceObserved.guidance.epistemic !== "observed-evidence") {
    throw new Error("journey: the guidance epistemic classes are not the disjoint E11 pair");
  }
  journal.record("guidance", {
    observed: { epistemic: guidanceObserved.guidance.epistemic, digest: String(guidanceObserved.guidance.digest) },
    estimate: {
      epistemic: guidanceEstimate.guidance.epistemic,
      method: guidanceEstimate.guidance.method,
      basis: String(guidanceEstimate.guidance.basis),
      digest: String(guidanceEstimate.guidance.digest),
    },
  });

  // The gap ladder: the authoritative rung-skip refusal FIRST (E8), then the
  // stepwise walk up to the community rung.
  const gapBefore = lab.stack.organization.getCapabilityGap(gapId, caller);
  if (!gapBefore.ok) throw new Error(`journey: gap read refused: ${gapBefore.detail}`);
  journal.record("gaps-before-advance", {
    gapId,
    currentRung: gapBefore.gap.attempts[gapBefore.gap.attempts.length - 1]?.rung ?? null,
    attempts: gapBefore.gap.attempts.length,
  });

  const skip = lab.commandPort.dispatch({
    kind: "advance-gap-rung", gapId, rung: "user-community-contribution", disposition: "declined",
  });
  if (skip.ok) throw new Error("journey: the rung skip was not refused");
  journal.record("gap-rung-skip-refused", { code: skip.code, detail: skip.detail });

  const rungsWalked: string[] = [];
  for (const attempt of [
    { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" },
    { rung: "package-platform-capability", disposition: "unavailable", outcome: "unresolved" },
    { rung: "user-community-contribution", disposition: "declined" },
  ] as const) {
    const advanced = lab.commandPort.dispatch({ kind: "advance-gap-rung", gapId, ...attempt });
    if (!advanced.ok || advanced.kind !== "gap-advanced") {
      throw new Error(`journey: advancing ${attempt.rung} refused: ${advanced.ok ? advanced.kind : advanced.detail}`);
    }
    rungsWalked.push(advanced.rung);
  }
  journal.record("gap-ladder-advanced", { gapId, rungsWalked });

  // ---- ARENA --------------------------------------------------------------
  const arena = createJourneyArena();
  const walkedGap = lab.stack.organization.getCapabilityGap(gapId, caller);
  if (!walkedGap.ok) throw new Error(`journey: gap re-read refused: ${walkedGap.detail}`);
  const registered = arena.registerLabGapSource(walkedGap.gap);
  journal.record("arena-source-registered", {
    sourceKey: registered.sourceKey,
    sourceKind: "gap-record",
    missingCapability: walkedGap.gap.missingCapability,
    duplicate: registered.duplicate,
  });

  const command = arena.decidedCommand({ requestPayload: askDigestOf(walkedGap.gap) });
  const opened = arena.service.openEscalationCase(arena.caller, command);
  if (!opened.ok) throw new Error(`journey: arena case refused: ${opened.detail}`);
  journal.record("arena-case-opened", {
    caseId: String(opened.case.caseId),
    duplicate: opened.duplicate,
    decidedBy: String(opened.case.decidedBy),
    requestKind: opened.case.request.requestKind,
    requestDigest: String(opened.case.request.requestDigest),
  });

  const driven = await arena.service.driveCase(arena.caller, String(opened.case.caseId));
  if (!driven.ok || driven.outcome.status !== "ingested") {
    throw new Error(`journey: arena drive did not ingest: ${driven.ok ? driven.outcome.status : driven.detail}`);
  }
  const arenaCase = driven.outcome.case;
  if (arenaCase.evidencePackage === undefined || arenaCase.evidencePackage.verdict !== "admitted") {
    throw new Error("journey: the ingested case carries no admitted evidence package");
  }
  journal.record("arena-case-driven", {
    caseId: String(arenaCase.caseId),
    status: driven.outcome.status,
    lifecycleTrail: arenaCase.lifecycle.history.map((entry) => `${entry.from}->${entry.to}`),
    evidenceVerdict: arenaCase.evidencePackage.verdict,
  });

  const labels = arena.service.labeledEvidence(arena.caller, String(arenaCase.caseId));
  if (!labels.ok) throw new Error(`journey: labels refused: ${labels.detail}`);
  journal.record("arena-evidence-labeled", {
    labels: labels.labels.map((label) => ({ externalClass: label.externalClass, epistemic: label.epistemic })),
  });

  // The arena rung recorded on the ladder with the provider-neutral ref.
  const escalationRef = arenaEscalationRefOf(arenaCase);
  const arenaRung = lab.commandPort.dispatch({
    kind: "advance-gap-rung", gapId, rung: "arena-escalation",
    disposition: "attempted", outcome: "unresolved", external: escalationRef,
  });
  if (!arenaRung.ok || arenaRung.kind !== "gap-advanced") {
    throw new Error(`journey: the arena rung was refused: ${arenaRung.ok ? arenaRung.kind : arenaRung.detail}`);
  }
  rungsWalked.push(arenaRung.rung);
  journal.record("gap-arena-rung-recorded", { gapId, external: escalationRef, outcome: "unresolved" });

  // Cycle B: the gap recurs with the walked trail (R18) — a second learning
  // record seals and the signals fold evolves.
  const cycleB: LabLoopOutcome = lab.runLabLoopCycle({ cycleId: CYCLE_B, seed: "seed-lab-thesis-b", maxAgents: 2 });
  journal.record("loop-cycle-b", {
    searchId: cycleB.searchId,
    learnedRecordId: cycleB.learnedRecordId,
    gapIds: cycleB.gapIds,
    learningRecordCount: lab.stack.learning.listLearningCycles(caller).length,
  });

  // ---- COMMUNITY -----------------------------------------------------------
  const community = createJourneyCommunity(lab.stack, caller);
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
  if (!submitted.accepted) throw new Error(`journey: contribution refused: ${submitted.code} — ${submitted.detail}`);
  const contributionId = String(submitted.contribution.contributionId);
  journal.record("community-contribution-submitted", {
    contributionId,
    kind: submitted.contribution.kind,
    gapId: String(submitted.contribution.gap?.gapId ?? ""),
    origin: submitted.contribution.provenance.origin.kind,
    aiGenerated: submitted.contribution.provenance.aiGenerated,
    status: submitted.contribution.status,
  });

  const maintainer = JOURNEY_MAINTAINER;
  const steps: readonly { readonly command: "triage" | "review" | "accept"; readonly step: string; readonly reason: string }[] = [
    { command: "triage", step: "triaged", reason: "triaged: the Arena outcome addresses the recorded capability gap" },
    { command: "review", step: "reviewed", reason: "reviewing the ingested Arena evidence package" },
    { command: "accept", step: "accepted", reason: "lineage base published and provenance passes — qualified at accept (E8)" },
  ];
  for (const entry of steps) {
    const advanced = community.advance({ contributionId, command: entry.command, actor: maintainer, reason: entry.reason });
    if (!advanced.accepted) {
      throw new Error(`journey: ${entry.command} refused: ${advanced.code} — ${advanced.detail}`);
    }
    journal.record(`community-contribution-${entry.step}`, {
      contributionId,
      from: advanced.record.from,
      to: advanced.record.to,
    });
  }

  const record = community.service.contribution(JOURNEY_TENANT, submitted.contribution.contributionId);
  if (record === undefined) throw new Error("journey: the accepted contribution cannot be read back");
  const history = community.service.history(JOURNEY_TENANT, submitted.contribution.contributionId);
  journal.record("community-loop-closed", {
    status: record.status,
    trail: trailOf(history),
    provenance: provenanceFactsOf(record),
    gapContributions: community.service.gapContributions(JOURNEY_TENANT, gapId).length,
  });

  // ---- SEAL ----------------------------------------------------------------
  const signalsFinal = lab.stack.learning.deriveSignals(caller);
  if (!signalsFinal.ok) throw new Error(`journey: final signals refused: ${signalsFinal.detail}`);
  const learningFinal = lab.stack.learning.listLearningCycles(caller).map((entry) => ({
    recordId: String(entry.recordId),
    cycleId: String(entry.cycleId),
    sequence: entry.sequence,
  }));
  const document = sealJourneyDocument({
    tenant: String(JOURNEY_TENANT),
    subject: String(JOURNEY_SUBJECT),
    phases: {
      lab: { searchId: cycleA.searchId, gapId, rungsWalked, learningRecords: learningFinal.length },
      arena: { caseId: String(arenaCase.caseId), lifecycle: arenaCase.lifecycle.state, evidenceVerdict: arenaCase.evidencePackage.verdict },
      community: { contributionId, status: record.status, gapId },
    },
    journal,
  });
  journal.record("journey-sealed", { documentDigest: document.documentDigest, journalLength: journal.size() });

  return {
    document,
    journal,
    facts: {
      lab: {
        searchId: cycleA.searchId,
        streamSize: cycleA.streamSize,
        evidenceRows: evidenceRows.map(({ contentKey, epistemic, method }) => ({ contentKey, epistemic, method })),
        learningRecords: learningFinal,
        signalsDigest: String(signalsFinal.signals.stateDigest),
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
        trail: trailOf(history),
        status: record.status,
        provenance: provenanceFactsOf(record),
        gapFacts: community.gaps.factsOf(gapLinkOf(walkedGap.gap)),
      },
    },
  };
}
