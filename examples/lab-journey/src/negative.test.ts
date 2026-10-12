/**
 * NEGATIVE TESTS (E8/R20/E10) — the canonical journey's refusal surfaces,
 * asserted with the AUTHORITATIVE codes VERBATIM (PL-040):
 *
 * - the gap ladder's own refusals: `rung-skip` (never skip a rung),
 *   `gap-unknown` (a gap that was never recorded);
 * - the typed command port refuses malformed intents BEFORE any domain call
 *   (`invalid-intent`) — and a refused command never corrupts the door;
 * - R20 cross-tenant refusals across the REAL doors: lab-organization gap
 *   advance + gap read, lab-simulation calibrate, lab-learning record read,
 *   the Arena runtime's case read + drive;
 * - tampered case documents: restore() refuses a persisted document whose
 *   state digest no longer matches (E8), including a document whose
 *   top-level digest was recomputed around a FORGED case identity;
 * - idempotent duplicates (E10): re-opening the same decided escalation
 *   resumes the SAME case (duplicate receipt), a terminal case re-drives as
 *   an honest no-op with NO second wire send, and the community service's
 *   duplicate submission + transition replays return their first receipts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaDocumentDigestOf } from "../../../packages/arena-integration-runtime/src/index.ts";
import { askDigestOf, createJourneyArena } from "./arena-phase.ts";
import { createJourneyCommunity } from "./community-phase.ts";
import { CYCLE_A, JOURNEY_MAINTAINER, SEARCH_SEED_A } from "./ids.ts";
import { createJourneyLab } from "./lab-phase.ts";
import type { ArenaEscalationCommand } from "../../../packages/arena-integration-runtime/src/index.ts";
import type { GapRungAttempt } from "../../../packages/lab-contracts/src/index.ts";
import { ArenaRuntimeService } from "../../../packages/arena-integration-runtime/src/index.ts";
import { allowAllArenaPolicy } from "../../../packages/arena-integration/src/index.ts";

/** A fresh Lab with cycle A run and its gap discovered (pre-ladder). */
function labWithGap(): { lab: ReturnType<typeof createJourneyLab>; gapId: string } {
  const lab = createJourneyLab();
  const cycleA = lab.runLabLoopCycle({ cycleId: CYCLE_A, seed: SEARCH_SEED_A, maxAgents: 3 });
  const gapId = cycleA.gapIds[0];
  if (gapId === undefined) throw new Error("negative: no gap discovered");
  return { lab, gapId };
}

/** The full hostile walk: lab gap walked to the community rung + Arena case ingested. */
async function walkedToIngestedCase(): Promise<{
  lab: ReturnType<typeof createJourneyLab>;
  gapId: string;
  arena: ReturnType<typeof createJourneyArena>;
  command: ArenaEscalationCommand;
  caseId: string;
}> {
  const { lab, gapId } = labWithGap();
  for (const attempt of [
    { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" },
    { rung: "package-platform-capability", disposition: "unavailable", outcome: "unresolved" },
    { rung: "user-community-contribution", disposition: "declined" },
  ] as const) {
    const advanced = lab.commandPort.dispatch({ kind: "advance-gap-rung", gapId, ...attempt });
    if (!advanced.ok) throw new Error(`negative walk: ${attempt.rung} refused`);
  }
  const arena = createJourneyArena();
  const gap = lab.stack.organization.getCapabilityGap(gapId, lab.caller);
  if (!gap.ok) throw new Error("negative walk: gap read refused");
  arena.registerLabGapSource(gap.gap);
  const command = arena.decidedCommand({ requestPayload: askDigestOf(gap.gap) });
  const opened = arena.service.openEscalationCase(arena.caller, command);
  if (!opened.ok) throw new Error(`negative walk: case refused: ${opened.detail}`);
  const driven = await arena.service.driveCase(arena.caller, String(opened.case.caseId));
  if (!driven.ok || driven.outcome.status !== "ingested") throw new Error("negative walk: drive did not ingest");
  return { lab, gapId, arena, command, caseId: String(opened.case.caseId) };
}

test("negative (E8): the gap ladder refuses a rung skip with the authoritative code, verbatim", () => {
  const { lab, gapId } = labWithGap();
  const refused = lab.commandPort.dispatch({
    kind: "advance-gap-rung", gapId, rung: "user-community-contribution", disposition: "declined",
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "rung-skip");
  // The refusal is a pure no-op: the trail still holds exactly the
  // existing-organization attempt the discovery recorded.
  const gap = lab.stack.organization.getCapabilityGap(gapId, lab.caller);
  assert.equal(gap.ok, true);
  if (gap.ok) assert.equal(gap.gap.attempts.length, 1, "a refused command appends nothing (E10)");
});

test("negative (E8): a gap that was never recorded refuses with gap-unknown", () => {
  const lab = createJourneyLab();
  const refused = lab.commandPort.dispatch({
    kind: "advance-gap-rung", gapId: "gap-never-recorded", rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved",
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "gap-unknown");
});

test("negative (E8): the typed port refuses malformed intents BEFORE any domain call", () => {
  const { lab, gapId } = labWithGap();
  const gapBefore = lab.stack.organization.getCapabilityGap(gapId, lab.caller);
  assert.equal(gapBefore.ok, true);
  const attemptsBefore = gapBefore.ok ? gapBefore.gap.attempts.length : -1;

  const badAgents = lab.commandPort.dispatch({ kind: "request-search", cycleId: CYCLE_A, seed: SEARCH_SEED_A, maxAgents: 0 });
  assert.equal(badAgents.ok, false);
  assert.equal(badAgents.code, "invalid-intent");

  const blockedRung = lab.commandPort.dispatch({
    kind: "advance-gap-rung", gapId, rung: "blocked", disposition: "declined",
  });
  assert.equal(blockedRung.ok, false);
  assert.equal(blockedRung.code, "invalid-intent", "the terminal rung needs a reason this intent cannot carry");

  const declinedAutonomous = lab.commandPort.dispatch({
    kind: "advance-gap-rung", gapId, rung: "existing-organization", disposition: "declined",
  });
  assert.equal(declinedAutonomous.ok, false);
  assert.equal(declinedAutonomous.code, "invalid-intent", "autonomous rungs cannot be declined");

  const arenaWithoutRef = lab.commandPort.dispatch({
    kind: "advance-gap-rung", gapId, rung: "arena-escalation", disposition: "attempted", outcome: "unresolved",
  });
  assert.equal(arenaWithoutRef.ok, false);
  assert.equal(arenaWithoutRef.code, "invalid-intent", "an actual Arena attempt requires the external ref (lock 32)");

  const unknownKind = lab.commandPort.dispatch({ kind: "not-an-intent" } as unknown as Parameters<typeof lab.commandPort.dispatch>[0]);
  assert.equal(unknownKind.ok, false);
  assert.equal(unknownKind.code, "invalid-intent");

  // None of the refusals reached the domain: the gap trail is untouched.
  const gapAfter = lab.stack.organization.getCapabilityGap(gapId, lab.caller);
  assert.equal(gapAfter.ok, true);
  if (gapAfter.ok) assert.equal(gapAfter.gap.attempts.length, attemptsBefore, "invalid intents never mutate domain state");
});

test("negative (R20): the Lab doors refuse the foreign tenant with cross-tenant, verbatim", async () => {
  const { lab, gapId } = labWithGap();
  const foreign = lab.foreignCaller;
  const attempt: GapRungAttempt = { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" };

  const foreignAdvance = lab.stack.organization.advanceCapabilityGap({ gapId, attempt, as: foreign });
  assert.equal(foreignAdvance.ok, false);
  assert.equal(foreignAdvance.code, "cross-tenant");

  const foreignRead = lab.stack.organization.getCapabilityGap(gapId, foreign);
  assert.equal(foreignRead.ok, false);
  assert.equal(foreignRead.code, "cross-tenant");

  const foreignList = lab.stack.organization.listCapabilityGaps(foreign);
  assert.equal(foreignList.length, 0, "the foreign tenant sees only its own (empty) state");

  const evidenceRows = lab.stack.organization.listEvidence(lab.caller);
  const evaluationId = evidenceRows[0]?.evaluationId;
  if (evaluationId === undefined) throw new Error("negative: no evaluation to calibrate");
  const foreignCalibrate = lab.stack.simulation.calibrate({ evaluationId, as: foreign, observedOutcomeIds: ["observation-lab-thesis-1"] });
  assert.equal(foreignCalibrate.ok, false);
  assert.equal(foreignCalibrate.code, "cross-tenant");

  const records = lab.stack.learning.listLearningCycles(lab.caller);
  const recordId = records[0]?.recordId;
  if (recordId === undefined) throw new Error("negative: no learning record from cycle A");
  const foreignLearning = lab.stack.learning.getLearningCycle(String(recordId), foreign);
  assert.equal(foreignLearning.ok, false);
  assert.equal(foreignLearning.code, "cross-tenant");
});

test("negative (R20): the Arena runtime refuses the foreign tenant with cross-tenant, verbatim", async () => {
  const { arena, caseId } = await walkedToIngestedCase();
  const foreignRead = arena.service.getCase(arena.foreignCaller, caseId);
  assert.equal(foreignRead.ok, false);
  assert.equal(foreignRead.code, "cross-tenant");

  const foreignDrive = await arena.service.driveCase(arena.foreignCaller, caseId);
  assert.equal(foreignDrive.ok, false);
  assert.equal(foreignDrive.code, "cross-tenant");

  const foreignLabels = arena.service.labeledEvidence(arena.foreignCaller, caseId);
  assert.equal(foreignLabels.ok, false);
  assert.equal(foreignLabels.code, "cross-tenant");
});

test("negative (E8): restore refuses a persisted document whose state digest no longer matches", async () => {
  const { arena } = await walkedToIngestedCase();
  const last = arena.store.snapshots().at(-1);
  if (last === undefined) throw new Error("negative: nothing was persisted");
  arena.store.save({ ...last, stateDigest: "ab".repeat(32) });
  const restored = arena.service.restore();
  assert.equal(restored.ok, false);
  assert.equal(restored.code, "tampered-document");
});

test("negative (E8): restore refuses a document recomputed around a forged case identity", async () => {
  const { arena } = await walkedToIngestedCase();
  const last = arena.store.snapshots().at(-1);
  if (last === undefined || last.cases.length === 0) throw new Error("negative: no persisted case");
  const forged = { ...last.cases[0]!, caseDigest: "cd".repeat(32) as never };
  // The attacker recomputes the top-level digest so only the CASE identity
  // check can catch the forgery — and it does.
  const tampered = {
    ...last,
    cases: [forged, ...last.cases.slice(1)],
    stateDigest: String(arenaDocumentDigestOf({ sources: last.sources, cases: [forged, ...last.cases.slice(1)], sendLedger: last.sendLedger, auditLog: last.auditLog })),
  };
  arena.store.save(tampered);
  const restored = arena.service.restore();
  assert.equal(restored.ok, false);
  assert.equal(restored.code, "tampered-document");
});

test("negative (E8): an honest document still restores after the tampered ones are refused", async () => {
  const { arena, caseId } = await walkedToIngestedCase();
  // A fresh service over the SAME store sees the last honest snapshot only
  // if nothing tampered followed it — here nothing did.
  const fresh = new ArenaRuntimeService({
    ports: { clock: { now: () => 25_000 }, store: arena.store, policy: allowAllArenaPolicy("lab-thesis-usage-rules"), transport: arena.arena },
  });
  const restored = fresh.restore();
  assert.equal(restored.ok, true);
  if (restored.ok) assert.equal(restored.cases, 1);
  const read = fresh.getCase(arena.caller, caseId);
  assert.equal(read.ok, true, "the restored case reads back through the door");
});

test("negative (E10): re-opening the same decided escalation resumes the SAME case", async () => {
  const { arena, command, caseId } = await walkedToIngestedCase();
  const reopened = arena.service.openEscalationCase(arena.caller, command);
  assert.equal(reopened.ok, true);
  if (reopened.ok) {
    assert.equal(reopened.duplicate, true, "the duplicate receipt surfaces (E10)");
    assert.equal(String(reopened.case.caseId), caseId, "the SAME content-addressed case resumes");
  }
});

test("negative (E10): a terminal case re-drives as an honest no-op with NO second wire send", async () => {
  const { arena, caseId } = await walkedToIngestedCase();
  const sendsBefore = arena.arena.sentEnvelopes().length;
  const reDriven = await arena.service.driveCase(arena.caller, caseId);
  assert.equal(reDriven.ok, true);
  if (reDriven.ok) {
    assert.equal(reDriven.outcome.status, "terminal", "terminal re-drives are honest no-ops");
    assert.equal(reDriven.outcome.case.lifecycle.state, "ingested", "the terminal state is immutable (E10)");
  }
  assert.equal(arena.arena.sentEnvelopes().length, sendsBefore, "the Arena wire saw exactly one effective send");
});

test("negative (E10): duplicate community submissions and transition replays return their first receipts", async () => {
  const { lab, gapId, arena, caseId } = await walkedToIngestedCase();
  const community = createJourneyCommunity(lab.stack, lab.caller);
  const gap = lab.stack.organization.getCapabilityGap(gapId, lab.caller);
  if (!gap.ok) throw new Error("negative: gap read refused");
  const read = arena.service.getCase(arena.caller, caseId);
  if (!read.ok) throw new Error("negative: case read refused");
  const outcome = {
    caseId,
    escalationId: String(read.case.request.escalationId),
    requestDigest: String(read.case.request.requestDigest),
    lifecycleState: read.case.lifecycle.state,
    evidenceVerdict: read.case.evidencePackage?.verdict ?? "none",
  };

  const first = community.submitArenaOutcome({ outcome, gapRecord: gap.gap });
  assert.equal(first.accepted, true, `the honest submission is admitted: ${first.accepted ? "" : first.code}`);
  const second = community.submitArenaOutcome({ outcome, gapRecord: gap.gap });
  assert.equal(second.accepted, false, "the content-identical replay is NOT a second contribution");
  if (!second.accepted) {
    assert.equal(second.code, "duplicate-contribution", "E10: the first receipt stands");
    assert.ok(second.recorded !== undefined, "the recorded receipt is attached");
  }

  const contributionId = first.accepted ? String(first.contribution.contributionId) : "";
  const maintainer = JOURNEY_MAINTAINER;
  const triage = community.advance({ contributionId, command: "triage", actor: maintainer, reason: "triaged once" });
  assert.equal(triage.accepted, true);
  const replay = community.advance({ contributionId, command: "triage", actor: maintainer, reason: "triaged once" });
  assert.equal(replay.accepted, false, "the transition replay is NOT a second mutation");
  if (!replay.accepted) {
    assert.equal(replay.code, "duplicate-transition", "E10: the first receipt stands");
    assert.ok(replay.recorded !== undefined);
  }
  // The history stays append-only: exactly one submitted + one triaged record.
  const history = community.service.history(lab.caller.tenant, first.accepted ? first.contribution.contributionId : undefined);
  assert.equal(history.length, 2, "no hidden retry, no duplicated transition (E10)");
});
