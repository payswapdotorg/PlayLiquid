/**
 * ENTITLEMENT LIFECYCLE DOORS (PL-017) — hold, complete, revoke.
 *
 * The entitlement lifecycle itself is platform-contracts authority
 * (PL-009: the frozen `grant -> hold -> settle/revoke` transition table
 * and the `admitLifecycleCommand` oracle — one state machine, no local
 * copy, E1). This module defines the DOOR contracts the economy service
 * exposes over that machine: typed inputs carrying the worker-contract
 * async/stateful discipline (idempotency key = entitlement + operation +
 * attempt; stale-result rule = `against`; audit refs digest-pinned) and
 * typed results surfacing the contracts refusal codes verbatim.
 *
 * Terminal discipline (E10): `settled` and `revoked` are terminal — a
 * completed settlement never re-applies (E9 determinism), and a settled
 * entitlement is never silently re-opened.
 *
 * Purity: types + guards + pure command builders. No IO.
 */

import {
  isEntitlementLifecycleState,
  isEntitlementRevocationReason,
} from "@playliquid/platform-contracts";
import type {
  ContentDigest,
  EntitlementGrantId,
  EntitlementLifecycleCommand,
  EntitlementLifecycleState,
  EntitlementRevocationReason,
  SettlementId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Door inputs
// ---------------------------------------------------------------------------

/** Shared command-addressing facts (worker-contract async discipline). */
export interface LifecycleDoorCommand {
  readonly tenant: TenantId;
  readonly entitlement: EntitlementGrantId;
  /** The state the command was issued against (stale-result rule). */
  readonly against: EntitlementLifecycleState;
  /** The idempotency attempt nonce: retries re-submit, new attempts use new nonces. */
  readonly attempt: string;
}

/** A hold request: place one granted entitlement on hold pending a cause. */
export interface HoldCommand extends LifecycleDoorCommand {
  readonly holdCauseDigest: ContentDigest;
}

/** A settlement completion request for one held entitlement. */
export interface CompleteSettlementCommand extends LifecycleDoorCommand {}

/** A revocation request: terminal, with a frozen reason vocabulary. */
export interface RevokeCommand extends LifecycleDoorCommand {
  readonly reason: EntitlementRevocationReason;
  readonly revocationCauseDigest: ContentDigest;
}

/** Returns true when `value` is a structurally valid {@link HoldCommand}. */
export function isHoldCommand(value: unknown): value is HoldCommand {
  return isDoorCommand(value) && digestLike((value as Record<string, unknown>).holdCauseDigest);
}

/** Returns true when `value` is a structurally valid {@link CompleteSettlementCommand}. */
export function isCompleteSettlementCommand(value: unknown): value is CompleteSettlementCommand {
  return isDoorCommand(value);
}

/** Returns true when `value` is a structurally valid {@link RevokeCommand}. */
export function isRevokeCommand(value: unknown): value is RevokeCommand {
  if (!isDoorCommand(value)) return false;
  const command = value as Record<string, unknown>;
  if (!isEntitlementRevocationReason(command.reason)) return false;
  return digestLike(command.revocationCauseDigest);
}

function isDoorCommand(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  if (typeof command.tenant !== "string" || command.tenant.length === 0) return false;
  if (typeof command.entitlement !== "string" || command.entitlement.length === 0) return false;
  if (typeof command.attempt !== "string" || command.attempt.length === 0) return false;
  return isEntitlementLifecycleState(command.against);
}

function digestLike(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

// ---------------------------------------------------------------------------
// Command builders (the contracts lifecycle command shapes)
// ---------------------------------------------------------------------------

/** Build the contracts hold command for one door input. */
export function holdLifecycleCommand(input: HoldCommand): EntitlementLifecycleCommand {
  return {
    command: "hold",
    key: { entitlement: input.entitlement, operation: "hold", attempt: input.attempt },
    entitlement: input.entitlement,
    against: input.against,
    holdCauseDigest: input.holdCauseDigest,
  };
}

/** Build the contracts settle command (the settlement digest is the audit cause). */
export function settleLifecycleCommand(
  entitlement: EntitlementGrantId,
  against: EntitlementLifecycleState,
  attempt: string,
  settlementDigest: ContentDigest,
): EntitlementLifecycleCommand {
  return {
    command: "settle",
    key: { entitlement, operation: "settle", attempt },
    entitlement,
    against,
    settlementDigest,
  };
}

/** Build the contracts revoke command for one door input. */
export function revokeLifecycleCommand(input: RevokeCommand): EntitlementLifecycleCommand {
  return {
    command: "revoke",
    key: { entitlement: input.entitlement, operation: "revoke", attempt: input.attempt },
    entitlement: input.entitlement,
    against: input.against,
    reason: input.reason,
    revocationCauseDigest: input.revocationCauseDigest,
  };
}

// ---------------------------------------------------------------------------
// Door results
// ---------------------------------------------------------------------------

/** Typed refusal codes for the lifecycle doors (contracts codes verbatim). */
export type LifecycleRefusalCode =
  | "tenant-mismatch"
  | "capability-not-granted"
  | "permission-not-granted"
  | "unknown-entitlement"
  | "malformed-command"
  | "entitlement-mismatch"
  | "duplicate-command"
  | "stale-command"
  | "illegal-transition";

/** Result of {@link EconomyService.holdEntitlement}. */
export type HoldResult =
  | { readonly ok: true; readonly state: "held"; readonly heldAt: TimestampMs }
  | { readonly ok: false; readonly code: LifecycleRefusalCode; readonly detail: string };

/** Result of {@link EconomyService.completeSettlement}. */
export type CompleteSettlementResult =
  | { readonly ok: true; readonly settlementId: SettlementId; readonly recordedAt: TimestampMs }
  | { readonly ok: false; readonly code: CompleteSettlementRefusalCode; readonly detail: string };

/** CompleteSettlement refusals include the contracts settlement-admission codes. */
export type CompleteSettlementRefusalCode =
  | LifecycleRefusalCode
  | "duplicate-settlement-id"
  | "entitlement-already-settled"
  | "lifecycle-not-settled"
  | "non-authoritative-source"
  | "malformed-record";

/** Result of {@link EconomyService.revokeEntitlement}. */
export type RevokeResult =
  | {
      readonly ok: true;
      readonly state: "revoked";
      /** The clawback ledger outcome: applied, or typed refusal (e.g. already-consumed balance). */
      readonly clawback:
        | { readonly applied: true; readonly balanceAfter: number }
        | { readonly applied: false; readonly code: "duplicate-entry" | "non-integer-delta" | "zero-delta" | "negative-balance" };
    }
  | { readonly ok: false; readonly code: LifecycleRefusalCode; readonly detail: string };
