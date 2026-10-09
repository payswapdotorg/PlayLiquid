/**
 * SNAPSHOT DOCUMENT (DE)SERIALIZATION for the economy service —
 * split out of service.ts for the 400-line ceiling (the
 * platform-leaderboard `document.ts` precedent). Pure conversions
 * between the service's in-memory tenant state and the serializable
 * {@link EconomyStateDocument}; no IO, no mutation of inputs.
 *
 * Determinism (E9): maps serialize as arrays SORTED by their natural
 * keys, journals and settlement records serialize in append order. The
 * same command sequence therefore always produces byte-identical
 * documents — and restore adopts them whole (no partial apply).
 */

import type {
  EntitlementGrant,
  EntitlementLifecycleRecord,
  EntitlementSettlementRecord,
  LedgerEntry,
  SettlementEligibilityDeclaration,
  TenantId,
} from "@playliquid/platform-contracts";
import type { EntitlementProvenance, SettlementReceipt } from "./records.ts";
import type { RegisteredRewardPolicy } from "./policies.ts";
import type { EconomyStateDocument } from "./ports.ts";

// ---------------------------------------------------------------------------
// Service-owned state shapes (the service instance owns the instances, E1)
// ---------------------------------------------------------------------------

/** One entitlement as the service journals it: grant + lifecycle + provenance. */
export interface EntitlementRecord {
  readonly grant: EntitlementGrant;
  lifecycle: EntitlementLifecycleRecord;
  readonly provenance: EntitlementProvenance;
}

/** The per-tenant economy state the service instance owns. */
export interface TenantEconomyState {
  readonly tenant: TenantId;
  policies: Map<string, RegisteredRewardPolicy>;
  entitlements: Map<string, EntitlementRecord>;
  balances: Map<string, number>;
  journal: LedgerEntry[];
  settlements: EntitlementSettlementRecord[];
  receipts: Map<string, SettlementReceipt>;
}

/** Create the empty state for one tenant. */
export function emptyTenantState(tenant: TenantId): TenantEconomyState {
  return {
    tenant,
    policies: new Map(),
    entitlements: new Map(),
    balances: new Map(),
    journal: [],
    settlements: [],
    receipts: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Build the canonical state document from the service's tenant states. */
export function documentOf(states: readonly TenantEconomyState[], revision: number): EconomyStateDocument {
  const policies: EconomyStateDocument["policies"][number][] = [];
  const entitlements: EconomyStateDocument["entitlements"][number][] = [];
  const balances: EconomyStateDocument["balances"][number][] = [];
  const journal: unknown[] = [];
  const settlements: unknown[] = [];
  const receipts: EconomyStateDocument["receipts"][number][] = [];
  for (const state of states) {
    for (const policy of [...state.policies.values()].sort((a, b) =>
      String(a.declaration.eventKind).localeCompare(String(b.declaration.eventKind)),
    )) {
      policies.push({
        tenant: String(state.tenant),
        declaration: policy.declaration,
        registeredAt: policy.registeredAt,
      });
    }
    for (const record of [...state.entitlements.values()].sort((a, b) =>
      String(a.grant.grantId).localeCompare(String(b.grant.grantId)),
    )) {
      entitlements.push({ grant: record.grant, lifecycle: record.lifecycle, provenance: record.provenance });
    }
    for (const [key, balance] of [...state.balances.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      balances.push({ key, balance });
    }
    journal.push(...state.journal);
    settlements.push(...state.settlements);
    for (const [key, receipt] of [...state.receipts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      receipts.push({ key, receipt });
    }
  }
  return {
    revision,
    tenants: states.map((state) => String(state.tenant)),
    policies,
    entitlements,
    balances,
    journal,
    settlements,
    receipts,
  };
}

/** Rebuild tenant states from a state document (whole-document adoption). */
export function tenantStatesOf(document: EconomyStateDocument): readonly TenantEconomyState[] {
  const states = new Map<string, TenantEconomyState>();
  const stateFor = (tenant: string): TenantEconomyState => {
    const existing = states.get(tenant);
    if (existing !== undefined) return existing;
    const created = emptyTenantState(tenant as TenantId);
    states.set(tenant, created);
    return created;
  };
  for (const row of document.policies) {
    const state = stateFor(row.tenant);
    const declaration = row.declaration as SettlementEligibilityDeclaration;
    state.policies.set(`${row.tenant}|${String(declaration.eventKind)}`, {
      tenant: row.tenant as TenantId,
      declaration,
      registeredAt: row.registeredAt,
      decidedBy: "platform-authority",
    });
  }
  for (const row of document.entitlements) {
    const record = row as unknown as EntitlementRecord;
    stateFor(String(record.grant.tenant)).entitlements.set(String(record.grant.grantId), {
      grant: record.grant,
      lifecycle: record.lifecycle,
      provenance: record.provenance,
    });
  }
  for (const row of document.balances) {
    const [tenant] = row.key.split("|");
    if (tenant !== undefined) stateFor(tenant).balances.set(row.key, row.balance);
  }
  for (const entry of document.journal as unknown as LedgerEntry[]) {
    stateFor(String(entry.tenant)).journal.push(entry);
  }
  for (const record of document.settlements as unknown as EntitlementSettlementRecord[]) {
    stateFor(String(record.tenant)).settlements.push(record);
  }
  for (const row of document.receipts) {
    const receipt = row.receipt as unknown as SettlementReceipt;
    stateFor(String(receipt.tenant)).receipts.set(row.key, receipt);
  }
  return [...states.values()];
}
