/**
 * SETTLEMENT OPERATIONS — client claims, protected-outcome decisions,
 * snapshot/restore/replay and termination for the authority kernel (split
 * from kernel.ts for the repository's 400-line ceiling). All state lives
 * on the {@link KernelOperationContext}; the kernel instance owns it.
 */

import {
  isTerminalSessionPhase,
  nextSessionEpoch,
  sanitizeClaim,
  validateReplayPlan,
} from "@playliquid/runtime-contracts";
import type { CommandOrigin, SnapshotId } from "@playliquid/runtime-contracts";
import { asEventKind, asEventSequence, asSessionEpoch } from "@playliquid/runtime-contracts";
import type {
  ClientPlayResultClaim,
  ProtectedOutcomeKind,
} from "@playliquid/platform-contracts";
import type { ClientSubmittedClaim } from "@playliquid/runtime-contracts";
import {
  adoptSessionDocument,
  buildSessionDocument,
  rebuildSnapshotRegistry,
} from "./document.ts";
import { computeAuthorityOutcome, refusePlatformClaim, refuseRuntimeClaim } from "./outcomes.ts";
import type { ClientClaimRefusal } from "./outcomes.ts";
import {
  boundaryRecord,
  decodeSnapshotDocument,
  documentStateDigest,
  encodeSnapshotDocument,
} from "./snapshot.ts";
import type {
  ClientClaimResult,
  OutcomeDecisionResult,
  RestoreResult,
  ReplayResult,
  SnapshotResult,
  TerminateResult,
} from "./kernel-types.ts";
import {
  emitEvent,
  recordRefusal,
  systemCause,
  transitionPhase,
  type KernelOperationContext,
} from "./kernel-ops.ts";
import { sessionViewOf } from "./kernel-session.ts";

/** Submit an untrusted runtime-shape client claim: always a typed refusal. */
export function submitClaimOp<S>(
  context: KernelOperationContext<S>,
  claim: ClientSubmittedClaim,
): ClientClaimResult {
  if (claim.sessionId !== context.options.sessionId) {
    const refusal: ClientClaimRefusal = {
      source: "runtime-claim",
      claimId: claim.claimId,
      core: {
        session: claim.sessionId,
        atEpoch: context.state.epoch,
        code: "session-mismatch",
        detail: "claim targets a different session",
      },
      advisory: sanitizeClaim(claim),
    };
    recordRefusal(context, "claim", refusal.core.code, refusal.core.detail);
    return { refused: true, refusal };
  }
  const refusal = refuseRuntimeClaim(claim, context.state.epoch);
  recordRefusal(context, "claim", refusal.core.code, refusal.core.detail);
  context.options.transport.deliver({
    kind: "claim-refused",
    sessionId: context.options.sessionId,
    refusal,
  });
  return { refused: true, refusal };
}

/** Submit an untrusted platform-shape play-result claim: same rule. */
export function submitPlayResultOp<S>(
  context: KernelOperationContext<S>,
  claim: ClientPlayResultClaim,
): ClientClaimResult {
  const refusal = refusePlatformClaim(claim, context.options.sessionId, context.state.epoch);
  recordRefusal(context, "claim", refusal.core.code, refusal.core.detail);
  context.options.transport.deliver({
    kind: "claim-refused",
    sessionId: context.options.sessionId,
    refusal,
  });
  return { refused: true, refusal };
}

/** The platform-authority outcome decision (kernel applies side effects). */
export function decideOutcomeOp<S>(
  context: KernelOperationContext<S>,
  actorClass: string,
  origin: CommandOrigin,
): OutcomeDecisionResult {
  const state = context.state;
  if (context.configuration === undefined || state.simulatorState === undefined) {
    const refused = { ok: false, code: "session-inactive", detail: "session has not opened" } as const;
    recordRefusal(context, "outcome", refused.code, refused.detail);
    return refused;
  }
  if (isTerminalSessionPhase(state.phase)) {
    const refused = { ok: false, code: "session-inactive", detail: `session is ${state.phase}` } as const;
    recordRefusal(context, "outcome", refused.code, refused.detail);
    return refused;
  }
  const final = context.options.simulator.finalize({
    state: state.simulatorState,
    participants: [...state.participants],
  });
  const known = final.standings.filter((standing) =>
    state.participants.some(
      (participant) => String(participant.actor.actorId) === String(standing.actor.actorId),
    ),
  );
  const earnedGrants: Record<string, readonly ProtectedOutcomeKind[]> = {};
  for (const [actorId, kinds] of state.protectedGrants) {
    earnedGrants[actorId] = [...kinds].sort();
  }
  const computation = computeAuthorityOutcome({
    sessionId: context.options.sessionId,
    tenant: context.options.tenant,
    epoch: state.epoch,
    tick: state.tick,
    mayDecideProtectedOutcomes: context.configuration.rules.mayDecideProtectedOutcomes,
    origin: { kind: origin.kind, actorClass },
    decidedOutcomeId: state.decidedOutcomeId === null ? null : String(state.decidedOutcomeId),
    finalStandings: known,
    participants: state.participants.map((participant) => ({
      actorId: String(participant.actor.actorId),
      subject: participant.subject,
    })),
    earnedGrants,
    evidenceEvents: [...state.events],
  });
  if (!computation.ok) {
    recordRefusal(context, "outcome", computation.code, computation.detail);
    return { ok: false, code: computation.code, detail: computation.detail };
  }
  state.decidedOutcomeId = computation.outcome.outcomeId;
  emitEvent(
    context,
    asEventKind("platform.multiplayer.outcome.decided"),
    systemCause(),
    computation.eventPayload,
    state.tick,
  );
  context.options.transport.deliver({
    kind: "outcome-decided",
    sessionId: context.options.sessionId,
    outcome: computation.outcome,
  });
  return { ok: true, outcome: computation.outcome, record: computation.record };
}

/** Persist a byte-stable, content-addressed snapshot of the session. */
export function snapshotOp<S>(context: KernelOperationContext<S>): SnapshotResult {
  const state = context.state;
  if (context.configuration === undefined) {
    return { ok: false, code: "session-not-open", detail: "session has not opened" };
  }
  if (isTerminalSessionPhase(state.phase) || state.phase === "failed") {
    return { ok: false, code: "session-terminal", detail: `session is ${state.phase}` };
  }
  if (state.phase !== "ready" && state.phase !== "running") {
    return { ok: false, code: "wrong-phase", detail: `snapshot not admitted in phase ${state.phase}` };
  }
  const document = buildSessionDocument(state, {
    sessionId: context.options.sessionId,
    tenant: context.options.tenant,
    topology: context.configuration.topology,
    determinism: context.options.determinism,
  });
  const text = encodeSnapshotDocument(document);
  const snapshot = boundaryRecord(
    context.options.sessionId,
    document,
    String(documentStateDigest(text)),
  );
  context.options.store.save({ snapshot, document: text });
  state.snapshots.push(snapshot);
  return { ok: true, snapshot, documentBytes: text.length };
}

/** Restore from a stored snapshot; advances the epoch (stale-result rule). */
export function restoreOp<S>(
  context: KernelOperationContext<S>,
  snapshotId: SnapshotId,
): RestoreResult {
  const state = context.state;
  if (context.configuration === undefined) {
    return { ok: false, code: "session-not-open", detail: "session has not opened" };
  }
  if (isTerminalSessionPhase(state.phase)) {
    return { ok: false, code: "session-terminal", detail: `cannot restore a ${state.phase} session` };
  }
  if (state.phase !== "ready" && state.phase !== "running") {
    return { ok: false, code: "wrong-phase", detail: `restore not admitted in phase ${state.phase}` };
  }
  const record = context.options.store.load(context.options.sessionId, snapshotId);
  if (record === undefined) {
    return { ok: false, code: "unknown-snapshot", detail: "no stored snapshot with that id" };
  }
  const decoded = decodeSnapshotDocument<S>(record.document);
  if (!decoded.ok) {
    return { ok: false, code: "corrupt-snapshot", detail: decoded.detail };
  }
  if (decoded.document.sessionId !== String(context.options.sessionId)) {
    return { ok: false, code: "snapshot-wrong-session", detail: "snapshot belongs to another session" };
  }
  const currentEpoch = state.epoch;
  const document = decoded.document;
  adoptSessionDocument(state, document);
  rebuildSnapshotRegistry(state, context.options.store.list(context.options.sessionId));
  const snapshotEpoch = asSessionEpoch(document.epoch);
  const base = currentEpoch > snapshotEpoch ? currentEpoch : snapshotEpoch;
  state.epoch = nextSessionEpoch(base);
  if (!transitionPhase(context, "ready")) {
    return { ok: false, code: "corrupt-snapshot", detail: "phase machine refused restore-to-ready" };
  }
  return { ok: true, sessionView: sessionViewOf(context), resumedFromTick: document.tick };
}

/** Replay the committed stream (R8 seam; `validateReplayPlan` boundaries). */
export function replayOp<S>(
  context: KernelOperationContext<S>,
  fromSnapshotId?: SnapshotId,
): ReplayResult {
  if (context.configuration === undefined) {
    return { ok: false, code: "session-not-open", detail: "session has not opened" };
  }
  let fromSeq = 1;
  if (fromSnapshotId !== undefined) {
    const boundary =
      context.state.snapshots.find((candidate) => candidate.snapshotId === fromSnapshotId) ??
      context.options.store.load(context.options.sessionId, fromSnapshotId)?.snapshot;
    if (boundary === undefined) {
      return { ok: false, code: "unknown-snapshot", detail: "no stored snapshot with that id" };
    }
    fromSeq = boundary.afterEventSeq + 1;
  }
  const validation = validateReplayPlan(
    {
      sessionId: context.options.sessionId,
      fromEventSeq: asEventSequence(fromSeq),
      toEventSeq: null,
      determinism: context.options.determinism,
    },
    {
      snapshots: context.state.snapshots,
      role: "simulation",
      sessionDeterminism: context.options.determinism,
      committedHeadSeq: asEventSequence(context.state.events.length),
      sessionEpoch: context.state.epoch,
    },
  );
  if (!validation.ok) {
    return { ok: false, code: validation.code, detail: validation.detail };
  }
  return {
    ok: true,
    fromSeq,
    events: context.state.events.filter((event) => event.seq >= fromSeq),
  };
}

/** Cooperatively terminate: settle (if competitive), drain, close. */
export function terminateOp<S>(
  context: KernelOperationContext<S>,
  reason: string,
): TerminateResult {
  const state = context.state;
  if (context.configuration === undefined) {
    return { ok: false, code: "session-not-open", detail: "session has not opened" };
  }
  if (isTerminalSessionPhase(state.phase)) {
    return { ok: false, code: "session-terminal", detail: `session is already ${state.phase}` };
  }
  let outcome = null;
  if (
    context.configuration.servicePolicy.competitiveUse &&
    context.configuration.rules.mayDecideProtectedOutcomes &&
    state.decidedOutcomeId === null &&
    state.participants.length > 0
  ) {
    const decision = decideOutcomeOp(context, "platform-system", { kind: "platform-system" });
    if (decision.ok) outcome = decision.outcome;
  }
  if (!transitionPhase(context, "terminating") || !transitionPhase(context, "terminated")) {
    return { ok: false, code: "session-terminal", detail: "phase machine refused termination" };
  }
  state.pending.length = 0;
  context.options.transport.deliver({
    kind: "session-terminated",
    sessionId: context.options.sessionId,
    reason,
  });
  return { ok: true, reason, outcome };
}
