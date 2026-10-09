/**
 * THE ENTITLEMENT LEDGER (PL-017) — balances, journal entries, holds.
 *
 * The ledger is the platform's economy book: one running balance per
 * (tenant, subject, entitlementKind), mutated ONLY by append-only
 * {@link LedgerEntry} rows folded through platform-contracts'
 * `settleLedgerEntry` (duplicate ids, non-integer/zero deltas and
 * negative balances are typed refusals — E8/E10). Entry reasons are the
 * frozen contracts vocabulary: grant / revoke / consume / adjust.
 *
 * HOLDS are the per-entitlement protective state (lifecycle "held",
 * entitlement-lifecycle.ts): a held entitlement is credited but NOT yet
 * terminally settled — finalization is `completeSettlement` (settle) or
 * `revokeEntitlement` (revoke). The read model below surfaces holds.
 *
 * Mutable state owner: the EconomyService instance (service.ts, E1).
 * This module is pure constructors, keys and views.
 */

import type {
  EntitlementGrantId,
  LedgerEntry,
  LedgerEntryId,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Keys + views
// ---------------------------------------------------------------------------

/** Ledger balance key: (tenant, subject, entitlementKind). */
export function balanceKey(tenant: TenantId, subject: SubjectId, entitlementKind: string): string {
  return `${String(tenant)}|${String(subject)}|${entitlementKind}`;
}

/** One subject's ledger view for one entitlement kind. */
export interface SubjectLedgerView {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly balance: number;
  readonly entries: readonly LedgerEntry[];
}

/** One currently-held entitlement, as a read model (lifecycle "held"). */
export interface EntitlementHold {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlement: EntitlementGrantId;
  readonly entitlementKind: string;
  /** When the hold was placed (the lifecycle transition's command admission time). */
  readonly heldAt: number;
  /** Digest of the pending-cause document the hold was placed under. */
  readonly causeDigest: string;
}

// ---------------------------------------------------------------------------
// Door inputs + results (consume / adjust)
// ---------------------------------------------------------------------------

/** A consumption request against one subject's balance. */
export interface ConsumeInput {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  /** Caller-supplied idempotent entry id: a replay is `duplicate-entry` (E10). */
  readonly entryId: LedgerEntryId;
  /** Positive integer quantity to consume. */
  readonly quantity: number;
}

/** An administrative adjustment (host policy: corrections, partial clawback). */
export interface AdjustInput {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly entryId: LedgerEntryId;
  /** Signed, non-zero integer delta. */
  readonly delta: number;
}

/** Typed refusal codes for the ledger doors (contracts codes verbatim). */
export type LedgerRefusalCode =
  | "tenant-mismatch"
  | "capability-not-granted"
  | "permission-not-granted"
  | "malformed-consumption"
  | "malformed-adjustment"
  | "invalid-quantity"
  | "duplicate-entry"
  | "non-integer-delta"
  | "zero-delta"
  | "negative-balance";

/** Result of consume/adjust doors. */
export type LedgerFoldResult =
  | { readonly ok: true; readonly balanceAfter: number }
  | { readonly ok: false; readonly code: LedgerRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// Entry constructors (reason-explicit; balanceAfter is the fold's output)
// ---------------------------------------------------------------------------

/** Construct a grant credit row (+quantity, reason "grant"). */
export function grantLedgerEntry(facts: {
  readonly entryId: LedgerEntryId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly quantity: number;
  readonly grantRef: EntitlementGrantId;
  readonly balanceAfter: number;
}): LedgerEntry {
  return { ...facts, delta: facts.quantity, reason: "grant" };
}

/** Construct a consumption row (-quantity, reason "consume"). */
export function consumeLedgerEntry(facts: {
  readonly entryId: LedgerEntryId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly quantity: number;
  readonly balanceAfter: number;
}): LedgerEntry {
  return {
    entryId: facts.entryId,
    tenant: facts.tenant,
    subject: facts.subject,
    entitlementKind: facts.entitlementKind,
    delta: -facts.quantity,
    reason: "consume",
    balanceAfter: facts.balanceAfter,
  };
}

/** Construct a revocation clawback row (-quantity, reason "revoke"). */
export function revokeLedgerEntry(facts: {
  readonly entryId: LedgerEntryId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly quantity: number;
  readonly grantRef: EntitlementGrantId;
  readonly balanceAfter: number;
}): LedgerEntry {
  return { ...facts, delta: -facts.quantity, reason: "revoke" };
}

/** Construct an administrative adjustment row (signed delta, reason "adjust"). */
export function adjustLedgerEntry(facts: {
  readonly entryId: LedgerEntryId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly delta: number;
  readonly balanceAfter: number;
}): LedgerEntry {
  return { ...facts, reason: "adjust" };
}
