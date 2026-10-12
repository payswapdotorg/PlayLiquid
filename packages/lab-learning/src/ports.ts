/**
 * INJECTED PORTS of the Lab learning service (PL-030).
 *
 * The service owns mutable domain state (E1): the tenant-scoped,
 * append-only learning-cycle table. EVERYTHING it must NOT own as ambient
 * authority arrives through these seams, each with a deterministic
 * in-memory fake (fakes.ts):
 *
 * - {@link LabLearningClockPort} — caller-programmed time (never Date.now);
 * - {@link LabLearningStore} — whole-document persistence (E6 discipline:
 *   the durable store is the host's to wire).
 *
 * The cycle artifacts themselves (observation ledgers, evaluation runs,
 * search results, gap records) are NOT ports: they are READ-ONLY data the
 * submission carries (E10 — this package never mutates a lab-contracts
 * ledger; the only writes anywhere are appends to its own records).
 *
 * Async/stateful discipline (spec/worker-contract.md), binding for this
 * package: mutable state owner = the LabLearningService instance
 * (service.ts) — persisted through {@link LabLearningStore} snapshots;
 * command admission = the pure intake oracle (intake.ts) over
 * caller-supplied time + owned state; event order = append-only,
 * admission order; idempotency key = the content-addressed learning-cycle
 * identity (E10 duplicate receipts); stale-result rule = learning records
 * are immutable and reads verify the identity digest (E8 tamper refusal);
 * replay/resume = the content-addressed service document (restore refuses
 * tampered content); retry/cancellation = refused commands mutate nothing —
 * synchronous domain, nothing to cancel.
 *
 * Pure types only.
 */

import type { LearningCycleRecord } from "./records.ts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";

/** Service-level time authority (mirrors the house ClockPort shape). */
export interface LabLearningClockPort {
  now(): number;
}

/** One persisted, content-addressed snapshot of the whole service state. */
export interface LabLearningDocument {
  /** Content address of this document (digest.ts discipline). */
  readonly stateDigest: string;
  readonly records: readonly LearningCycleRecord[];
}

/** Write/read port for service-document persistence (E6). */
export interface LabLearningStore {
  save(document: LabLearningDocument): void;
  load(): LabLearningDocument | undefined;
}

/** The port bundle the Lab learning service needs (host-injected). */
export interface LabLearningPorts {
  readonly clock: LabLearningClockPort;
  readonly store: LabLearningStore;
}

/** Who is calling (tenant + subject claim; identity authority is elsewhere). */
export interface LabLearningCaller {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}
