/**
 * ENTITLEMENT LIFECYCLE CONTRACTS (R10 refinement, PL-009).
 *
 * Typed state machine for the entitlement lifecycle —
 * grant -> hold -> settle/revoke — using the house state-machine pattern
 * (frozen transition table + pure guard, cf. `GAME_LIFECYCLE_TRANSITIONS`
 * in @playliquid/game-contracts). `settled` and `revoked` are terminal:
 * settlement is append-only; a settled entitlement is never silently
 * re-opened.
 *
 * E6 discipline (worker-contract "Async/stateful work") is encoded on
 * every mutating operation:
 * - command admission: {@link admitLifecycleCommand} is the pure oracle;
 * - idempotency: every command carries a {@link LifecycleCommandKey}; a
 *   replayed key is refused (`duplicate-command`) — the first receipt
 *   stands, never a double application;
 * - stale-result rule: every command names the state it was issued
 *   against (`against`); a command issued against a superseded state is
 *   refused (`stale-command`) — optimistic concurrency, never blind
 *   application;
 * - event order: the {@link EntitlementLifecycleRecord.history} journal
 *   is append-only and ordered;
 * - retry semantics: retries re-submit the SAME key and are refused as
 *   duplicates; a NEW attempt after a refusal uses a new key.
 *
 * Mutable state owner: the platform economy service (PL-017) owns
 * lifecycle records; this module is the pure transition rule set.
 *
 * Purity: pure types + pure guards + one pure admission oracle. No IO.
 */

import type { ContentDigest, SubjectId, TenantId } from "./primitives.ts";
import { isValidContentDigest } from "./primitives.ts";
import type { EntitlementGrantId } from "./entitlements.ts";

// ---------------------------------------------------------------------------
// State machine (frozen transitions — house pattern)
// ---------------------------------------------------------------------------

/** Lifecycle states of one granted entitlement. */
export type EntitlementLifecycleState = "granted" | "held" | "settled" | "revoked";

/** All valid {@link EntitlementLifecycleState} values. */
export const ENTITLEMENT_LIFECYCLE_STATES: readonly EntitlementLifecycleState[] = Object.freeze([
  "granted",
  "held",
  "settled",
  "revoked",
]);

/** Returns true when `value` is a valid {@link EntitlementLifecycleState}. */
export function isEntitlementLifecycleState(value: unknown): value is EntitlementLifecycleState {
  return (
    typeof value === "string" &&
    (ENTITLEMENT_LIFECYCLE_STATES as readonly string[]).includes(value)
  );
}

/**
 * The frozen transition table: grant -> hold -> settle/revoke. `settled`
 * and `revoked` are terminal (E10: settled history is immutable; a
 * settled entitlement is append-only forever). State-machine authority is
 * single-owner (E1) and lives HERE, not in consuming services.
 */
export const ENTITLEMENT_LIFECYCLE_TRANSITIONS: Readonly<
  Record<EntitlementLifecycleState, readonly EntitlementLifecycleState[]>
> = Object.freeze({
  granted: Object.freeze(["held", "settled", "revoked"] as readonly EntitlementLifecycleState[]),
  held: Object.freeze(["settled", "revoked"] as readonly EntitlementLifecycleState[]),
  settled: Object.freeze([] as readonly EntitlementLifecycleState[]),
  revoked: Object.freeze([] as readonly EntitlementLifecycleState[]),
});

/** Returns true when `from -> to` is a legal lifecycle transition. */
export function canTransitionEntitlement(
  from: EntitlementLifecycleState,
  to: EntitlementLifecycleState,
): boolean {
  return ENTITLEMENT_LIFECYCLE_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Commands (every mutating operation carries an idempotency key)
// ---------------------------------------------------------------------------

/** The mutating lifecycle operations. */
export type EntitlementLifecycleOperation = "hold" | "settle" | "revoke";

/**
 * The idempotency key of one lifecycle command: WHICH entitlement, WHICH
 * operation, and WHICH attempt. Retries re-submit the same key; a new
 * attempt after a refusal uses a new attempt nonce. Structural equality
 * over all three fields.
 */
export interface LifecycleCommandKey {
  readonly entitlement: EntitlementGrantId;
  readonly operation: EntitlementLifecycleOperation;
  readonly attempt: string;
}

/** Structural equality of two {@link LifecycleCommandKey}s. */
export function lifecycleCommandKeyEquals(a: LifecycleCommandKey, b: LifecycleCommandKey): boolean {
  return a.entitlement === b.entitlement && a.operation === b.operation && a.attempt === b.attempt;
}

/** Why an entitlement may be revoked (frozen vocabulary). */
export type EntitlementRevocationReason =
  | "policy-violation"
  | "integrity-enforcement"
  | "administrative"
  | "expired";

/** All valid {@link EntitlementRevocationReason} values. */
export const ENTITLEMENT_REVOCATION_REASONS: readonly EntitlementRevocationReason[] = Object.freeze([
  "policy-violation",
  "integrity-enforcement",
  "administrative",
  "expired",
]);

/** Returns true when `value` is a valid {@link EntitlementRevocationReason}. */
export function isEntitlementRevocationReason(value: unknown): value is EntitlementRevocationReason {
  return (
    typeof value === "string" &&
    (ENTITLEMENT_REVOCATION_REASONS as readonly string[]).includes(value)
  );
}

/**
 * A lifecycle command: operation + idempotency key + the state it was
 * issued against (stale-result rule) + a digest-pinned audit cause. The
 * audit cause references the CAUSE of the mutation (settlement record
 * digest, enforcement decision digest, administrative note) —
 * content-addressed, never inline.
 */
export type EntitlementLifecycleCommand =
  | {
      readonly command: "hold";
      readonly key: LifecycleCommandKey;
      readonly entitlement: EntitlementGrantId;
      readonly against: EntitlementLifecycleState;
      readonly holdCauseDigest: ContentDigest;
    }
  | {
      readonly command: "settle";
      readonly key: LifecycleCommandKey;
      readonly entitlement: EntitlementGrantId;
      readonly against: EntitlementLifecycleState;
      readonly settlementDigest: ContentDigest;
    }
  | {
      readonly command: "revoke";
      readonly key: LifecycleCommandKey;
      readonly entitlement: EntitlementGrantId;
      readonly against: EntitlementLifecycleState;
      readonly reason: EntitlementRevocationReason;
      /** Digest of the revocation cause document (always content-addressed). */
      readonly revocationCauseDigest: ContentDigest;
    };

/** Returns true when `value` is a structurally valid {@link EntitlementLifecycleCommand}. */
export function isEntitlementLifecycleCommand(value: unknown): value is EntitlementLifecycleCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  if (command.command !== "hold" && command.command !== "settle" && command.command !== "revoke") {
    return false;
  }
  if (typeof command.entitlement !== "string" || command.entitlement.length === 0) return false;
  if (!isEntitlementLifecycleState(command.against)) return false;
  const key = command.key as Record<string, unknown> | undefined;
  if (typeof key !== "object" || key === null) return false;
  if (key.entitlement !== command.entitlement) return false;
  if (key.operation !== command.command) return false;
  if (typeof key.attempt !== "string" || key.attempt.length === 0) return false;
  if (command.command === "hold") {
    return typeof command.holdCauseDigest === "string" && isValidContentDigest(command.holdCauseDigest);
  }
  if (command.command === "settle") {
    return typeof command.settlementDigest === "string" && isValidContentDigest(command.settlementDigest);
  }
  if (!isEntitlementRevocationReason(command.reason)) return false;
  return (
    typeof command.revocationCauseDigest === "string" &&
    isValidContentDigest(command.revocationCauseDigest)
  );
}

// ---------------------------------------------------------------------------
// Lifecycle record (append-only history)
// ---------------------------------------------------------------------------

/** One applied transition, as journaled. Append-only (E10). */
export interface LifecycleTransitionRecord {
  readonly command: EntitlementLifecycleOperation;
  readonly from: EntitlementLifecycleState;
  readonly to: EntitlementLifecycleState;
  readonly key: LifecycleCommandKey;
  /** Digest of the cause document (settlement, enforcement decision, ...). */
  readonly auditRef: ContentDigest;
}

/** The lifecycle record of one entitlement: current state + ordered history. */
export interface EntitlementLifecycleRecord {
  readonly entitlement: EntitlementGrantId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly state: EntitlementLifecycleState;
  readonly history: readonly LifecycleTransitionRecord[];
}

/** Returns true when `value` is a structurally valid {@link EntitlementLifecycleRecord}. */
export function isEntitlementLifecycleRecord(value: unknown): value is EntitlementLifecycleRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.entitlement !== "string" || record.entitlement.length === 0) return false;
  if (typeof record.subject !== "string" || record.subject.length === 0) return false;
  if (!isEntitlementLifecycleState(record.state)) return false;
  if (!Array.isArray(record.history)) return false;
  return record.history.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const transition = entry as Record<string, unknown>;
    if (transition.command !== "hold" && transition.command !== "settle" && transition.command !== "revoke") {
      return false;
    }
    if (!isEntitlementLifecycleState(transition.from) || !isEntitlementLifecycleState(transition.to)) {
      return false;
    }
    if (typeof transition.auditRef !== "string" || !isValidContentDigest(transition.auditRef)) {
      return false;
    }
    const key = transition.key as Record<string, unknown> | undefined;
    return typeof key === "object" && key !== null && typeof key.attempt === "string" && key.attempt.length > 0;
  });
}

/**
 * Pure constructor: the lifecycle record of a freshly granted entitlement
 * (state `granted`, empty history). Identifiers are caller-supplied.
 */
export function openEntitlementLifecycle(facts: {
  readonly entitlement: EntitlementGrantId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}): EntitlementLifecycleRecord {
  return { ...facts, state: "granted", history: [] };
}

// ---------------------------------------------------------------------------
// Admission oracle (E6: admission, idempotency, stale-result)
// ---------------------------------------------------------------------------

/** Result of {@link admitLifecycleCommand}. */
export type LifecycleCommandDisposition =
  | { readonly ok: true; readonly record: EntitlementLifecycleRecord }
  | {
      readonly ok: false;
      readonly code:
        | "malformed-command"
        | "entitlement-mismatch"
        | "duplicate-command"
        | "stale-command"
        | "illegal-transition";
    };

/**
 * THE lifecycle admission oracle (pure fold rule). Rules, in order:
 * structural validity (`malformed-command`); the command addresses THIS
 * record's entitlement (`entitlement-mismatch`); idempotency — a key
 * already journaled is a replay and is REFUSED (`duplicate-command`;
 * first receipt stands, E8 anti-gaming); the stale-result rule — the
 * command was issued against a superseded state (`stale-command`); and
 * finally the frozen transition table (`illegal-transition`). Accepted
 * commands return the NEXT record with the transition appended.
 */
export function admitLifecycleCommand(
  command: EntitlementLifecycleCommand,
  record: EntitlementLifecycleRecord,
): LifecycleCommandDisposition {
  if (!isEntitlementLifecycleCommand(command)) {
    return { ok: false, code: "malformed-command" };
  }
  if (command.entitlement !== record.entitlement) {
    return { ok: false, code: "entitlement-mismatch" };
  }
  if (record.history.some((entry) => lifecycleCommandKeyEquals(entry.key, command.key))) {
    return { ok: false, code: "duplicate-command" };
  }
  if (command.against !== record.state) {
    return { ok: false, code: "stale-command" };
  }
  const target: EntitlementLifecycleState =
    command.command === "hold" ? "held" : command.command === "settle" ? "settled" : "revoked";
  if (!canTransitionEntitlement(record.state, target)) {
    return { ok: false, code: "illegal-transition" };
  }
  const auditRef: ContentDigest =
    command.command === "hold"
      ? command.holdCauseDigest
      : command.command === "settle"
        ? command.settlementDigest
        : command.revocationCauseDigest;
  const transition: LifecycleTransitionRecord = {
    command: command.command,
    from: record.state,
    to: target,
    key: command.key,
    auditRef,
  };
  return {
    ok: true,
    record: { ...record, state: target, history: [...record.history, transition] },
  };
}
