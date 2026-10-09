/**
 * SETTLEMENT/LEDGER APPLICATION (PL-017) — the internal mutation engine
 * of the economy service, split out of service.ts for the 400-line
 * ceiling (the platform-multiplayer `kernel-ops.ts` precedent).
 *
 * Ownership (E1) is unchanged: these functions mutate ONLY the
 * {@link TenantEconomyState} the EconomyService instance owns, on its
 * behalf, inside one atomic door step. Every mutation still passes
 * through the platform-contracts oracles FIRST (`settleLedgerEntry`,
 * `admitLifecycleCommand`, `admitSettlement`) — nothing is applied
 * unless every oracle accepted, so a refused step never leaves partial
 * state behind.
 *
 * Purity: pure functions over explicitly-passed state. No IO, no clock
 * (recordedAt/now are caller-supplied), no globals.
 */

import {
  admitLifecycleCommand,
  admitSettlement,
  openEntitlementLifecycle,
  settleLedgerEntry,
} from "@playliquid/platform-contracts";
import type {
  EntitlementGrant,
  LedgerEntry,
  SettlementId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import { canonicalJson, digestOf } from "./digest.ts";
import { balanceKey, grantLedgerEntry, revokeLedgerEntry } from "./ledger.ts";
import type { LedgerFoldResult } from "./ledger.ts";
import {
  entitlementGrantOf,
  mintRevokeEntryId,
  mintSettlementId,
  settlementIdempotencyKey,
  settlementRecordOf,
} from "./records.ts";
import type { EntitlementProvenance, SettlementReceipt } from "./records.ts";
import type { EconomySettlementRequest, SettlementPlan } from "./settlement.ts";
import type { SettleEventResult } from "./service-types.ts";
import type { EntitlementRecord, TenantEconomyState } from "./document.ts";

// ---------------------------------------------------------------------------
// Settlement application
// ---------------------------------------------------------------------------

/**
 * Apply one admitted settlement plan to the tenant state, atomically:
 * grant record + lifecycle (settled, or held pending cause) + ledger
 * credit + settlement record (immediate mode) + receipt. All oracles
 * run before any mutation; a refusal leaves the state untouched.
 */
export function applySettlementToState(
  state: TenantEconomyState,
  request: EconomySettlementRequest,
  plan: SettlementPlan,
  now: TimestampMs,
  revision: number,
): SettleEventResult {
  const provenance: EntitlementProvenance = {
    tenant: request.tenant,
    subject: request.subject,
    entitlementKind: plan.entitlementKind,
    eventKind: request.eventKind,
    sourceEventDigest: request.sourceEventDigest,
    outcomeEvidence: request.outcomeEvidence,
    value: request.value,
    mode: plan.mode,
    integrityEvidenceDigest: plan.integrityEvidenceDigest,
  };
  const grant = entitlementGrantOf(provenance, plan.grantId, plan.quantity);
  const key = balanceKey(request.tenant, request.subject, plan.entitlementKind);
  const current = state.balances.get(key) ?? 0;
  const entry = grantLedgerEntry({
    entryId: plan.entryId,
    tenant: request.tenant,
    subject: request.subject,
    entitlementKind: plan.entitlementKind,
    quantity: plan.quantity,
    grantRef: plan.grantId,
    balanceAfter: current + plan.quantity,
  });
  const fold = settleLedgerEntry(entry, state.journal, current);
  if (!fold.settled) {
    return { accepted: false, code: fold.code, detail: `ledger fold refused: ${fold.code}` };
  }
  const lifecycle = openEntitlementLifecycle({
    entitlement: plan.grantId,
    tenant: request.tenant,
    subject: request.subject,
  });
  const attempt = String(plan.entryId);
  let settlementId: SettlementId | undefined;
  if (plan.mode === "hold") {
    const held = admitLifecycleCommand(
      {
        command: "hold",
        key: { entitlement: plan.grantId, operation: "hold", attempt: `hold-${attempt}` },
        entitlement: plan.grantId,
        against: "granted",
        holdCauseDigest: request.holdCauseDigest!,
      },
      lifecycle,
    );
    if (!held.ok) return { accepted: false, code: held.code, detail: `lifecycle admission refused: ${held.code}` };
    state.entitlements.set(String(plan.grantId), { grant, lifecycle: held.record, provenance });
  } else {
    const settlement = settlementRecordOf({
      settlementId: plan.settlementId,
      grantId: plan.grantId,
      provenance,
      recordedAt: now,
    });
    const settled = admitLifecycleCommand(
      {
        command: "settle",
        key: { entitlement: plan.grantId, operation: "settle", attempt: `settle-${attempt}` },
        entitlement: plan.grantId,
        against: "granted",
        settlementDigest: digestOf(canonicalJson(settlement)),
      },
      lifecycle,
    );
    if (!settled.ok) return { accepted: false, code: settled.code, detail: `lifecycle admission refused: ${settled.code}` };
    const admission = admitSettlement(settlement, state.settlements);
    if (!admission.ok) return { accepted: false, code: admission.code, detail: `settlement admission refused: ${admission.code}` };
    state.entitlements.set(String(plan.grantId), { grant, lifecycle: settled.record, provenance });
    state.settlements.push(settlement);
    settlementId = settlement.settlementId;
  }
  state.journal.push(entry);
  state.balances.set(key, fold.balanceAfter);
  const receipt: SettlementReceipt = {
    receiptId: `${plan.idempotencyKey}:${now}:${revision}`,
    tenant: request.tenant,
    subject: request.subject,
    entitlementKind: plan.entitlementKind,
    grantId: plan.grantId,
    quantity: plan.quantity,
    balanceAfter: fold.balanceAfter,
    lifecycle: plan.mode === "hold" ? "held" : "settled",
    settlementId,
    sourceEventDigest: request.sourceEventDigest,
    outcomeEvidence: request.outcomeEvidence,
    integrityEvidenceDigest: plan.integrityEvidenceDigest,
    recordedAt: now,
    decidedBy: "platform-authority",
  };
  state.receipts.set(plan.idempotencyKey, receipt);
  return { accepted: true, receipt };
}

// ---------------------------------------------------------------------------
// Ledger folds (consume / adjust / clawback)
// ---------------------------------------------------------------------------

/**
 * Fold one fully-constructed ledger entry through the contracts oracle
 * and apply it: append + balance update. Refusals leave the state
 * untouched (typed codes verbatim, E8/E10).
 */
export function foldEntryIntoState(state: TenantEconomyState, entry: LedgerEntry): LedgerFoldResult {
  const key = balanceKey(entry.tenant, entry.subject, entry.entitlementKind);
  const current = state.balances.get(key) ?? 0;
  const fold = settleLedgerEntry(entry, state.journal, current);
  if (!fold.settled) return { ok: false, code: fold.code, detail: `ledger fold refused: ${fold.code}` };
  state.journal.push(entry);
  state.balances.set(key, fold.balanceAfter);
  return { ok: true, balanceAfter: fold.balanceAfter };
}

/** The clawback outcome of one revocation. */
export type Clawback =
  | { readonly applied: true; readonly balanceAfter: number }
  | { readonly applied: false; readonly code: "duplicate-entry" | "non-integer-delta" | "zero-delta" | "negative-balance" };

/**
 * The revocation clawback of one entitlement: attempt a `revoke` ledger
 * row of the granted amount. A refused fold (e.g. the balance was
 * already consumed — `negative-balance`) is REPORTED, never silently
 * clamped: partial clawback is host policy via the adjust door.
 */
export function clawbackOf(state: TenantEconomyState, grant: EntitlementGrant, attempt: string): Clawback {
  const key = balanceKey(grant.tenant, grant.subject, grant.entitlementKind);
  const current = state.balances.get(key) ?? 0;
  const entry = revokeLedgerEntry({
    entryId: mintRevokeEntryId(grant.grantId, attempt),
    tenant: grant.tenant,
    subject: grant.subject,
    entitlementKind: grant.entitlementKind,
    quantity: grant.amount,
    grantRef: grant.grantId,
    balanceAfter: current - grant.amount,
  });
  const fold = settleLedgerEntry(entry, state.journal, current);
  if (!fold.settled) return { applied: false, code: fold.code };
  state.journal.push(entry);
  state.balances.set(key, fold.balanceAfter);
  return { applied: true, balanceAfter: fold.balanceAfter };
}

/** The deterministic settlement id of one stored entitlement (records.ts rule). */
export function settlementIdOf(record: EntitlementRecord): SettlementId {
  return mintSettlementId(
    settlementIdempotencyKey(
      record.provenance.tenant,
      record.provenance.subject,
      record.provenance.eventKind,
      record.provenance.sourceEventDigest,
    ),
  );
}

/** Balance-key view of a journal entry (row → key). */
export function balanceKeyOf(entry: LedgerEntry): string {
  return `${String(entry.tenant)}|${String(entry.subject)}|${entry.entitlementKind}`;
}
