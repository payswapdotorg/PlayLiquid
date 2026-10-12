/**
 * THE LAB LEARNING SERVICE (PL-030) — the single mutable-state owner (E1)
 * of the Lab loop's learning layer.
 *
 * The service owns the tenant-scoped, append-only learning-cycle table;
 * EVERYTHING else is a host-injected port (ports.ts). Discipline
 * (spec/worker-contract.md):
 *
 * - command admission: the pure intake oracle (intake.ts) runs over
 *   caller-supplied time + this service's owned state. The only write
 *   anywhere is the APPEND of one sealed, content-addressed record —
 *   there is no update, revise or rewrite operation in this class (E10);
 * - idempotency: the learning-cycle identity is the idempotency key —
 *   identical cycle content derives the same record id and re-learning
 *   returns the existing record as a typed receipt (`duplicate: true`),
 *   never a second copy, never an error;
 * - tenant isolation (R20): every read checks `checkTenantIsolation`
 *   (platform-contracts authority — consumed, never re-implemented);
 *   cross-tenant access is a typed refusal (E8). Signals and guidance
 *   fold ONLY the caller's own records — a foreign caller sees their own
 *   (empty) state, never another tenant's;
 * - tamper discipline (E8/E10): every read re-verifies the identity
 *   digest against the record's folded fields
 *   (`tampered-content-digest`), and restore refuses tampered documents;
 * - persistence: every mutation snapshots the whole document
 *   content-addressed through {@link LabLearningStore} (E6 — the durable
 *   store is the host's to wire).
 *
 * Pure domain: no IO, no timers, no globals; synchronous refusals mutate
 * nothing.
 */

import { checkTenantIsolation } from "@playliquid/platform-contracts";
import type { LearningCycleRecord } from "./records.ts";
import { admitLearningCycle } from "./intake.ts";
import { deriveLabLearningSignals } from "./signals.ts";
import { deriveGapLadderSummaries } from "./gaps.ts";
import { deriveSearchGuidance, verifySearchGuidanceMarker } from "./guidance.ts";
import type { GuidanceDerivationMode } from "./guidance.ts";
import { learningDigestOf, verifyLearningRecord } from "./digest.ts";
import type { LabLearningCaller, LabLearningDocument, LabLearningPorts } from "./ports.ts";
import type {
  GapSummariesDoorResult,
  GuidanceDoorResult,
  GuidanceDoorInput,
  LearnDoorInput,
  LearnDoorResult,
  LearningReadResult,
  RestoreDoorResult,
  SignalsDoorResult,
  VerifyGuidanceDoorInput,
  VerifyGuidanceDoorResult,
} from "./service-types.ts";

/** Construction options. */
export interface LabLearningServiceOptions {
  readonly ports: LabLearningPorts;
}

/** The service. Construct with injected ports; drive through the doors. */
export class LabLearningService {
  private readonly ports: LabLearningPorts;
  private readonly records = new Map<string, LearningCycleRecord>();

  constructor(options: LabLearningServiceOptions) {
    this.ports = options.ports;
  }

  /**
   * The learn door: folds one completed Lab cycle's artifacts into a
   * sealed, content-addressed record (E10 receipt on duplicates; typed
   * refusals on conflicting re-learns and non-monotonic sequences).
   */
  learnCycle(submission: LearnDoorInput): LearnDoorResult {
    const known = this.tenantRecords(submission.tenant);
    const admitted = admitLearningCycle(submission, { records: known });
    if (!admitted.ok) return { ok: false, code: admitted.code, detail: admitted.detail };
    if (admitted.duplicate) return { ok: true, record: admitted.record, duplicate: true };
    this.records.set(admitted.record.recordId, admitted.record);
    this.persist();
    return { ok: true, record: admitted.record, duplicate: false };
  }

  /**
   * Tenant-scoped read of one learning record by record id OR cycle id
   * (R20 cross-tenant refusal; E8 tampered-digest refusal).
   */
  getLearningCycle(id: string, as: LabLearningCaller): LearningReadResult {
    const stored = this.records.get(id) ?? [...this.records.values()].find((record) => record.cycleId === id);
    if (stored === undefined) {
      return { ok: false, code: "cycle-record-unknown", detail: `no learning record for ${id} was ever appended` };
    }
    const isolation = checkTenantIsolation(as, stored);
    if (!isolation.ok) {
      return {
        ok: false,
        code: "cross-tenant",
        detail: `subject ${String(as.subject)} of tenant ${String(isolation.requestTenant)} cannot read learning record ${stored.recordId} of tenant ${String(isolation.resourceTenant)} (R20)`,
      };
    }
    if (!verifyLearningRecord(stored)) {
      return {
        ok: false,
        code: "tampered-content-digest",
        detail: `learning record ${stored.recordId} no longer matches its content-addressed identity (E8)`,
      };
    }
    return { ok: true, record: stored };
  }

  /** Tenant-scoped listing of learning records (fold order). */
  listLearningCycles(as: LabLearningCaller): readonly LearningCycleRecord[] {
    return [...this.records.values()]
      .filter((record) => checkTenantIsolation(as, record).ok)
      .sort((a, b) => a.sequence - b.sequence || a.recordId.localeCompare(b.recordId));
  }

  /**
   * The signals door: derives the deterministic learning-signal fold over
   * the CALLER's accumulated records (R16/R17). Tenant-scoped; a foreign
   * caller sees their own state, never another tenant's.
   */
  deriveSignals(as: LabLearningCaller): SignalsDoorResult {
    return { ok: true, signals: deriveLabLearningSignals(this.tenantRecords(as.tenant), as.tenant) };
  }

  /**
   * The R18 gap door: recurring capability-gap summaries, classified by
   * the frozen ladder rung, with recurrence counts — recorded and typed,
   * never auto-escalated (escalation is a host decision).
   */
  summarizeGaps(as: LabLearningCaller): GapSummariesDoorResult {
    return deriveGapLadderSummaries(this.tenantRecords(as.tenant));
  }

  /**
   * The guidance door — the top-level product: the typed object that
   * parameterizes lab-organization's next search request, derived ONLY
   * from the caller's learning state. The empty state yields the typed
   * baseline guidance, never an exception.
   */
  deriveSearchGuidance(as: LabLearningCaller, input: GuidanceDoorInput): GuidanceDoorResult {
    const records = this.tenantRecords(as.tenant);
    const mode: GuidanceDerivationMode = input.mode;
    return deriveSearchGuidance({ records, tenant: as.tenant, mode });
  }

  /**
   * The guidance verification door (E11): re-derives the guidance from the
   * caller's learning state and compares it with the presented object —
   * a stripped or forged marker is a typed refusal, never a silent
   * accept.
   */
  verifyGuidance(as: LabLearningCaller, input: VerifyGuidanceDoorInput): VerifyGuidanceDoorResult {
    const marker = verifySearchGuidanceMarker(input.guidance);
    if (!marker.ok) return { ok: false, code: marker.code, detail: marker.detail };
    const rederived = this.deriveSearchGuidance(as, { mode: input.mode });
    if (!rederived.ok) return { ok: false, code: rederived.code, detail: rederived.detail };
    const carried = (input.guidance as { readonly digest: unknown }).digest;
    const matches = String(rederived.guidance.digest) === String(carried);
    return { ok: true, matches };
  }

  /** The current content-addressed service document (persistence view). */
  document(): LabLearningDocument {
    const records = [...this.records.values()].sort(
      (a, b) => a.sequence - b.sequence || a.recordId.localeCompare(b.recordId),
    );
    return {
      stateDigest: String(learningDigestOf({ records })),
      records,
    };
  }

  /**
   * Restores the whole document from the store (E6 snapshot restore).
   * Every record's content-addressed identity is re-verified — a tampered
   * document is a typed refusal, never restored (E8).
   */
  restore(): RestoreDoorResult {
    const loaded = this.ports.store.load();
    if (loaded === undefined) {
      return { ok: false, code: "no-persisted-document", detail: "no persisted document to restore" };
    }
    for (const record of loaded.records) {
      if (!verifyLearningRecord(record)) {
        return {
          ok: false,
          code: "tampered-content-digest",
          detail: `persisted learning record ${String(record.recordId)} no longer matches its content-addressed identity (E8)`,
        };
      }
    }
    this.records.clear();
    for (const record of loaded.records) {
      this.records.set(record.recordId, record);
    }
    return { ok: true, count: this.records.size };
  }

  /** The caller's tenant's records in fold order (the owned state view). */
  private tenantRecords(tenant: LabLearningCaller["tenant"]): readonly LearningCycleRecord[] {
    return [...this.records.values()]
      .filter((record) => checkTenantIsolation({ tenant }, record).ok)
      .sort((a, b) => a.sequence - b.sequence || a.recordId.localeCompare(b.recordId));
  }

  /** Snapshots the whole document into the store (content-addressed, E6). */
  private persist(): void {
    this.ports.store.save(this.document());
  }
}
