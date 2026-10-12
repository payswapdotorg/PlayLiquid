/**
 * THE ARENA RUNTIME SERVICE (PL-031) — the single mutable-state owner (E1)
 * of the Arena escalation runtime.
 *
 * Owned state: the tenant-scoped escalation-source registry, the case table,
 * the send/ingest receipt ledgers (PL-031 is the receipt-store owner
 * arena-integration's oracles name) and the authorization audit log. Every
 * mutation snapshots the whole content-addressed document through the store
 * port (E6) — a crashed send resumes to its last durable state, and the only
 * wire retries that can ever happen re-submit the SAME envelope (the Arena
 * side dedupes by content key).
 *
 * Orchestration (driveCase): the case's lifecycle drives arena-integration's
 * OWN state machine through the pure steps in drive.ts — draft→authorized
 * (Lab usage-rule policy + audit append), authorized→sent (the send
 * idempotency oracle over the receipt ledger), sent→responded (the
 * ArenaTransport port; the response's digest is tamper-checked before
 * anything is ingested), responded→ingested|rejected (the ingest oracle; a
 * validation failure ends the case rejected with the rejected-verdict
 * evidence package filed — a refusal is evidence, E10). Terminal states are
 * immutable (E10): re-drives are honest no-ops.
 *
 * Tenant isolation (R20): every read/drive checks `checkTenantIsolation`
 * (platform-contracts authority — consumed, never re-implemented); intake
 * and registration are structurally tenant-scoped (the caller's registry
 * view). Cross-tenant access is a typed refusal (E8).
 *
 * INGESTION-ONLY (lock rules 6/32): no door of this service can mutate live
 * PlayLiquid state from an Arena response — the only products are passive
 * evidence packages and their epistemic labels (epistemic.ts), structural
 * negative-tested in no-mutation.test.ts.
 *
 * Pure domain: no IO beyond the injected ports, no timers, no globals;
 * synchronous refusals mutate nothing.
 */

import {
  arenaSendIdempotencyKey,
  arenaSendIdempotencyKeyText,
  asArenaTimestampMs,
  EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG,
  expireArenaEscalation,
  isArenaEndpointRef,
  isArenaRequestKind,
  validateArenaAuthorizationAuditLog,
} from "@playliquid/arena-integration";
import type {
  ArenaAuthorizationAuditLog,
  ArenaEvidencePackage,
  ArenaLifecycleRecord,
  ArenaSendReceipt,
  ArenaTimestampMs,
} from "@playliquid/arena-integration";
import { checkTenantIsolation } from "@playliquid/platform-contracts";
import { arenaCaseDigestOf, arenaDocumentDigestOf, arenaSourceDigestOf, arenaSourceKeyOf } from "./digest.ts";
import { authorizeCaseStep, deliverCaseStep, ingestCaseStep, isTerminalArenaState, settleSendCaseStep } from "./drive.ts";
import type { DriveStep } from "./drive.ts";
import { labelArenaEvidencePackage } from "./epistemic.ts";
import { openArenaEscalationCase, registerEscalationSource } from "./intake.ts";
import type { ArenaEscalationCase, ArenaEscalationCommand, EscalationSourceSubmission, RegisteredEscalationSource } from "./records.ts";
import type {
  CaseReadResult,
  DriveCaseResult,
  LabeledEvidenceResult,
  OpenCaseDoorResult,
  RegisterSourceDoorResult,
  RestoreDoorResult,
} from "./service-types.ts";
import type { ArenaRuntimeCaller, ArenaRuntimeDocument, ArenaRuntimePorts } from "./ports.ts";

/** Construction options. */
export interface ArenaRuntimeServiceOptions {
  readonly ports: ArenaRuntimePorts;
}

/** The service. Construct with injected ports; drive through the doors. */
export class ArenaRuntimeService {
  private readonly ports: ArenaRuntimePorts;
  private readonly sources = new Map<string, RegisteredEscalationSource>();
  private readonly cases = new Map<string, ArenaEscalationCase>();
  private readonly sendLedger = new Map<string, ArenaSendReceipt>();
  private auditLog: ArenaAuthorizationAuditLog = EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG;

  constructor(options: ArenaRuntimeServiceOptions) {
    this.ports = options.ports;
  }

  /**
   * The registration door: files one escalation source under the CALLER's
   * tenant (structural validation per kind consumes the consumed packages'
   * own oracles). Duplicates are idempotent receipts (E10).
   */
  registerSource(as: ArenaRuntimeCaller, submission: EscalationSourceSubmission): RegisterSourceDoorResult {
    const registered = registerEscalationSource(as.tenant, submission, this.tenantSources(as.tenant));
    if (!registered.ok) return registered;
    if (!registered.duplicate) {
      this.sources.set(this.registryKey(as.tenant, registered.source.sourceKey), registered.source);
      this.persist();
    }
    return registered;
  }

  /**
   * The intake door: opens (or resumes) the content-addressed case of a
   * DECIDED escalation. The runtime never auto-escalates — see intake.ts.
   */
  openEscalationCase(as: ArenaRuntimeCaller, command: ArenaEscalationCommand): OpenCaseDoorResult {
    const opened = openArenaEscalationCase(as.tenant, command, {
      sources: this.tenantSources(as.tenant),
      cases: this.tenantCases(as.tenant),
    });
    if (!opened.ok) {
      return opened.envelopeReasons === undefined
        ? { ok: false, code: opened.code, detail: opened.detail }
        : { ok: false, code: opened.code, detail: opened.detail, envelopeReasons: opened.envelopeReasons };
    }
    if (!opened.duplicate) {
      this.cases.set(String(opened.case.caseId), opened.case);
      this.persist();
    }
    return { ok: true, case: opened.case, duplicate: opened.duplicate };
  }

  /**
   * The orchestration door (E6): advances one case as far as its durable
   * state allows. Every state advance persists before the next step, so a
   * crash at any point resumes to the last durable state; the send ledger
   * guarantees one EFFECTIVE send per content key.
   */
  async driveCase(as: ArenaRuntimeCaller, caseId: string): Promise<DriveCaseResult> {
    const stored = this.cases.get(caseId);
    if (stored === undefined) {
      return { ok: false, code: "unknown-case", detail: `no escalation case ${caseId} was ever opened` };
    }
    const isolation = checkTenantIsolation(as, stored);
    if (!isolation.ok) {
      return { ok: false, code: "cross-tenant", detail: `subject ${String(as.subject)} of tenant ${String(isolation.requestTenant)} cannot drive case ${String(stored.caseId)} of tenant ${String(isolation.resourceTenant)} (R20)` };
    }
    if (!this.verifies(stored)) {
      return { ok: false, code: "tampered-case", detail: `case ${caseId} no longer matches its content-addressed identity (E8)` };
    }
    let current = stored;

    // Terminal states are immutable (E10): a re-run of a finished case is
    // an honest no-op that NEVER re-sends.
    if (isTerminalArenaState(current.lifecycle.state)) {
      return { ok: true, outcome: { status: "terminal", case: current, state: current.lifecycle.state } };
    }

    // The caller-owned deadline fold (no clock authority: both points are
    // the port-supplied now and the case's expiresAt).
    const now = this.now();
    const expiry = expireArenaEscalation(current.lifecycle, now);
    if (expiry.ok) {
      current = this.commit(current, { lifecycle: expiry.record });
      return { ok: true, outcome: { status: "expired", case: current } };
    }

    if (current.lifecycle.state === "draft") {
      const step = this.apply(authorizeCaseStep(current, this.ports.policy, this.auditLog, now));
      if (step.kind !== "advanced") return this.settle(step);
      current = step.case;
    }
    if (current.lifecycle.state === "authorized") {
      const key = arenaSendIdempotencyKeyText(arenaSendIdempotencyKey(current.request));
      const step = this.apply(settleSendCaseStep(current, this.sendLedger.get(key), this.now()));
      if (step.kind !== "advanced") return this.settle(step);
      current = step.case;
    }
    if (current.lifecycle.state === "sent") {
      const step = this.apply(await deliverCaseStep(current, this.ports.transport, this.now()));
      if (step.kind !== "advanced") return this.settle(step);
      current = step.case;
    }
    if (current.lifecycle.state === "responded") {
      return this.settle(this.apply(ingestCaseStep(current, this.now())));
    }
    return { ok: false, code: "inconsistent-state", detail: `case ${caseId} is in an undriveable state ${current.lifecycle.state}` };
  }

  /** Tenant-scoped read of one case (R20 cross-tenant refusal; E8 tamper refusal). */
  getCase(as: ArenaRuntimeCaller, caseId: string): CaseReadResult {
    const stored = this.cases.get(caseId);
    if (stored === undefined) {
      return { ok: false, code: "unknown-case", detail: `no escalation case ${caseId} was ever opened` };
    }
    const isolation = checkTenantIsolation(as, stored);
    if (!isolation.ok) {
      return { ok: false, code: "cross-tenant", detail: `subject ${String(as.subject)} of tenant ${String(isolation.requestTenant)} cannot read case ${String(stored.caseId)} of tenant ${String(isolation.resourceTenant)} (R20)` };
    }
    if (!this.verifies(stored)) {
      return { ok: false, code: "tampered-case", detail: `case ${caseId} no longer matches its content-addressed identity (E8)` };
    }
    return { ok: true, case: stored };
  }

  /** Tenant-scoped listing of escalation cases (open order). */
  listCases(as: ArenaRuntimeCaller): readonly ArenaEscalationCase[] {
    return this.tenantCases(as.tenant);
  }

  /** Tenant-scoped listing of registered escalation sources. */
  listSources(as: ArenaRuntimeCaller): readonly RegisteredEscalationSource[] {
    return this.tenantSources(as.tenant);
  }

  /**
   * The epistemic door (E11): labels the case's ADMITTED evidence package
   * payload-by-payload with its external class and full provenance. Absent
   * or rejected evidence labels to the empty list — total, never throws.
   */
  labeledEvidence(as: ArenaRuntimeCaller, caseId: string): LabeledEvidenceResult {
    const read = this.getCase(as, caseId);
    if (!read.ok) return read;
    const pkg = read.case.evidencePackage;
    if (pkg === undefined || pkg.verdict !== "admitted") return { ok: true, labels: [] };
    return { ok: true, labels: labelArenaEvidencePackage(pkg, read.case.request) };
  }

  /** The current content-addressed service document (persistence view). */
  document(): ArenaRuntimeDocument {
    const sources = [...this.sources.values()].sort((a, b) => String(a.sourceKey).localeCompare(String(b.sourceKey)));
    const cases = this.tenantAllCases();
    const sendLedger = [...this.sendLedger.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, receipt]) => receipt);
    return {
      stateDigest: String(arenaDocumentDigestOf({ sources, cases, sendLedger, auditLog: this.auditLog })),
      sources,
      cases,
      sendLedger,
      auditLog: this.auditLog,
    };
  }

  /**
   * Restores the whole document from the store (E6 snapshot restore). The
   * document's own content address, every case's identity digest, every
   * source's digest, the audit chain and the send receipts are re-verified —
   * a tampered document is a typed refusal, never restored (E8). Restore
   * is atomic: nothing is adopted unless everything verifies.
   */
  restore(): RestoreDoorResult {
    const loaded = this.ports.store.load();
    if (loaded === undefined) {
      return { ok: false, code: "no-persisted-document", detail: "no persisted document to restore" };
    }
    const digest = String(arenaDocumentDigestOf({ sources: loaded.sources, cases: loaded.cases, sendLedger: loaded.sendLedger, auditLog: loaded.auditLog }));
    if (digest !== loaded.stateDigest) {
      return { ok: false, code: "tampered-document", detail: "the persisted document no longer matches its content-addressed state digest (E8)" };
    }
    const audit = validateArenaAuthorizationAuditLog(loaded.auditLog);
    if (!audit.valid) {
      return { ok: false, code: "tampered-document", detail: `the persisted authorization audit chain is broken: ${audit.reasons.join(", ")} (E8)` };
    }
    for (const source of loaded.sources) {
      const sourceDigest = arenaSourceDigestOf({
        tenant: String(source.tenant),
        submission:
          source.kind === "gap-finding"
            ? { kind: source.kind, finding: source.finding, record: source.record }
            : source.kind === "gap-record"
              ? { kind: source.kind, record: source.record }
              : { kind: source.kind, summary: source.summary },
      });
      if (sourceDigest !== source.sourceDigest || arenaSourceKeyOf(sourceDigest) !== source.sourceKey) {
        return { ok: false, code: "tampered-document", detail: `registered source ${String(source.sourceKey)} no longer matches its content-addressed identity (E8)` };
      }
    }
    for (const record of loaded.cases) {
      if (!this.verifies(record)) {
        return { ok: false, code: "tampered-document", detail: `persisted case ${String(record.caseId)} no longer matches its content-addressed identity (E8)` };
      }
    }
    for (const receipt of loaded.sendLedger) {
      if (!isArenaRequestKind(receipt.requestKind) || !isArenaEndpointRef(receipt.key.endpoint)) {
        return { ok: false, code: "tampered-document", detail: "a persisted send receipt failed structural validation (E8)" };
      }
    }
    this.sources.clear();
    for (const source of loaded.sources) this.sources.set(this.registryKey(source.tenant, source.sourceKey), source);
    this.cases.clear();
    for (const record of loaded.cases) this.cases.set(String(record.caseId), record);
    this.sendLedger.clear();
    for (const receipt of loaded.sendLedger) this.sendLedger.set(arenaSendIdempotencyKeyText(receipt.key), receipt);
    this.auditLog = loaded.auditLog;
    return { ok: true, cases: this.cases.size, sources: this.sources.size };
  }

  // -----------------------------------------------------------------------
  // State application (the drive steps' imperative shell)
  // -----------------------------------------------------------------------

  /** Applies a drive step's side effects; refusals mutate nothing. */
  private apply(step: DriveStep): DriveStep {
    if (step.kind === "refusal") return step;
    if (step.auditLog !== undefined) this.auditLog = step.auditLog;
    if (step.kind === "advanced" && step.sendReceipt !== undefined) {
      this.sendLedger.set(arenaSendIdempotencyKeyText(step.sendReceipt.key), step.sendReceipt);
    }
    const record = step.kind === "advanced" ? step.case : step.commit;
    if (record !== undefined && this.cases.get(String(record.caseId)) !== record) {
      this.cases.set(String(record.caseId), record);
      this.persist();
    }
    return step;
  }

  /** Resolves an ended drive step to its door result. */
  private settle(step: DriveStep): DriveCaseResult {
    if (step.kind === "outcome") return { ok: true, outcome: step.outcome };
    if (step.kind === "refusal") return step.refusal;
    return { ok: false, code: "inconsistent-state", detail: "the drive step advanced without continuing the drive" };
  }

  /** Applies a patch to a case and persists the whole document (E6 atomicity). */
  private commit(record: ArenaEscalationCase, patch: Partial<ArenaEscalationCase>): ArenaEscalationCase {
    const updated: ArenaEscalationCase = Object.freeze({ ...record, ...patch });
    this.cases.set(String(updated.caseId), updated);
    this.persist();
    return updated;
  }

  /** The content-addressed identity oracle over a case (E8 tamper check). */
  private verifies(record: ArenaEscalationCase): boolean {
    return (
      arenaCaseDigestOf({
        caseId: String(record.caseId),
        tenant: String(record.tenant),
        sourceKey: String(record.sourceKey),
        sourceKind: record.sourceKind,
        request: record.request,
        openedAt: record.openedAt,
      }) === record.caseDigest
    );
  }

  /** The caller's tenant's registered sources (key order). */
  private tenantSources(tenant: ArenaRuntimeCaller["tenant"]): readonly RegisteredEscalationSource[] {
    return [...this.sources.values()]
      .filter((source) => checkTenantIsolation({ tenant }, source).ok)
      .sort((a, b) => String(a.sourceKey).localeCompare(String(b.sourceKey)));
  }

  /** The caller's tenant's cases (open order). */
  private tenantCases(tenant: ArenaRuntimeCaller["tenant"]): readonly ArenaEscalationCase[] {
    return this.tenantAllCases().filter((record) => checkTenantIsolation({ tenant }, record).ok);
  }

  /** Every case in open order (fold order for the document view). */
  private tenantAllCases(): readonly ArenaEscalationCase[] {
    return [...this.cases.values()].sort(
      (a, b) => a.openedAt - b.openedAt || String(a.caseId).localeCompare(String(b.caseId)),
    );
  }

  /** Registry map key (tenant + source key). */
  private registryKey(tenant: ArenaRuntimeCaller["tenant"], sourceKey: RegisteredEscalationSource["sourceKey"]): string {
    return `${String(tenant)}|${String(sourceKey)}`;
  }

  /** The port-supplied now as an ArenaTimestampMs (typed refusal on a broken clock). */
  private now(): ArenaTimestampMs {
    return asArenaTimestampMs(this.ports.clock.now())!;
  }

  /** Snapshots the whole document into the store (content-addressed, E6). */
  private persist(): void {
    this.ports.store.save(this.document());
  }
}

/** Type re-exports for door wiring (typed at every door). */
export type { ArenaEscalationCase, ArenaLifecycleRecord, ArenaEvidencePackage };
