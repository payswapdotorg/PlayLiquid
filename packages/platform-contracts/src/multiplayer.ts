/**
 * MULTIPLAYER PLATFORM SERVICE CONTRACTS (R7 / lock 17; R9 / lock 19).
 *
 * "Competitive outcomes are authoritative outside the untrusted client."
 *
 * This module is the PLATFORM service surface: matchmaking, session
 * admission administration and outcome registration. It deliberately does
 * NOT redefine the session-internal authority machinery (claims, epochs,
 * committed-event evidence chains) — that is owned by
 * `@playliquid/runtime-contracts` (PL-003) and is not imported here per
 * spec/module-dependency-matrix.md (platform-contracts depends on
 * game-contracts only). PL-016 (multiplayer authority service) binds the
 * two at the implementation layer.
 *
 * Authority split encoded structurally:
 * - {@link PlatformOutcomeRecord} — decided only by the platform authority
 *   marker, always carrying content-addressed evidence and standings.
 * - {@link ClientPlayResultClaim} — untrusted client assertion, carrying
 *   the disjoint `untrusted` marker; not assignable (type-misuse test).
 * - {@link MultiplayerEventBinding} — how a GAME classifies its own events
 *   (lock 18): `protected` events (rewards, inventory, damage, standings,
 *   score) can never be client-decided; `validateCapabilityPolicy`
 *   (policy.ts) refuses `protected` bindings under peer-to-peer topology.
 *
 * Purity: pure types + pure guards + a pure admission oracle. No IO.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { ContentDigest, SubjectId, TenantId } from "./primitives.ts";
import { isPlatformAuthorityMarker } from "./primitives.ts";
import type { GameEventKind, UntrustedClientInput } from "./events.ts";

/** Identifier of one authoritative multiplayer match session. */
export type MatchSessionId = Brand<string, "MatchSessionId">;

/** Parses and validates `text` as a {@link MatchSessionId}. */
export function asMatchSessionId(text: string): MatchSessionId | undefined {
  return isValidIdText(text) ? (text as MatchSessionId) : undefined;
}

/** Identifier of one matchmaking ticket. */
export type MatchmakingTicketId = Brand<string, "MatchmakingTicketId">;

/** Parses and validates `text` as a {@link MatchmakingTicketId}. */
export function asMatchmakingTicketId(text: string): MatchmakingTicketId | undefined {
  return isValidIdText(text) ? (text as MatchmakingTicketId) : undefined;
}

// ---------------------------------------------------------------------------
// Service policy (cross-checked with the game's game-contracts
// `MultiplayerPolicy` declaration by the policy validator)
// ---------------------------------------------------------------------------

/** Platform multiplayer service behavior descriptor. */
export interface MultiplayerServicePolicy {
  readonly topology: "authoritative-server" | "authoritative-relay" | "peer-to-peer";
  /** Whether the sessions governed by this policy decide competitive outcomes. */
  readonly competitiveUse: boolean;
  readonly admission: "open" | "invite" | "matchmade";
}

/** Returns true when `value` is a structurally valid {@link MultiplayerServicePolicy}. */
export function isMultiplayerServicePolicy(value: unknown): value is MultiplayerServicePolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (
    policy.topology !== "authoritative-server" &&
    policy.topology !== "authoritative-relay" &&
    policy.topology !== "peer-to-peer"
  ) {
    return false;
  }
  if (typeof policy.competitiveUse !== "boolean") return false;
  // Lock 19: peer-to-peer topology cannot guarantee outcomes decided
  // outside the untrusted client — competitive use is structurally refused.
  if (policy.competitiveUse && policy.topology === "peer-to-peer") return false;
  return policy.admission === "open" || policy.admission === "invite" || policy.admission === "matchmade";
}

// ---------------------------------------------------------------------------
// Game-side event binding (lock 18)
// ---------------------------------------------------------------------------

/** Outcome kinds that are never client-decidable (lock rules 19, 41). */
export type ProtectedOutcomeKind = "reward" | "inventory" | "damage" | "standing" | "score";

/**
 * How a game classifies one of ITS declared events for multiplayer
 * purposes. `protected` events feed authoritative outcomes; the platform
 * refuses to let any client-decided value stand for them.
 */
export interface MultiplayerEventBinding {
  readonly capability: "multiplayer";
  readonly eventKind: GameEventKind;
  readonly outcomeClassification: "protected" | "informational";
}

/** Returns true when `value` is a structurally valid {@link MultiplayerEventBinding}. */
export function isMultiplayerEventBinding(value: unknown): value is MultiplayerEventBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return (
    binding.capability === "multiplayer" &&
    typeof binding.eventKind === "string" &&
    binding.eventKind.length > 0 &&
    (binding.outcomeClassification === "protected" || binding.outcomeClassification === "informational")
  );
}

// ---------------------------------------------------------------------------
// Matchmaking request / response
// ---------------------------------------------------------------------------

/** A subject asking the platform to find them a match. */
export interface MatchmakingRequest {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly pool: string;
  readonly maxWaitMs: number;
}

/** Returns true when `value` is a structurally valid {@link MatchmakingRequest}. */
export function isMatchmakingRequest(value: unknown): value is MatchmakingRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.subject === "string" &&
    request.subject.length > 0 &&
    typeof request.pool === "string" &&
    request.pool.length > 0 &&
    typeof request.maxWaitMs === "number" &&
    Number.isSafeInteger(request.maxWaitMs) &&
    request.maxWaitMs >= 0
  );
}

/** Lifecycle states of a matchmaking ticket (service owns transitions). */
export type MatchmakingTicketStatus = "queued" | "matched" | "cancelled" | "expired";

/** The platform's response to a {@link MatchmakingRequest}. */
export interface MatchmakingTicket {
  readonly ticketId: MatchmakingTicketId;
  readonly subject: SubjectId;
  readonly status: MatchmakingTicketStatus;
  readonly issuedAt: number;
}

// ---------------------------------------------------------------------------
// Session admission (pure oracle)
// ---------------------------------------------------------------------------

/** A subject asking to join one session. */
export interface SessionAdmissionRequest {
  readonly tenant: TenantId;
  readonly session: MatchSessionId;
  readonly subject: SubjectId;
  readonly inviteCode?: string;
}

/** The session facts the admission oracle decides over. */
export interface SessionAdmissionFacts {
  readonly session: MatchSessionId;
  readonly tenant: TenantId;
  readonly capacity: number;
  readonly enrolled: number;
  readonly admission: MultiplayerServicePolicy["admission"];
  readonly invitedSubjects: readonly SubjectId[];
}

/** Result of an admission request. */
export type SessionAdmissionDecision =
  | { readonly admitted: true }
  | {
      readonly admitted: false;
      readonly code: "tenant-mismatch" | "session-full" | "not-invited" | "malformed-facts";
    };

/**
 * Pure admission oracle (R20 tenant isolation + capacity policy). The
 * platform decides admission from session facts; a request from another
 * tenant is refused with `tenant-mismatch` (never silently redirected).
 */
export function decideAdmission(
  request: SessionAdmissionRequest,
  facts: SessionAdmissionFacts,
): SessionAdmissionDecision {
  if (
    !Number.isSafeInteger(facts.capacity) ||
    facts.capacity < 1 ||
    !Number.isSafeInteger(facts.enrolled) ||
    facts.enrolled < 0
  ) {
    return { admitted: false, code: "malformed-facts" };
  }
  if (request.tenant !== facts.tenant) return { admitted: false, code: "tenant-mismatch" };
  if (facts.enrolled >= facts.capacity) return { admitted: false, code: "session-full" };
  if (facts.admission === "invite" && !facts.invitedSubjects.includes(request.subject)) {
    return { admitted: false, code: "not-invited" };
  }
  return { admitted: true };
}

// ---------------------------------------------------------------------------
// Outcome registration (authority split, lock 19)
// ---------------------------------------------------------------------------

/** One participant's authoritative standing in a match. */
export interface MatchStanding {
  readonly subject: SubjectId;
  readonly rank: number;
  readonly score: number;
  /** Protected outcome kinds granted to this subject by THIS outcome only. */
  readonly grants: readonly ProtectedOutcomeKind[];
}

/** The only admissible outcome shape: platform-decided, evidence-backed. */
export interface PlatformOutcomeRecord {
  readonly tenant: TenantId;
  readonly session: MatchSessionId;
  readonly decidedBy: "platform-authority";
  readonly evidence: readonly ContentDigest[];
  readonly standings: readonly MatchStanding[];
}

/** What an untrusted client asserts happened. Never admissible as outcome. */
export interface ClientPlayResultClaim {
  readonly session: MatchSessionId;
  readonly clientClaimedRank: number;
  readonly clientClaimedRewards: readonly string[];
  readonly untrusted: UntrustedClientInput["untrusted"];
}

/** Result of outcome-record validation. */
export type OutcomeRecordValidation =
  | { readonly ok: true; readonly session: MatchSessionId }
  | {
      readonly ok: false;
      readonly code: "not-authoritative" | "empty-evidence-chain" | "bad-standing-rank" | "malformed-record";
    };

/**
 * Pure validation of outcome invariants (E8 negative coverage): untrusted
 * or non-platform decider (`not-authoritative`), empty evidence chain
 * (`empty-evidence-chain` — an outcome with no proof never stands), and
 * standings whose ranks are not dense 1-based positives
 * (`bad-standing-rank`).
 */
export function validatePlatformOutcome(value: unknown): OutcomeRecordValidation {
  if (typeof value !== "object" || value === null) return { ok: false, code: "malformed-record" };
  const record = value as Record<string, unknown>;
  if (record.untrusted === "untrusted-client-input") return { ok: false, code: "not-authoritative" };
  if (!isPlatformAuthorityMarker(record.decidedBy)) return { ok: false, code: "not-authoritative" };
  const evidence = record.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return { ok: false, code: "empty-evidence-chain" };
  }
  const standings = record.standings;
  if (!Array.isArray(standings)) return { ok: false, code: "malformed-record" };
  const ranks = new Set<number>();
  for (const standing of standings) {
    const rank = (standing as Record<string, unknown>).rank;
    if (typeof rank !== "number" || !Number.isSafeInteger(rank) || rank < 1) {
      return { ok: false, code: "bad-standing-rank" };
    }
    ranks.add(rank);
  }
  for (let expected = 1; expected <= standings.length; expected += 1) {
    if (!ranks.has(expected)) return { ok: false, code: "bad-standing-rank" };
  }
  if (typeof record.session !== "string" || record.session.length === 0) {
    return { ok: false, code: "malformed-record" };
  }
  return { ok: true, session: record.session as MatchSessionId };
}
