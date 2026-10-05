/**
 * MULTIPLAYER AUTHORITY CONTRACTS (requirement R9, lock rule 19).
 *
 * "Competitive outcomes are authoritative outside the untrusted client."
 * This module encodes that split in the type system itself:
 *
 * - Everything a client sends is an {@link ClientSubmittedClaim}: UNTRUSTED
 *   input, branded as such. It is not assignable to any authoritative type
 *   (proven by type-level misuse tests with `@ts-expect-error`).
 * - Outcomes are {@link AuthoritativeMatchOutcome}: decided only by the
 *   authoritative runtime, always carrying a causal evidence chain of
 *   committed event ids and an explicit authority marker.
 * - {@link sanitizeClaim} is the ONLY coercion path from claim to a
 *   structured record, and it is deliberately lossy: client-asserted
 *   fields that could masquerade as authority (scores, rewards, damage,
 *   entitlements) are demoted to advisory metadata and never promoted
 *   (requirement E8 negative tests cover attempts to launder them).
 * - {@link validateProtectedOutcome} enforces that protected outcome kinds
 *   (rewards, inventory, damage, standings) always carry non-empty
 *   authoritative evidence; client claims can never satisfy it because
 *   {@link ClaimEvidence} is branded untrusted.
 */

import type {
  ActorRef,
  ClaimId,
  EventId,
  OutcomeId,
  SessionId,
  SessionEpoch,
  Tick,
} from "./primitives.ts";
import type { Digest } from "./primitives.ts";

/**
 * Explicit marker every untrusted client payload is intersected with.
 * Clients construct claims by writing this marker — the price of admission
 * is acknowledging untrustedness. The marker makes untrusted payloads
 * non-assignable to plain (potentially authoritative) payload types.
 */
export interface Untrusted {
  readonly untrusted: "untrusted-client-input";
}

/** Payload a client claims happened. Brand: UNTRUSTED. */
export interface ClientSubmittedClaim<P = unknown> {
  readonly claimId: ClaimId;
  readonly sessionId: SessionId;
  readonly actor: ActorRef;
  readonly clientAsserted: ClientAssertedFields;
  readonly payload: P & Untrusted;
}

/**
 * Advisory-only fields asserted by the client. Structurally present so
 * transports can carry them, but every consumer must treat them as hints.
 */
export interface ClientAssertedFields {
  readonly clientClaimedScore?: number;
  readonly clientClaimedOutcome?: string;
  readonly clientClaimedRewards?: readonly string[];
}

/**
 * Evidence a client may attach to a claim. Marked UNTRUSTED: it can never
 * be used to satisfy {@link AuthoritativeEvidence} requirements (the
 * `kind` literals are disjoint).
 */
export interface ClaimEvidence {
  readonly kind: "client-asserted";
  readonly artifacts: readonly Digest[];
  readonly untrusted: Untrusted;
}

/** Marker that only the authoritative runtime can structurally provide. */
export type AuthorityMarker = "authoritative-runtime-decided";

/** Evidence chain that only authoritative committed events can satisfy. */
export interface AuthoritativeEvidence {
  readonly kind: "committed-events";
  readonly eventIds: readonly EventId[];
  readonly marker: AuthorityMarker;
}

/** Outcome kinds that are never client-decidable (lock rules 19, 41). */
export type ProtectedOutcomeKind = "reward" | "inventory" | "damage" | "standing" | "score";

/**
 * The authoritative outcome record. Produced only by the authoritative
 * runtime / multiplayer server. Not constructible from a client claim: the
 * evidence field demands {@link AuthoritativeEvidence}.
 */
export interface AuthoritativeMatchOutcome {
  readonly outcomeId: OutcomeId;
  readonly sessionId: SessionId;
  readonly epoch: SessionEpoch;
  readonly decidedBy: AuthorityMarker;
  readonly decidedAtTick: Tick;
  readonly evidence: AuthoritativeEvidence;
  readonly standings: readonly MatchStanding[];
}

/** One participant's authoritative standing in a match. */
export interface MatchStanding {
  readonly actor: ActorRef;
  readonly rank: number;
  readonly score: number;
  /** Protected kinds granted by THIS authoritative outcome only. */
  readonly grants: readonly ProtectedOutcomeKind[];
}

/** Pure validation of an authoritative outcome's integrity invariants. */
export type ProtectedOutcomeValidation =
  | { readonly ok: true; readonly outcomeId: OutcomeId }
  | {
      readonly ok: false;
      readonly code: "empty-evidence-chain" | "not-authoritative" | "bad-standing-rank";
    };

export function validateProtectedOutcome(
  outcome: AuthoritativeMatchOutcome,
): ProtectedOutcomeValidation {
  if (outcome.decidedBy !== "authoritative-runtime-decided") {
    return { ok: false, code: "not-authoritative" };
  }
  if (outcome.evidence.kind !== "committed-events" || outcome.evidence.eventIds.length === 0) {
    return { ok: false, code: "empty-evidence-chain" };
  }
  for (const standing of outcome.standings) {
    if (!Number.isSafeInteger(standing.rank) || standing.rank < 1) {
      return { ok: false, code: "bad-standing-rank" };
    }
  }
  return { ok: true, outcomeId: outcome.outcomeId };
}

/** The lossy, advisory-only record produced from a client claim. */
export interface SanitizedClaimRecord<P = unknown> {
  readonly claimId: ClaimId;
  readonly sessionId: SessionId;
  readonly actor: ActorRef;
  readonly trust: "untrusted-advisory";
  readonly advisory: Readonly<ClientAssertedFields>;
  readonly payload: P & Untrusted;
}

/**
 * The ONLY sanctioned path from client claim to structured data. Pure and
 * deliberately lossy: nothing here can promote a client-asserted field into
 * an authoritative slot. Downstream systems may use `advisory` for hints
 * (e.g. prediction, UX), never for outcomes (R9).
 */
export function sanitizeClaim<P>(claim: ClientSubmittedClaim<P>): SanitizedClaimRecord<P> {
  return {
    claimId: claim.claimId,
    sessionId: claim.sessionId,
    actor: claim.actor,
    trust: "untrusted-advisory",
    advisory: claim.clientAsserted,
    payload: claim.payload,
  };
}

/**
 * Adjudication contract: how the authoritative multiplayer service resolves
 * a batch of claims against its own committed event stream. The result is
 * always authoritative output plus per-claim dispositions — claims never
 * pass through unchanged as outcomes.
 */
export interface ClaimAdjudication {
  readonly outcome: AuthoritativeMatchOutcome;
  readonly dispositions: readonly ClaimDisposition[];
}

export type ClaimDisposition =
  | { readonly claimId: ClaimId; readonly disposition: "corroborated"; readonly evidenceEventIds: readonly EventId[] }
  | { readonly claimId: ClaimId; readonly disposition: "unverifiable" }
  | { readonly claimId: ClaimId; readonly disposition: "contradicted"; readonly authoritativeEventIds: readonly EventId[] };
