/**
 * ARENA ESCALATION LIFECYCLE (work order scope; house pattern from
 * game-contracts' game lifecycle machine — single-owner frozen table, E1).
 *
 * draft → authorized → sent → responded → ingested | rejected | expired
 *
 * - `authorized` requires an audit-tracked authorization decision (the
 *   policy port lives in `policy.ts`; the audit trail in
 *   `authorization.ts`). A DENIED decision ends the escalation as
 *   `rejected` straight from `draft`.
 * - `sent` is reached through the {@link settleArenaSend} idempotency
 *   oracle (E6): one request payload to one endpoint is sent at most once
 *   effectively; replays are `duplicate-send`, key collisions are refused.
 * - `responded` is reached when a structurally valid response envelope
 *   arrived; `ingested` when its evidence package was filed (settle oracle
 *   in `ingestion.ts`); `rejected` from `responded` when the response was
 *   refused by validation.
 * - `expired` is reachable from every non-terminal state: the deadline is
 *   caller-owned (`expiresAt`), and {@link expireArenaEscalation} is the
 *   pure deadline fold (no clock reads).
 *
 * Terminal states (`ingested`, `rejected`, `expired`) have no outgoing
 * transitions: historical observations are immutable (E10).
 *
 * State-machine authority is single-owner and lives HERE; consumers fold
 * it, they never re-implement it.
 *
 * Purity: no IO, no clock, no randomness.
 */

import { frozenVocabulary } from "./primitives.ts";
import type { ArenaContentDigest, ArenaTimestampMs } from "./primitives.ts";
import { arenaSendIdempotencyKey, arenaSendIdempotencyKeyEquals, isArenaRequestEnvelope } from "./request.ts";
import type { ArenaRequestKind, ArenaSendIdempotencyKey } from "./request.ts";

// ---------------------------------------------------------------------------
// States and the frozen transition table
// ---------------------------------------------------------------------------

/**
 * The escalation lifecycle states. `ingested`, `rejected` and `expired`
 * are terminal.
 */
export type ArenaLifecycleState = "draft" | "authorized" | "sent" | "responded" | "ingested" | "rejected" | "expired";

/** All valid {@link ArenaLifecycleState} values. */
export const ARENA_LIFECYCLE_STATES = frozenVocabulary<ArenaLifecycleState>("arena-lifecycle-state", [
  "draft",
  "authorized",
  "sent",
  "responded",
  "ingested",
  "rejected",
  "expired",
]);

/** Returns true when `value` is a valid {@link ArenaLifecycleState}. */
export function isArenaLifecycleState(value: unknown): value is ArenaLifecycleState {
  return ARENA_LIFECYCLE_STATES.is(value);
}

/**
 * The frozen transition table. `rejected` branches from `draft` (policy
 * denial) and from `responded` (response refused by validation); `expired`
 * branches from every non-terminal state (caller-owned deadline). The
 * table is frozen: changing it is a breaking contract change requiring an
 * Architecture Change Request.
 */
export const ARENA_LIFECYCLE_TRANSITIONS: Readonly<Record<ArenaLifecycleState, readonly ArenaLifecycleState[]>> =
  Object.freeze({
    draft: Object.freeze(["authorized", "rejected", "expired"] as readonly ArenaLifecycleState[]),
    authorized: Object.freeze(["sent", "expired"] as readonly ArenaLifecycleState[]),
    sent: Object.freeze(["responded", "expired"] as readonly ArenaLifecycleState[]),
    responded: Object.freeze(["ingested", "rejected", "expired"] as readonly ArenaLifecycleState[]),
    ingested: Object.freeze([] as readonly ArenaLifecycleState[]),
    rejected: Object.freeze([] as readonly ArenaLifecycleState[]),
    expired: Object.freeze([] as readonly ArenaLifecycleState[]),
  });

/** Returns true when `from → to` is a legal lifecycle transition. */
export function canTransitionArenaLifecycle(from: ArenaLifecycleState, to: ArenaLifecycleState): boolean {
  return ARENA_LIFECYCLE_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Lifecycle records
// ---------------------------------------------------------------------------

/** One applied transition, as kept in the record's immutable history. */
export type ArenaLifecycleTransitionRecord = Readonly<{
  from: ArenaLifecycleState;
  to: ArenaLifecycleState;
  at?: ArenaTimestampMs;
}>;

/**
 * The lifecycle state of one Arena escalation attempt, keyed outside this
 * record by its {@link ArenaSendIdempotencyKey} (endpoint + request
 * payload digest). `history` is append-only; `expiresAt` is the
 * caller-owned deadline this record was created with.
 */
export type ArenaLifecycleRecord = Readonly<{
  state: ArenaLifecycleState;
  history: readonly ArenaLifecycleTransitionRecord[];
  expiresAt?: ArenaTimestampMs;
}>;

/** The initial lifecycle record: a fresh draft with empty history. */
export function initialArenaLifecycle(expiresAt?: ArenaTimestampMs): ArenaLifecycleRecord {
  return expiresAt === undefined
    ? Object.freeze({ state: "draft" as const, history: Object.freeze([]) })
    : Object.freeze({ state: "draft" as const, history: Object.freeze([]), expiresAt });
}

/** Reasons an advance can be refused (frozen vocabulary). */
export type ArenaLifecycleAdvanceRefusal = "illegal-transition";

/** Outcome of {@link advanceArenaLifecycle}. */
export type ArenaLifecycleAdvanceResult =
  | { readonly ok: true; readonly record: ArenaLifecycleRecord }
  | { readonly ok: false; readonly reason: ArenaLifecycleAdvanceRefusal };

/**
 * Pure state advance: appends one transition to the record's history and
 * returns the NEW record (inputs are never mutated, E10). Refuses illegal
 * transitions — including self-transitions and anything leaving a
 * terminal state — with the frozen refusal vocabulary.
 */
export function advanceArenaLifecycle(
  record: ArenaLifecycleRecord,
  to: ArenaLifecycleState,
  at?: ArenaTimestampMs,
): ArenaLifecycleAdvanceResult {
  if (record.state === to || !canTransitionArenaLifecycle(record.state, to)) {
    return { ok: false, reason: "illegal-transition" };
  }
  const transition: ArenaLifecycleTransitionRecord = Object.freeze(
    at === undefined ? { from: record.state, to } : { from: record.state, to, at },
  );
  return {
    ok: true,
    record: Object.freeze({ ...record, state: to, history: Object.freeze([...record.history, transition]) }),
  };
}

/**
 * The pure deadline fold: advances the record to `expired` if and only if
 * `now` has reached the record's `expiresAt` and the record is not
 * already terminal. No clock is read — both time points are inputs.
 */
export function expireArenaEscalation(record: ArenaLifecycleRecord, now: ArenaTimestampMs): ArenaLifecycleAdvanceResult {
  if (record.expiresAt === undefined || now < record.expiresAt) {
    return { ok: false, reason: "illegal-transition" };
  }
  return advanceArenaLifecycle(record, "expired", now);
}

// ---------------------------------------------------------------------------
// Send idempotency oracle (E6)
// ---------------------------------------------------------------------------

/** The stored record of one effective send (owned by the Lab-side Arena runtime, PL-031). */
export type ArenaSendReceipt = Readonly<{
  key: ArenaSendIdempotencyKey;
  requestKind: ArenaRequestKind;
  gapSummary: ArenaContentDigest;
}>;

/** The disposition of one send attempt (house pattern: first receipt stands, collisions refused). */
export type ArenaSendDisposition =
  | { readonly status: "sent"; readonly receipt: ArenaSendReceipt }
  | { readonly status: "duplicate-send"; readonly receipt: ArenaSendReceipt }
  | { readonly status: "send-collision"; readonly key: ArenaSendIdempotencyKey };

/**
 * The pure send oracle: one request payload to one endpoint is sent at
 * most once effectively.
 *
 * - no prior receipt (or a receipt under a DIFFERENT key) → `sent` with a
 *   new receipt;
 * - prior receipt with the same key and the same kind/gap-summary →
 *   `duplicate-send`: the first send stands, nothing new is issued;
 * - prior receipt with the same key but a different kind or gap summary →
 *   `send-collision`: REFUSED outright (E8: never silently executed as a
 *   second, different request under one key).
 *
 * Malformed envelopes are refused with `send-collision` semantics minus a
 * key (they cannot be keyed at all) — represented by `not-sendable`.
 */
export type ArenaSendAttemptResult =
  | ArenaSendDisposition
  | { readonly status: "not-sendable" };

/** Folds one send attempt against the prior receipt for its key. */
export function settleArenaSend(prior: ArenaSendReceipt | undefined, envelope: unknown): ArenaSendAttemptResult {
  if (!isArenaRequestEnvelope(envelope)) return { status: "not-sendable" };
  const key = arenaSendIdempotencyKey(envelope);
  if (prior !== undefined && arenaSendIdempotencyKeyEquals(prior.key, key)) {
    const sameEnvelope = prior.requestKind === envelope.requestKind && prior.gapSummary === envelope.cycle.gapSummary;
    return sameEnvelope ? { status: "duplicate-send", receipt: prior } : { status: "send-collision", key };
  }
  return {
    status: "sent",
    receipt: Object.freeze({
      key,
      requestKind: envelope.requestKind,
      gapSummary: envelope.cycle.gapSummary,
    }),
  };
}
