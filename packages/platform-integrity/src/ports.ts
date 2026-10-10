/**
 * PORTS — the host-owned effect seams (PL-018, E6).
 *
 * The service is pure: persistence, time and capability grants enter
 * through exactly these three injected interfaces, mirrored from the
 * platform-leaderboard/platform-economy precedent:
 *
 * - {@link IntegrityStore} — content-addressed snapshot durability
 *   (save/list/load; idempotent saves, conflicting rewrites refused);
 * - {@link ServiceClock} — the ONLY time source the service consults
 *   (journal/issue timestamps; the clock is injected, never read);
 * - {@link GrantDirectory} — the least-privilege seam (R20).
 *
 * The serializable state document (snapshot payload) and its structural
 * guard also live here: snapshot/restore round-trips are whole-document
 * adoptions with no partial apply.
 *
 * Purity: interfaces + structural data only. No IO anywhere.
 */

import type {
  BehavioralEvidenceRecord,
  ContentDigest,
  ScopedCapabilityGrant,
  TimestampMs,
} from "@playliquid/platform-contracts";

/** A durable, content-addressed integrity state snapshot. */
export interface StoredIntegritySnapshot {
  /** Digest of the snapshot document's canonical form. */
  readonly snapshotId: ContentDigest;
  readonly revision: number;
  readonly document: IntegrityStateDocument;
}

/** The durability port. Real adapters are host concerns. */
export interface IntegrityStore {
  readonly save: (snapshot: StoredIntegritySnapshot) => void;
  readonly list: () => readonly StoredIntegritySnapshot[];
  readonly load: (snapshotId: ContentDigest) => StoredIntegritySnapshot | undefined;
}

/** The only time source the service will ever consult. */
export interface ServiceClock {
  readonly now: () => TimestampMs;
}

/** The least-privilege seam (R20): current scoped capability grants. */
export interface GrantDirectory {
  readonly grants: () => readonly ScopedCapabilityGrant[];
}

// ---------------------------------------------------------------------------
// The serializable state document
// ---------------------------------------------------------------------------

/**
 * One journal entry of the append-only evaluation history (E10): the
 * idempotency key, the content-derived report/verdict identities, the
 * evidence records it rests on, and the issue timestamps.
 */
export interface EvaluationReceipt {
  /** Content-derived receipt identity (`rcpt-<hex>`). */
  readonly receiptId: string;
  /** The evaluation idempotency key digest (bare hex). */
  readonly evaluationKey: string;
  readonly tenant: string;
  readonly subject: string;
  readonly policyId: string;
  readonly reportId: string;
  readonly verdictId: string;
  readonly evidenceIds: readonly string[];
  readonly replayId: string;
  readonly playMode: string;
  readonly enforcement: string;
  readonly submittedAt: number;
  /** Journal sequence (monotonic; strictly increasing per mutation). */
  readonly revision: number;
}

/**
 * The whole-state document: every evidence record, report, verdict and
 * receipt the service owns, in append-only order. Restoring adopts the
 * WHOLE document — there is no partial apply.
 */
export interface IntegrityStateDocument {
  readonly documentKind: "integrity-state";
  readonly revision: number;
  readonly evidence: readonly BehavioralEvidenceRecord[];
  readonly reports: readonly unknown[];
  readonly verdicts: readonly unknown[];
  readonly receipts: readonly EvaluationReceipt[];
}

/** Returns true when `value` is structurally an {@link IntegrityStateDocument}. */
export function isIntegrityStateDocument(value: unknown): value is IntegrityStateDocument {
  if (typeof value !== "object" || value === null) return false;
  const document = value as Record<string, unknown>;
  if (document.documentKind !== "integrity-state") return false;
  if (typeof document.revision !== "number" || !Number.isSafeInteger(document.revision)) return false;
  if (!Array.isArray(document.evidence)) return false;
  if (!Array.isArray(document.reports)) return false;
  if (!Array.isArray(document.verdicts)) return false;
  if (!Array.isArray(document.receipts)) return false;
  return document.receipts.every((receipt) => {
    if (typeof receipt !== "object" || receipt === null) return false;
    const candidate = receipt as Record<string, unknown>;
    return (
      typeof candidate.receiptId === "string" &&
      typeof candidate.evaluationKey === "string" &&
      typeof candidate.tenant === "string" &&
      typeof candidate.subject === "string" &&
      typeof candidate.policyId === "string" &&
      typeof candidate.reportId === "string" &&
      typeof candidate.verdictId === "string" &&
      Array.isArray(candidate.evidenceIds) &&
      typeof candidate.revision === "number"
    );
  });
}

// ---------------------------------------------------------------------------
// Service construction
// ---------------------------------------------------------------------------

/** Construction options: the three injected ports. */
export interface IntegrityServiceOptions {
  readonly store: IntegrityStore;
  readonly clock: ServiceClock;
  readonly grants: GrantDirectory;
}
