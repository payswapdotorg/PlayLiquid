/**
 * THE ECONOMY SERVICE — the rewards/economy platform authority (PL-017;
 * matrix row `economy | Platform | platform-contracts, integrity`).
 *
 * The service instance is the single mutable-state owner (E1): admitted
 * reward policies, entitlement grants + lifecycles, balances, the ledger
 * journal, the settlement journal and the receipt registry — all scoped
 * by tenant + subject. THE platform settles (R10): validation,
 * entitlements and settlement run over platform-contracts oracles — never
 * local duplicates of those authorities.
 *
 * Async/stateful discipline (spec/worker-contract.md), every item owned
 * and tested: mutable state owner = this instance (persistence via
 * EconomyStore, time via ServiceClock, grants via GrantDirectory,
 * integrity evidence via RewardIntegrityPort, magnitudes via
 * EconomyValueResolver); command admission = least privilege first
 * (submit/administer/read on "rewards", R20) then pure oracles over
 * facts derived from OWNED state; event order = journals append in
 * admission order, mutations and receipt are one atomic step;
 * idempotency keys = settlement occurrence quadruple / lifecycle
 * entitlement+operation+attempt / caller entry id (replays return
 * recorded receipts, E10; collisions are typed refusals, E8);
 * stale-result rule = lifecycle commands name the state they were
 * issued against; replay/resume boundary = content-addressed snapshot
 * + whole-document restore (the E6 durable store is the host's to wire
 * — the port contract ships here); retry/cancellation = refused
 * commands mutate nothing, synchronous domain, nothing to cancel.
 */
import {
  admitLifecycleCommand,
  admitSettlement,
  checkLeastPrivilege,
} from "@playliquid/platform-contracts";
import type {
  CapabilityPermission,
  ContentDigest,
  EntitlementGrant,
  EntitlementGrantId,
  EntitlementSettlementRecord,
  LedgerEntry,
  LedgerEntryId,
  PrivilegeCheck,
  SettlementEligibilityDeclaration,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";
import { canonicalJson, digestOf } from "./digest.ts";
import { adjudicatePolicyAdmission, declarationsOf } from "./policies.ts";
import { adjudicateEconomySettlement, settlementKeyOf } from "./settlement.ts";
import type { EconomySettlementRequest } from "./settlement.ts";
import type {
  EconomyRefusal,
  EconomyServiceOptions,
  EntitlementView,
  RegisterPolicyResult,
  SettleEventResult,
  SnapshotResult,
} from "./service-types.ts";
import { settlementRecordOf } from "./records.ts";
import type { SettlementReceipt } from "./records.ts";
import { balanceKey, consumeLedgerEntry, adjustLedgerEntry } from "./ledger.ts";
import type { AdjustInput, ConsumeInput, LedgerFoldResult, SubjectLedgerView } from "./ledger.ts";
import {
  holdLifecycleCommand,
  isCompleteSettlementCommand,
  isHoldCommand,
  isRevokeCommand,
  revokeLifecycleCommand,
  settleLifecycleCommand,
} from "./lifecycle.ts";
import type {
  CompleteSettlementCommand,
  CompleteSettlementResult,
  HoldCommand,
  HoldResult,
  RevokeCommand,
  RevokeResult,
} from "./lifecycle.ts";
import { isEconomyStateDocument } from "./ports.ts";
import {
  applySettlementToState,
  balanceKeyOf,
  clawbackOf,
  foldEntryIntoState,
  settlementIdOf,
} from "./apply.ts";
import type { Clawback } from "./apply.ts";
import { documentOf, emptyTenantState, tenantStatesOf } from "./document.ts";
import type { EntitlementRecord, TenantEconomyState } from "./document.ts";

/** The rewards/economy authority. Construct, then register policies. */
export class EconomyService {
  private readonly store: EconomyServiceOptions["store"];
  private readonly clock: EconomyServiceOptions["clock"];
  private readonly grants: EconomyServiceOptions["grants"];
  private readonly integrity: EconomyServiceOptions["integrity"];
  private readonly values: EconomyServiceOptions["values"];
  private readonly tenants = new Map<string, TenantEconomyState>();
  private revision = 0;
  private lastPrivilegeCode: Extract<PrivilegeCheck, { ok: false }>["code"] = "capability-not-granted";

  constructor(options: EconomyServiceOptions) {
    this.store = options.store;
    this.clock = options.clock;
    this.grants = options.grants;
    this.integrity = options.integrity;
    this.values = options.values;
  }

  // -----------------------------------------------------------------------
  // Policy admission (administer permission, lock 18)
  // -----------------------------------------------------------------------

  /** Register one game reward policy for one tenant; duplicates are typed conflicts (E8). */
  registerPolicy(actor: SubjectId, tenant: TenantId, declaration: SettlementEligibilityDeclaration): RegisterPolicyResult {
    if (!this.requirePrivilege(actor, tenant, "administer")) return this.privilegeRefusal();
    const state = this.tenantOf(tenant);
    const admission = adjudicatePolicyAdmission(
      tenant,
      declaration,
      this.clock.now(),
      declarationsOf([...state.policies.values()]),
    );
    if (!admission.ok) return admission;
    state.policies.set(`${String(tenant)}|${String(declaration.eventKind)}`, admission.registered);
    this.revision += 1;
    return { ok: true, registered: admission.registered };
  }

  // -----------------------------------------------------------------------
  // Settlement (submit permission; THE platform pipeline, R10)
  // -----------------------------------------------------------------------

  /** Settle one declared event occurrence: validate, grant, credit, finalize. */
  settleEvent(actor: SubjectId, request: EconomySettlementRequest): SettleEventResult {
    if (!this.requirePrivilege(actor, request.tenant, "submit")) {
      return { accepted: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const state = this.tenants.get(String(request.tenant));
    const key = settlementKeyOf(request);
    const recorded: SettlementReceipt | undefined = state?.receipts.get(key);
    const admission = adjudicateEconomySettlement(request, {
      declarations: declarationsOf([...(state?.policies.values() ?? [])]),
      keySeen: recorded !== undefined,
      recordedOutcomeEvidence: recorded?.outcomeEvidence,
      priorGrants: this.priorGrantsFor(request),
      integrityReading: this.integrity.confidenceFor({
        tenant: request.tenant,
        subject: request.subject,
        eventKind: request.eventKind,
        sourceEventDigest: request.sourceEventDigest,
        outcomeEvidence: request.outcomeEvidence,
      }),
      resolvedQuantity: this.values.quantityOf(request.value),
    });
    if (!admission.accepted) {
      if (admission.code === "duplicate-settlement" && recorded !== undefined) {
        return { accepted: false, code: admission.code, detail: admission.detail, recorded };
      }
      return { accepted: false, code: admission.code, detail: admission.detail };
    }
    return applySettlementToState(this.tenantOf(request.tenant), request, admission.plan, this.clock.now(), this.revision);
  }

  // -----------------------------------------------------------------------
  // Lifecycle doors (administer permission; contracts state machine)
  // -----------------------------------------------------------------------

  /** Place a granted entitlement on hold pending cause resolution. */
  holdEntitlement(actor: SubjectId, command: HoldCommand): HoldResult {
    if (!isHoldCommand(command)) {
      return { ok: false, code: "malformed-command", detail: "input is not a valid HoldCommand" };
    }
    if (!this.requirePrivilege(actor, command.tenant, "administer")) return this.privilegeRefusal();
    const record = this.entitlementIn(command.tenant, command.entitlement);
    if (record === undefined) return { ok: false, code: "unknown-entitlement", detail: "the entitlement is not recorded in this tenant" };
    const disposition = admitLifecycleCommand(holdLifecycleCommand(command), record.lifecycle);
    if (!disposition.ok) return { ok: false, code: disposition.code, detail: `lifecycle admission refused: ${disposition.code}` };
    record.lifecycle = disposition.record;
    this.revision += 1;
    return { ok: true, state: "held", heldAt: this.clock.now() };
  }

  /** Finalize one held entitlement: terminal settle + settlement record (E9/E10). */
  completeSettlement(actor: SubjectId, command: CompleteSettlementCommand): CompleteSettlementResult {
    if (!isCompleteSettlementCommand(command)) {
      return { ok: false, code: "malformed-command", detail: "input is not a valid CompleteSettlementCommand" };
    }
    if (!this.requirePrivilege(actor, command.tenant, "administer")) return this.privilegeRefusal();
    const record = this.entitlementIn(command.tenant, command.entitlement);
    if (record === undefined) return { ok: false, code: "unknown-entitlement", detail: "the entitlement is not recorded in this tenant" };
    const state = this.tenantOf(command.tenant);
    const settlement = settlementRecordOf({
      settlementId: settlementIdOf(record),
      grantId: record.grant.grantId,
      provenance: record.provenance,
      recordedAt: this.clock.now(),
    });
    const lifecycle = admitLifecycleCommand(
      settleLifecycleCommand(command.entitlement, command.against, command.attempt, digestOf(canonicalJson(settlement))),
      record.lifecycle,
    );
    if (!lifecycle.ok) return { ok: false, code: lifecycle.code, detail: `lifecycle admission refused: ${lifecycle.code}` };
    const admission = admitSettlement(settlement, state.settlements);
    if (!admission.ok) return { ok: false, code: admission.code, detail: `settlement admission refused: ${admission.code}` };
    record.lifecycle = lifecycle.record;
    state.settlements.push(settlement);
    this.revision += 1;
    return { ok: true, settlementId: settlement.settlementId, recordedAt: settlement.recordedAt };
  }

  /** Revoke one non-settled entitlement: terminal, with typed clawback outcome. */
  revokeEntitlement(actor: SubjectId, command: RevokeCommand): RevokeResult {
    if (!isRevokeCommand(command)) {
      return { ok: false, code: "malformed-command", detail: "input is not a valid RevokeCommand" };
    }
    if (!this.requirePrivilege(actor, command.tenant, "administer")) return this.privilegeRefusal();
    const record = this.entitlementIn(command.tenant, command.entitlement);
    if (record === undefined) return { ok: false, code: "unknown-entitlement", detail: "the entitlement is not recorded in this tenant" };
    const lifecycle = admitLifecycleCommand(revokeLifecycleCommand(command), record.lifecycle);
    if (!lifecycle.ok) return { ok: false, code: lifecycle.code, detail: `lifecycle admission refused: ${lifecycle.code}` };
    record.lifecycle = lifecycle.record;
    const clawback: Clawback = clawbackOf(this.tenantOf(command.tenant), record.grant, command.attempt);
    this.revision += 1;
    return { ok: true, state: "revoked", clawback };
  }

  // -----------------------------------------------------------------------
  // Ledger doors (consume: submit; adjust: administer)
  // -----------------------------------------------------------------------

  /** Consume from one subject's balance; never below zero (E8), replay-safe (E10). */
  consumeBalance(actor: SubjectId, input: ConsumeInput): LedgerFoldResult {
    if (!this.requirePrivilege(actor, input.tenant, "submit")) return this.privilegeRefusal();
    if (!isLedgerDoorInput(input) || !Number.isSafeInteger(input.quantity) || input.quantity < 1) {
      return { ok: false, code: "malformed-consumption", detail: "consumption input is malformed (entry id, subject or quantity)" };
    }
    return this.foldConsume(input, -input.quantity, (entryId, balanceAfter) =>
      consumeLedgerEntry({
        entryId,
        tenant: input.tenant,
        subject: input.subject,
        entitlementKind: input.entitlementKind,
        quantity: input.quantity,
        balanceAfter,
      }),
    );
  }

  /** Administrative balance adjustment (host policy: corrections, partial clawback). */
  adjustBalance(actor: SubjectId, input: AdjustInput): LedgerFoldResult {
    if (!this.requirePrivilege(actor, input.tenant, "administer")) return this.privilegeRefusal();
    if (!isLedgerDoorInput(input) || !Number.isSafeInteger(input.delta) || input.delta === 0) {
      return { ok: false, code: "malformed-adjustment", detail: "adjustment input is malformed (entry id, subject or zero/non-integer delta)" };
    }
    return this.foldConsume(input, input.delta, (entryId, balanceAfter) =>
      adjustLedgerEntry({
        entryId,
        tenant: input.tenant,
        subject: input.subject,
        entitlementKind: input.entitlementKind,
        delta: input.delta,
        balanceAfter,
      }),
    );
  }

  // -----------------------------------------------------------------------
  // Queries (read permission; history-style dumps are tenant-scoped)
  // -----------------------------------------------------------------------

  /** One subject's balance view for one entitlement kind. */
  balanceOf(actor: SubjectId, tenant: TenantId, subject: SubjectId, entitlementKind: string): SubjectLedgerView | EconomyRefusal {
    if (!this.requirePrivilege(actor, tenant, "read")) return this.privilegeRefusal();
    const state = this.tenants.get(String(tenant));
    const key = balanceKey(tenant, subject, entitlementKind);
    return {
      tenant,
      subject,
      entitlementKind,
      balance: state?.balances.get(key) ?? 0,
      entries: (state?.journal ?? []).filter((entry) => balanceKeyOf(entry) === key),
    };
  }

  /** One entitlement's full record (grant + lifecycle + provenance). */
  entitlementView(actor: SubjectId, tenant: TenantId, entitlement: EntitlementGrantId): EntitlementView | EconomyRefusal {
    if (!this.requirePrivilege(actor, tenant, "read")) return this.privilegeRefusal();
    const record = this.entitlementIn(tenant, entitlement);
    if (record === undefined) return { ok: false, code: "unknown-entitlement", detail: "the entitlement is not recorded in this tenant" };
    return { grant: record.grant, lifecycle: record.lifecycle, provenance: record.provenance };
  }

  /** The append-only ledger journal (E10), tenant-scoped, optional subject filter. */
  ledgerOf(tenant: TenantId, subject?: SubjectId): readonly LedgerEntry[] {
    return (this.tenants.get(String(tenant))?.journal ?? [])
      .filter((entry) => subject === undefined || entry.subject === subject)
      .map((entry) => ({ ...entry }));
  }

  /** The append-only settlement journal (E10), tenant-scoped. */
  settlementsOf(tenant: TenantId): readonly EntitlementSettlementRecord[] {
    return (this.tenants.get(String(tenant))?.settlements ?? []).map((record) => ({ ...record }));
  }

  // -----------------------------------------------------------------------
  // Snapshot / restore (E6 durability seam; content-addressed, E9/E10)
  // -----------------------------------------------------------------------

  /** Persist a byte-stable, content-addressed checkpoint of all state. */
  snapshot(): SnapshotResult {
    if (this.tenants.size === 0) {
      return { ok: false, code: "empty-state", detail: "nothing to snapshot" };
    }
    const document = canonicalJson(documentOf([...this.tenants.values()], this.revision));
    const snapshotId = digestOf(document);
    this.store.save({ snapshotId, revision: this.revision, document });
    return { ok: true, snapshotId, revision: this.revision };
  }

  /** Re-adopt a stored snapshot document (whole-document, no partial apply). */
  restore(snapshotId?: ContentDigest): SnapshotResult {
    const stored = snapshotId === undefined ? this.store.list().at(-1) : this.store.load(snapshotId);
    if (stored === undefined) {
      return { ok: false, code: "unknown-snapshot", detail: "no stored snapshot to restore" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored.document);
    } catch {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not valid JSON" };
    }
    if (!isEconomyStateDocument(parsed)) {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not an economy state document" };
    }
    this.tenants.clear();
    for (const state of tenantStatesOf(parsed)) {
      this.tenants.set(String(state.tenant), state);
    }
    this.revision = parsed.revision;
    return { ok: true, snapshotId: stored.snapshotId, revision: stored.revision };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private foldConsume(input: ConsumeInput | AdjustInput, delta: number, build: (entryId: LedgerEntryId, balanceAfter: number) => LedgerEntry): LedgerFoldResult {
    const state = this.tenantOf(input.tenant);
    const key = balanceKey(input.tenant, input.subject, input.entitlementKind);
    const current = state.balances.get(key) ?? 0;
    const outcome = foldEntryIntoState(state, build(input.entryId, current + delta));
    if (outcome.ok) this.revision += 1;
    return outcome;
  }

  /** Grants already recorded under the request's grant idempotency key. */
  private priorGrantsFor(request: EconomySettlementRequest): readonly EntitlementGrant[] {
    const state = this.tenants.get(String(request.tenant));
    if (state === undefined) return [];
    return [...state.entitlements.values()].map((record) => record.grant).filter(
      (grant) => grant.subject === request.subject && grant.causation.outcomeEvidence === request.outcomeEvidence,
    );
  }

  private requirePrivilege(actor: SubjectId, tenant: TenantId, permission: CapabilityPermission): boolean {
    const decision = checkLeastPrivilege({ tenant, subject: actor, capability: "rewards", permission }, this.grants.grants());
    if (decision.ok) return true;
    this.lastPrivilegeCode = decision.code;
    return false;
  }

  /** The shared least-privilege refusal shape for `ok`-discriminated doors. */
  private privilegeRefusal(): { readonly ok: false; readonly code: Extract<PrivilegeCheck, { ok: false }>["code"]; readonly detail: string } {
    return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
  }

  private tenantOf(tenant: TenantId): TenantEconomyState {
    const existing = this.tenants.get(String(tenant));
    if (existing !== undefined) return existing;
    const created = emptyTenantState(tenant);
    this.tenants.set(String(tenant), created);
    return created;
  }

  private entitlementIn(tenant: TenantId, entitlement: EntitlementGrantId): EntitlementRecord | undefined {
    return this.tenants.get(String(tenant))?.entitlements.get(String(entitlement));
  }
}

/** Structural check of the shared ledger door input fields. */
function isLedgerDoorInput(input: ConsumeInput | AdjustInput): boolean {
  return (
    typeof input.entryId === "string" && input.entryId.length > 0 &&
    typeof input.tenant === "string" && input.tenant.length > 0 &&
    typeof input.subject === "string" &&
    input.subject.length > 0 &&
    typeof input.entitlementKind === "string" &&
    input.entitlementKind.length > 0
  );
}
