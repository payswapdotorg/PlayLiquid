/**
 * THE INTEGRITY SERVICE — the platform competitive-integrity authority
 * (PL-018; R7/R11, E1/E8/E9/E10).
 *
 * Async/stateful discipline (spec/worker-contract.md, mirrored from the
 * platform-leaderboard precedent):
 * - MUTABLE STATE OWNER: this instance alone owns the evidence, report,
 *   verdict and receipt history; all state is private behind these doors.
 * - COMMAND ADMISSION: `submitEvaluation` is the single write path —
 *   `submit` permission for the evaluation's tenant, then the pure
 *   admission oracle (admission.ts), fail closed.
 * - EVENT ORDER: the receipt journal is append-only, ordered by a
 *   monotonic revision counter bumped once per mutation.
 * - IDEMPOTENCY KEY: the digest of the evaluation's canonical content
 *   (tenant, subject, replay reference, stream digest, play mode,
 *   declaration, re-execution, policy id). Same key → the recorded
 *   receipt, no second mutation; different content → a NEW report
 *   version (E10: history is never edited).
 * - STALE-RESULT RULE: verdicts pin their report and the evidence
 *   payload digests they rest on; a re-execution observation pinned to a
 *   different stream digest is refused at admission.
 * - REPLAY/RESUME BOUNDARY: `snapshot()`/`restore()` are whole-document
 *   content-addressed adoptions through the store port; restore
 *   re-validates every record — tampered history never re-enters.
 * - RETRY/CANCELLATION: pure synchronous domain — a crashed submission
 *   either mutated nothing or is idempotent on retry.
 *
 * Enforcement is NOT here (R11/lock 29): the host composes the frozen
 * `decideEnforcement` oracle downstream of these reports/verdicts.
 *
 * Purity: no IO, no timers, no globals — persistence, time and grants
 * are injected ports; every identifier is content-derived (E9).
 */

import type {
  BehavioralEvidenceRecord,
  IntegrityReport,
  IntegrityRiskVerdict,
  ScopedCapabilityGrant,
  SubjectId,
  TenantId,
  ContentDigest,
} from "@playliquid/platform-contracts";
import { checkLeastPrivilege } from "@playliquid/platform-contracts";
import { admitEvaluation } from "./admission.ts";
import type { IntegrityEvaluationRequest } from "./admission.ts";
import { DEFAULT_INTEGRITY_RISK_POLICY, validateIntegrityRiskPolicy } from "./policy.ts";
import type { IntegrityRiskPolicy } from "./policy.ts";
import { mintEvaluationArtifacts } from "./minting.ts";
import { adoptDocument, documentOf } from "./document.ts";
import type { AdoptedState } from "./document.ts";
import type {
  EvaluationReceipt,
  IntegrityServiceOptions,
  StoredIntegritySnapshot,
} from "./ports.ts";
import { digestOf, digestSlug } from "./digest.ts";
import type {
  EvaluationResult,
  EvidenceReadResult,
  HistoryResult,
  ReportReadResult,
  RestoreResult,
  SnapshotResult,
  StandingResult,
  VerdictReadResult,
} from "./results.ts";

/**
 * THE competitive-integrity service. One instance per host composition;
 * the instance is the single mutable-state owner (E1).
 */
export class IntegrityService {
  private readonly store: IntegrityServiceOptions["store"];
  private readonly clock: IntegrityServiceOptions["clock"];
  private readonly grants: IntegrityServiceOptions["grants"];
  private readonly evidenceRecords = new Map<string, BehavioralEvidenceRecord>();
  private readonly reportsById = new Map<string, IntegrityReport>();
  private readonly verdictsById = new Map<string, IntegrityRiskVerdict>();
  private readonly receipts: EvaluationReceipt[] = [];
  private readonly receiptByKey = new Map<string, EvaluationReceipt>();
  private revision = 0;
  private lastPrivilegeCode = "";

  constructor(options: IntegrityServiceOptions) {
    this.store = options.store;
    this.clock = options.clock;
    this.grants = options.grants;
  }

  // -------------------------------------------------------------------------
  // Privilege (R20) — every door passes through the contracts oracle.
  // -------------------------------------------------------------------------

  private requirePrivilege(actor: SubjectId, tenant: TenantId, permission: ScopedCapabilityGrant["permissions"][number]): boolean {
    const check = checkLeastPrivilege(
      { tenant, subject: actor, capability: "integrity", permission },
      this.grants.grants(),
    );
    if (!check.ok) {
      this.lastPrivilegeCode = check.code;
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // The single write path: behavioral-evidence evaluation
  // -------------------------------------------------------------------------

  /**
   * Submits one behavioral-evidence evaluation. The trace is admitted
   * (fail-closed), observations extracted, evidence records minted
   * (digest-pinned, append-only), signals evaluated under the policy,
   * the aggregate computed by the FROZEN contracts oracle, the report
   * minted and validated, the verdict classified and minted, and the
   * receipt appended. Same content key → the recorded receipt (E10).
   */
  submitEvaluation(
    actor: SubjectId,
    request: IntegrityEvaluationRequest,
    policy: IntegrityRiskPolicy = DEFAULT_INTEGRITY_RISK_POLICY,
  ): EvaluationResult {
    if (!this.requirePrivilege(actor, request.tenant, "submit")) {
      return {
        accepted: false,
        code: this.lastPrivilegeCode,
        detail: `least-privilege refusal: ${this.lastPrivilegeCode}`,
      };
    }
    const policyValidation = validateIntegrityRiskPolicy(policy);
    if (!policyValidation.ok) {
      return { accepted: false, code: policyValidation.code, detail: policyValidation.detail };
    }
    const admission = admitEvaluation(request, policy);
    if (!admission.ok) {
      return { accepted: false, code: admission.code, detail: admission.detail };
    }
    const evaluation = admission.evaluation;
    const declarationDigest =
      evaluation.declaration === undefined ? null : digestOf(evaluation.declaration);
    const reexecutionDigest =
      evaluation.outcome === undefined
        ? null
        : digestOf({ sourceDigest: evaluation.sourceDigest, outcome: evaluation.outcome });
    const keyMaterial = {
      tenant: evaluation.tenant,
      subject: evaluation.subject,
      replayId: evaluation.replayId,
      streamDigest: evaluation.sourceDigest,
      playMode: evaluation.playMode,
      declarationDigest,
      reexecutionDigest,
      policyId: policy.policyId,
    };
    const evaluationKey = digestOf(keyMaterial);
    const recorded = this.receiptByKey.get(evaluationKey);
    if (recorded !== undefined) {
      return {
        accepted: false,
        code: "duplicate-evaluation",
        detail: "this evaluation content was already recorded; E10 history is append-only",
        recorded,
      };
    }
    // Artifacts: pure minting (evidence records, signals, aggregate,
    // report, verdict) — identical content mints identical records (E9).
    const artifacts = mintEvaluationArtifacts(evaluation, policy, evaluationKey);
    // Conflict gate: a minted evidence id must never pin different
    // content than an existing record (E8 defensive; content-derived ids
    // make this unreachable in practice — the gate stays closed anyway).
    for (const record of artifacts.evidenceRecords) {
      const conflict = this.evidenceRecords.get(record.evidenceId);
      if (conflict !== undefined && conflict.payloadDigest !== record.payloadDigest) {
        return {
          accepted: false,
          code: "evidence-id-conflict",
          detail: `evidence id ${record.evidenceId} already pins different content`,
        };
      }
    }
    // Commit: exactly one revision bump for the whole mutation.
    this.revision += 1;
    for (const record of artifacts.evidenceRecords) {
      this.evidenceRecords.set(record.evidenceId, record);
    }
    const { report, verdict, evidenceIds } = artifacts;
    this.reportsById.set(report.reportId, report);
    this.verdictsById.set(verdict.verdictId, verdict);
    const receipt: EvaluationReceipt = {
      receiptId: `rcpt-${digestSlug(evaluationKey)}`,
      evaluationKey,
      tenant: evaluation.tenant,
      subject: evaluation.subject,
      policyId: policy.policyId,
      reportId: report.reportId,
      verdictId: verdict.verdictId,
      evidenceIds,
      replayId: evaluation.replayId,
      playMode: evaluation.playMode,
      enforcement: evaluation.enforcement,
      submittedAt: this.clock.now(),
      revision: this.revision,
    };
    this.receipts.push(receipt);
    this.receiptByKey.set(evaluationKey, receipt);
    return { accepted: true, receipt, report, verdict };
  }

  // -------------------------------------------------------------------------
  // Read doors (tenant-scoped, least-privilege)
  // -------------------------------------------------------------------------

  /** Reads one report by its content-derived id. */
  readReport(actor: SubjectId, tenant: TenantId, reportId: string): ReportReadResult {
    if (!this.requirePrivilege(actor, tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const report = this.reportsById.get(reportId);
    if (report === undefined || report.tenant !== tenant) {
      return { ok: false, code: "report-not-found", detail: `no report ${reportId} in this tenant` };
    }
    return { ok: true, report };
  }

  /** Reads one verdict by its content-derived id. */
  readVerdict(actor: SubjectId, tenant: TenantId, verdictId: string): VerdictReadResult {
    if (!this.requirePrivilege(actor, tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const verdict = this.verdictsById.get(verdictId);
    if (verdict === undefined || verdict.tenant !== tenant) {
      return { ok: false, code: "verdict-not-found", detail: `no verdict ${verdictId} in this tenant` };
    }
    return { ok: true, verdict };
  }

  /** Reads one behavioral evidence record by its content-derived id. */
  readEvidence(actor: SubjectId, tenant: TenantId, evidenceId: string): EvidenceReadResult {
    if (!this.requirePrivilege(actor, tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const record = this.evidenceRecords.get(evidenceId);
    if (record === undefined || record.tenant !== tenant) {
      return { ok: false, code: "evidence-not-found", detail: `no evidence record ${evidenceId} in this tenant` };
    }
    return { ok: true, record };
  }

  /** Reads the append-only evaluation journal (whole history, E10). */
  history(actor: SubjectId, tenant: TenantId): HistoryResult {
    if (!this.requirePrivilege(actor, tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    return { ok: true, receipts: this.receipts.filter((receipt) => receipt.tenant === tenant) };
  }

  /** Reads a subject's latest recorded verdict (their current standing). */
  standingFor(actor: SubjectId, tenant: TenantId, subject: SubjectId): StandingResult {
    if (!this.requirePrivilege(actor, tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    for (let index = this.receipts.length - 1; index >= 0; index -= 1) {
      const receipt = this.receipts[index]!;
      if (receipt.tenant === tenant && receipt.subject === subject) {
        const verdict = this.verdictsById.get(receipt.verdictId);
        if (verdict !== undefined) return { ok: true, verdict };
      }
    }
    return { ok: false, code: "no-recorded-verdict", detail: "no evaluation recorded for this subject" };
  }

  // -------------------------------------------------------------------------
  // Durability seams (E6): whole-document snapshot / restore
  // -------------------------------------------------------------------------

  /** Snapshots the whole state as one content-addressed document. */
  snapshot(actor: SubjectId, tenant: TenantId): SnapshotResult {
    if (!this.requirePrivilege(actor, tenant, "administer")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const state: AdoptedState = {
      revision: this.revision,
      evidence: [...this.evidenceRecords.values()],
      reports: [...this.reportsById.values()],
      verdicts: [...this.verdictsById.values()],
      receipts: [...this.receipts],
    };
    const document = documentOf(state);
    const snapshotId = digestOf(document);
    this.store.save({ snapshotId, revision: this.revision, document });
    return { ok: true, snapshotId, revision: this.revision };
  }

  /** Restores the whole state from a snapshot (latest when id omitted). */
  restore(actor: SubjectId, tenant: TenantId, snapshotId?: ContentDigest): RestoreResult {
    if (!this.requirePrivilege(actor, tenant, "administer")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    let snapshot: StoredIntegritySnapshot | undefined;
    if (snapshotId === undefined) {
      const all = this.store.list();
      snapshot = all.length === 0 ? undefined : all.reduce((best, candidate) => (candidate.revision > best.revision ? candidate : best), all[0]!);
    } else {
      snapshot = this.store.load(snapshotId);
    }
    if (snapshot === undefined) {
      return { ok: false, code: "snapshot-not-found", detail: "no snapshot matched the request" };
    }
    const adoption = adoptDocument(snapshot.document);
    if (!adoption.ok) {
      return { ok: false, code: adoption.code, detail: adoption.detail };
    }
    this.evidenceRecords.clear();
    this.reportsById.clear();
    this.verdictsById.clear();
    for (const record of adoption.state.evidence) this.evidenceRecords.set(record.evidenceId, record);
    for (const report of adoption.state.reports) this.reportsById.set(report.reportId, report);
    for (const verdict of adoption.state.verdicts) this.verdictsById.set(verdict.verdictId, verdict);
    this.receipts.length = 0;
    this.receiptByKey.clear();
    for (const receipt of adoption.state.receipts) {
      this.receipts.push(receipt);
      this.receiptByKey.set(receipt.evaluationKey, receipt);
    }
    this.revision = adoption.state.revision;
    return { ok: true, revision: this.revision };
  }
}
