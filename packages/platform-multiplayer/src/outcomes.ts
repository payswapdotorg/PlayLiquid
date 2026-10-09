/**
 * PROTECTED-OUTCOME ENFORCEMENT (R9, locks 19/41; architecture "Multiplayer":
 * "Rewards, inventory, damage and protected outcomes cannot be
 * client-authoritative").
 *
 * Two disjoint paths live here:
 *
 * 1. REFUSAL path (the only thing client claims ever get): games' clients
 *    submit untrusted claims — {@link ClientSubmittedClaim} (runtime
 *    contracts) or {@link ClientPlayResultClaim} (platform contracts). The
 *    kernel NEVER turns either into an outcome. {@link refuseRuntimeClaim}
 *    and {@link refusePlatformClaim} build the strongest forgery each claim
 *    shape can type-honestly produce and run the BOUND validators
 *    (`validateProtectedOutcome` / `validatePlatformOutcome`) on it — both
 *    refuse with `not-authoritative`, because the only marker a client can
 *    write is the untrusted one. The typed refusal record + the lossy
 *    advisory (runtime-contracts `sanitizeClaim`) is everything a claim
 *    earns.
 *
 * 2. AUTHORITY path (the only path that decides): {@link buildAuthoritative-
 *    Outcome} derives standings from the simulator's final proposal, dense
 *    1-based ranks with a deterministic tie-break, evidence = the session's
 *    COMMITTED events (event ids + content digests), producing BOTH the
 *    runtime-contracts {@link AuthoritativeMatchOutcome} and the
 *    platform-contracts {@link PlatformOutcomeRecord} — then re-validates
 *    both with the bound validators before returning (fail closed).
 *
 * Purity: functions only; the kernel owns the mutable tables these read.
 */

import { sanitizeClaim, validateProtectedOutcome } from "@playliquid/runtime-contracts";
import type {
  AuthoritativeMatchOutcome,
  ClaimId,
  EventId,
  RuntimeEventEnvelope,
  SanitizedClaimRecord,
  SessionEpoch,
  SessionId,
  Tick,
} from "@playliquid/runtime-contracts";
import type {
  AuthoritativeEvidence,
  ClientSubmittedClaim,
  MatchStanding as RuntimeMatchStanding,
  OutcomeId,
} from "@playliquid/runtime-contracts";
import {
  asMatchSessionId,
  asContentDigest,
  validatePlatformOutcome,
} from "@playliquid/platform-contracts";
import { asOutcomeId } from "@playliquid/runtime-contracts";
import type {
  ClientPlayResultClaim,
  ContentDigest,
  MatchStanding as PlatformMatchStanding,
  PlatformOutcomeRecord,
  ProtectedOutcomeKind,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";
import type { StandingProposal } from "./ports.ts";
import { digestOf } from "./digest.ts";

// ---------------------------------------------------------------------------
// Refusal path (client claims never decide)
// ---------------------------------------------------------------------------

/** The refusal core shared by both claim shapes. */
export interface ClientClaimRefusalCore {
  readonly session: SessionId;
  readonly atEpoch: SessionEpoch;
  /** The bound validator's own refusal code (never an ok code). */
  readonly code: "not-authoritative" | "empty-evidence-chain" | "malformed-record" | "bad-standing-rank" | "session-mismatch";
  readonly detail: string;
}

/** Typed refusal record produced for every client claim (E8 evidence). */
export type ClientClaimRefusal =
  | {
      readonly source: "runtime-claim";
      readonly claimId: ClaimId;
      readonly core: ClientClaimRefusalCore;
      /** The lossy advisory record (runtime-contracts sanitizeClaim). */
      readonly advisory: SanitizedClaimRecord;
    }
  | {
      readonly source: "platform-claim";
      readonly core: ClientClaimRefusalCore;
      /** The untrusted claim itself, kept as advisory-only data. */
      readonly advisory: ClientPlayResultClaim;
    };

/**
 * Refuse a runtime-contracts client claim. The strongest type-honest
 * forgery the claim can produce uses the claim's own `untrusted` marker as
 * the `decidedBy` slot — `validateProtectedOutcome` refuses it with
 * `not-authoritative`. The claim leaves as advisory data only.
 */
export function refuseRuntimeClaim(
  claim: ClientSubmittedClaim,
  atEpoch: SessionEpoch,
): ClientClaimRefusal {
  const advisory = sanitizeClaim(claim);
  const untrustedMarker = (claim.payload as { readonly untrusted?: unknown }).untrusted;
  const forgery = {
    outcomeId: asOutcomeId(`claim:${String(claim.claimId)}`),
    sessionId: claim.sessionId,
    epoch: atEpoch,
    // The only marker a client can structurally write is the untrusted one.
    decidedBy: untrustedMarker,
    decidedAtTick: 0,
    evidence: { kind: "client-asserted", eventIds: [], marker: untrustedMarker },
    standings: [],
  } as unknown as AuthoritativeMatchOutcome;
  const validation = validateProtectedOutcome(forgery);
  return {
    source: "runtime-claim",
    claimId: claim.claimId,
    core: {
      session: claim.sessionId,
      atEpoch,
      code: validation.ok ? "not-authoritative" : validation.code,
      detail: validation.ok
        ? "claim laundered past the validator; refusing by construction"
        : "client claims are never assignable to authoritative outcomes (R9 / lock 19)",
    },
    advisory,
  };
}

/**
 * Refuse a platform-contracts client play-result claim. The strongest
 * type-honest forgery fills `decidedBy` with the claim's disjoint untrusted
 * marker — `validatePlatformOutcome` refuses with `not-authoritative`.
 */
export function refusePlatformClaim(
  claim: ClientPlayResultClaim,
  session: SessionId,
  atEpoch: SessionEpoch,
): ClientClaimRefusal {
  const forgery = {
    session: claim.session,
    decidedBy: claim.untrusted,
    evidence: [],
    standings: [
      { subject: "subject", rank: claim.clientClaimedRank, score: 0, grants: [] },
    ],
  } as unknown as PlatformOutcomeRecord;
  const validation = validatePlatformOutcome(forgery);
  return {
    source: "platform-claim",
    core: {
      session,
      atEpoch,
      code: validation.ok ? "not-authoritative" : validation.code,
      detail: "client play-result claims never satisfy platform outcome validation (lock 19/41)",
    },
    advisory: claim,
  };
}

// ---------------------------------------------------------------------------
// Authority path (committed events are the only evidence)
// ---------------------------------------------------------------------------

/** Everything the authority path needs to decide an outcome. */
export interface OutcomeBuildInput {
  readonly sessionId: SessionId;
  readonly tenant: TenantId;
  readonly epoch: SessionEpoch;
  readonly decidedAtTick: Tick;
  /** Committed events of the session (non-empty; the evidence chain). */
  readonly evidenceEvents: readonly RuntimeEventEnvelope[];
  /** Simulator final standings, already filtered to known participants. */
  readonly standings: readonly StandingProposal[];
  /** actorId -> protected kinds its actor earned via committed protected events. */
  readonly protectedGrants: Readonly<Record<string, readonly ProtectedOutcomeKind[]>>;
  /** actorId -> platform subject (from the admission roster). */
  readonly subjectOfActor: Readonly<Record<string, SubjectId>>;
}

/** Result of the authority path. */
export type OutcomeBuildResult =
  | {
      readonly ok: true;
      readonly outcome: AuthoritativeMatchOutcome;
      readonly record: PlatformOutcomeRecord;
    }
  | {
      readonly ok: false;
      readonly code: "empty-evidence-chain" | "no-standings" | "outcome-invalid";
      readonly detail: string;
    };

/**
 * THE authority path. Deterministic: standings are ranked by score
 * descending with actorId ascending as the tie-break, producing dense
 * 1-based ranks (exactly what the platform validator demands). Evidence is
 * the committed event chain — event ids for the runtime outcome, content
 * digests for the platform record. Both artifacts are re-validated with the
 * bound validators before returning; a structural surprise fails closed.
 */
export function buildAuthoritativeOutcome(input: OutcomeBuildInput): OutcomeBuildResult {
  if (input.evidenceEvents.length === 0) {
    return { ok: false, code: "empty-evidence-chain", detail: "no committed events to evidence the outcome" };
  }
  const matchSession = asMatchSessionId(String(input.sessionId));
  if (matchSession === undefined) {
    return { ok: false, code: "outcome-invalid", detail: "session id is not valid platform id text" };
  }
  // Only standings whose actors map to admitted platform subjects can be
  // ranked; filtering BEFORE ranking keeps the dense 1..n invariant the
  // platform validator demands (no rank holes from dropped strangers).
  const mappable = input.standings.filter(
    (standing) => input.subjectOfActor[String(standing.actor.actorId)] !== undefined,
  );
  if (mappable.length === 0) {
    return { ok: false, code: "no-standings", detail: "no participants with standings" };
  }
  const ordered = [...mappable].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.actor.actorId) < String(b.actor.actorId) ? -1 : 1;
  });
  const outcomeId: OutcomeId = asOutcomeId(
    `outcome:${String(input.sessionId)}:${String(input.epoch)}`,
  );
  const evidence: AuthoritativeEvidence = {
    kind: "committed-events",
    eventIds: input.evidenceEvents.map((event) => event.eventId) as readonly EventId[],
    marker: "authoritative-runtime-decided",
  };
  const runtimeStandings: readonly RuntimeMatchStanding[] = ordered.map((standing, index) => ({
    actor: standing.actor,
    rank: index + 1,
    score: standing.score,
    grants: input.protectedGrants[String(standing.actor.actorId)] ?? [],
  }));
  const outcome: AuthoritativeMatchOutcome = {
    outcomeId,
    sessionId: input.sessionId,
    epoch: input.epoch,
    decidedBy: "authoritative-runtime-decided",
    decidedAtTick: input.decidedAtTick,
    evidence,
    standings: runtimeStandings,
  };
  const platformStandings: readonly PlatformMatchStanding[] = ordered
    .map((standing, index) => {
      const subject = input.subjectOfActor[String(standing.actor.actorId)];
      if (subject === undefined) return undefined;
      return {
        subject,
        rank: index + 1,
        score: standing.score,
        grants: input.protectedGrants[String(standing.actor.actorId)] ?? [],
      } satisfies PlatformMatchStanding;
    })
    .filter((standing): standing is PlatformMatchStanding => standing !== undefined);
  const digests: readonly ContentDigest[] = input.evidenceEvents.map((event) =>
    asContentDigest(String(digestOf(canonicalEventView(event))))!,
  );
  const record: PlatformOutcomeRecord = {
    tenant: input.tenant,
    session: matchSession,
    decidedBy: "platform-authority",
    evidence: digests,
    standings: platformStandings,
  };
  const outcomeValidation = validateProtectedOutcome(outcome);
  const recordValidation = validatePlatformOutcome(record);
  if (!outcomeValidation.ok) {
    return { ok: false, code: "outcome-invalid", detail: `runtime outcome: ${String(outcomeValidation.code)}` };
  }
  if (!recordValidation.ok) {
    return { ok: false, code: "outcome-invalid", detail: `platform record: ${String(recordValidation.code)}` };
  }
  return { ok: true, outcome, record };
}

/** JSON view of an event used for content digests (brand-free, stable). */
function canonicalEventView(event: RuntimeEventEnvelope): unknown {
  return {
    eventId: String(event.eventId),
    sessionId: String(event.sessionId),
    kind: String(event.kind),
    seq: event.seq,
    tick: event.tick,
    cause: event.cause.kind === "command"
      ? { kind: "command", commandId: String(event.cause.commandId) }
      : event.cause.kind === "event"
        ? { kind: "event", causedByEventId: String(event.cause.causedByEventId) }
        : { kind: "system" },
    payload: event.payload,
  };
}

// ---------------------------------------------------------------------------
// The kernel-side authority decision (pure compute, kernel applies)
// ---------------------------------------------------------------------------

/** Everything the pure decision computation needs (kernel read models). */
export interface OutcomeDecisionComputeInput {
  readonly sessionId: SessionId;
  readonly tenant: TenantId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  readonly mayDecideProtectedOutcomes: boolean;
  readonly origin: { readonly kind: string; readonly actorClass: string };
  readonly decidedOutcomeId: string | null;
  /** Final standings the simulator seam proposed for the participants. */
  finalStandings: readonly StandingProposal[];
  readonly participants: readonly { readonly actorId: string; readonly subject: SubjectId }[];
  readonly earnedGrants: Readonly<Record<string, readonly ProtectedOutcomeKind[]>>;
  readonly evidenceEvents: readonly RuntimeEventEnvelope[];
}

/** The pure computation result (the kernel applies the side effects). */
export type OutcomeComputation =
  | {
      readonly ok: true;
      readonly outcome: AuthoritativeMatchOutcome;
      readonly record: PlatformOutcomeRecord;
      readonly eventPayload: unknown;
    }
  | {
      readonly ok: false;
      readonly code:
        | "origin-not-authorized"
        | "p2p-cannot-decide-outcomes"
        | "outcome-already-decided"
        | "no-standings"
        | "empty-evidence-chain"
        | "outcome-invalid";
      readonly detail: string;
    };

/**
 * Pure authority-path computation: origin authorization, topology
 * legality, single-decision immutability (E10), grant accounting (every
 * ranked participant earns `standing` + `score`; event-mapped kinds add
 * the rest) and the dual-artifact build. The kernel emits the
 * `platform.multiplayer.outcome.decided` event and delivers the outcome.
 */
export function computeAuthorityOutcome(
  input: OutcomeDecisionComputeInput,
): OutcomeComputation {
  if (!input.mayDecideProtectedOutcomes) {
    return {
      ok: false,
      code: "p2p-cannot-decide-outcomes",
      detail: "peer-to-peer topology can never decide protected outcomes (lock 19)",
    };
  }
  if (input.origin.kind !== "platform-system" || input.origin.actorClass !== "platform-system") {
    return {
      ok: false,
      code: "origin-not-authorized",
      detail: "outcomes are decided only by the platform authority path",
    };
  }
  if (input.decidedOutcomeId !== null) {
    return {
      ok: false,
      code: "outcome-already-decided",
      detail: `outcome ${input.decidedOutcomeId} already stands (E10)`,
    };
  }
  const subjectOfActor: Record<string, SubjectId> = {};
  for (const participant of input.participants) {
    subjectOfActor[participant.actorId] = participant.subject;
  }
  const grants: Record<string, readonly ProtectedOutcomeKind[]> = {};
  for (const participant of input.participants) {
    const granted = new Set<ProtectedOutcomeKind>([
      ...(input.earnedGrants[participant.actorId] ?? []),
      "standing",
      "score",
    ]);
    grants[participant.actorId] = [...granted].sort();
  }
  const built = buildAuthoritativeOutcome({
    sessionId: input.sessionId,
    tenant: input.tenant,
    epoch: input.epoch,
    decidedAtTick: input.tick,
    evidenceEvents: input.evidenceEvents,
    standings: input.finalStandings,
    protectedGrants: grants,
    subjectOfActor,
  });
  if (!built.ok) {
    return { ok: false, code: built.code, detail: built.detail };
  }
  return {
    ok: true,
    outcome: built.outcome,
    record: built.record,
    eventPayload: {
      outcomeId: String(built.outcome.outcomeId),
      standings: built.outcome.standings.map((standing) => ({
        actor: String(standing.actor.actorId),
        rank: standing.rank,
        score: standing.score,
      })),
    },
  };
}
