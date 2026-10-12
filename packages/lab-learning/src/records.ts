/**
 * LAB LEARNING RECORD VOCABULARY (PL-030) — the typed shapes of the
 * learning layer of the Lab loop (spec/architecture.md §Lab loop:
 * "observed outcome → calibration → next search"; R16/R17).
 *
 * Three record kinds:
 *
 * - {@link LabCycleLearningSubmission} — the INTAKE input: one COMPLETED
 *   Lab cycle's artifacts as READ-ONLY views: the observation ledger with
 *   its appended calibration conclusions (E10 — never mutated here), the
 *   evaluation run records (PL-028 labeled estimates, consumed never
 *   re-derived) and the search result digests (PL-029 candidates with
 *   their dimension tuples);
 * - {@link LearningCycleRecord} — the sealed, append-only, CONTENT-
 *   ADDRESSED fold of that submission (the E10 receipt pattern: identical
 *   cycle content derives the same record id; there is no update, revise
 *   or rewrite operation anywhere in this package);
 * - the folded view types ({@link FoldedOutcome}, {@link FoldedEvaluation},
 *   {@link FoldedSearchResult}) — JSON-safe, kernel-value-free summaries.
 *   Evaluation run results are folded to their metricId+kind pairs and
 *   plain-number statistics (the lab-simulation calibration-statement
 *   precedent): bigint kernel readings are deliberately NOT carried; the
 *   full run record stays in lab-simulation's store, referenced by id.
 *
 * Tenancy (R20): records are tenant-scoped; the submission's evaluations
 * must belong to the submitting tenant. Epistemic labeling (E11) is baked
 * into the shapes: folded outcomes intersect the observed-evidence marker
 * discipline of lab-contracts, and folded evaluations retain the estimate
 * method of their labeled-estimate source.
 *
 * Pure module: data types, guards, constants. No IO, no clocks, no
 * randomness; time is ALWAYS caller-supplied data.
 */

import type {
  CalibrationConclusion,
  CapabilityGapRecord,
  ContentDigest,
  LabCycleId,
  ObservationLedger,
  TimestampMs,
} from "@playliquid/lab-contracts";
import type { LabEvaluationRunRecord, LabRunStatistics } from "@playliquid/lab-simulation";
import type { CandidateBlueprint, SearchedCandidate } from "@playliquid/lab-organization";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
// ---------------------------------------------------------------------------
// Intake (the learn-door input)
// ---------------------------------------------------------------------------

/**
 * One completed Lab cycle offered to the learning layer. Every artifact is
 * a READ-ONLY view: this package folds copies into its own sealed record
 * and never mutates any ledger (E10 — the only writes anywhere are appends
 * to its own learning-cycle records).
 */
export interface LabCycleLearningSubmission {
  readonly tenant: TenantId;
  readonly owner: SubjectId;
  readonly cycleId: LabCycleId;
  /**
   * The learning sequence number — strictly increasing per tenant, so the
   * learning fold only ever moves forward (E8 negative-tested).
   */
  readonly sequence: number;
  /** The cycle's observation ledger (immutable observations + appended conclusions). */
  readonly observations: ObservationLedger;
  /** The cycle's evaluation runs (PL-028 labeled estimates). */
  readonly evaluations: readonly LabEvaluationRunRecord[];
  /** The cycle's search results (PL-029 candidates with digests + tuples). */
  readonly searchResults: readonly SearchedCandidate[];
  /** The cycle's capability-gap records (frozen ladder trails). */
  readonly gaps: readonly CapabilityGapRecord[];
  /** Caller-supplied learn time (bookkeeping; never artifact content). */
  readonly learnedAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// Folded views (JSON-safe; the sealed record's content)
// ---------------------------------------------------------------------------

/** One folded immutable observed outcome (E10 view of ObservedOutcomeRecord). */
export interface FoldedOutcome {
  readonly observationId: string;
  readonly release: string;
  readonly contentDigest: string;
  readonly summary: string;
  readonly observedAt: number;
}

/** One folded evaluation run (estimate evidence view, E11 method retained). */
export interface FoldedEvaluation {
  readonly evaluationId: string;
  readonly organization: string;
  readonly suiteId: string;
  readonly seed: string;
  readonly simulator: string;
  /** The estimate method of the run's labeled-estimate result (E11). */
  readonly method: string;
  readonly runAt: number;
  /** The deterministic run statistics read model (plain numbers). */
  readonly statistics: LabRunStatistics;
  /** The metric readings folded to (metricId, kernel kind) pairs. */
  readonly metricKinds: readonly { readonly metricId: string; readonly kind: string }[];
}

/** One folded search result (candidate digest + dimension tuple). */
export interface FoldedSearchResult {
  readonly contentDigest: string;
  readonly position: number;
  readonly spaceIndex: number;
  readonly isBaseline: boolean;
  readonly organization: string;
  readonly blueprint?: CandidateBlueprint;
}

/**
 * The sealed, immutable learning-cycle record. Content-addressed
 * (identityDigest + slug recordId); the ONLY mutable-state operation that
 * can produce it is the append in the service's learn door.
 */
export interface LearningCycleRecord {
  /** Slug id `lab-learn-<52 hex>` derived from the identity digest. */
  readonly recordId: string;
  /** The full identity digest of the folded content (E10 idempotency key). */
  readonly identityDigest: ContentDigest;
  readonly tenant: TenantId;
  readonly owner: SubjectId;
  readonly cycleId: LabCycleId;
  readonly sequence: number;
  readonly learnedAt: TimestampMs;
  readonly outcomes: readonly FoldedOutcome[];
  readonly conclusions: readonly CalibrationConclusion[];
  readonly evaluations: readonly FoldedEvaluation[];
  readonly searchResults: readonly FoldedSearchResult[];
  readonly gaps: readonly CapabilityGapRecord[];
}

// ---------------------------------------------------------------------------
// Typed refusal codes (kebab-case; every door is total)
// ---------------------------------------------------------------------------

/** Refusal codes of the pure admission oracle (structural validation). */
export type LearnRefusalCode =
  | "invalid-tenant"
  | "invalid-owner"
  | "invalid-cycle"
  | "invalid-sequence"
  | "invalid-time"
  | "empty-cycle-fold"
  | "invalid-observation"
  | "observation-not-observed-evidence"
  | "invalid-conclusion"
  | "unknown-observation-reference"
  | "estimate-label-missing"
  | "invalid-evaluation"
  | "evaluation-cycle-mismatch"
  | "cross-tenant"
  | "invalid-search-result"
  | "gap-record-invalid";

/** Refusal codes of the learn door (admission = structural + ordering). */
export type LearnAdmissionCode =
  | LearnRefusalCode
  | "non-monotonic-cycle-order"
  | "conflicting-cycle-content";

/** Refusal codes of tenant-scoped reads. */
export type LearningReadRefusalCode =
  | "cycle-record-unknown"
  | "cross-tenant"
  | "tampered-content-digest";

/** Returns true when `value` is structurally a {@link FoldedEvaluation}. */
export function isFoldedEvaluation(value: unknown): value is FoldedEvaluation {
  if (typeof value !== "object" || value === null) return false;
  const folded = value as Record<string, unknown>;
  return (
    typeof folded.evaluationId === "string" &&
    folded.evaluationId.length > 0 &&
    typeof folded.organization === "string" &&
    typeof folded.method === "string" &&
    folded.method.length > 0 &&
    typeof folded.statistics === "object" &&
    folded.statistics !== null &&
    Array.isArray(folded.metricKinds)
  );
}

/** Returns true when `value` is structurally a {@link LearningCycleRecord}. */
export function isLearningCycleRecord(value: unknown): value is LearningCycleRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.recordId === "string" &&
    record.recordId.startsWith("lab-learn-") &&
    typeof record.identityDigest === "string" &&
    /^[0-9a-f]{64}$/.test(record.identityDigest) &&
    typeof record.tenant === "string" &&
    typeof record.cycleId === "string" &&
    typeof record.sequence === "number" &&
    Number.isSafeInteger(record.sequence) &&
    Array.isArray(record.outcomes) &&
    Array.isArray(record.conclusions) &&
    Array.isArray(record.evaluations) &&
    Array.isArray(record.searchResults) &&
    Array.isArray(record.gaps)
  );
}

/** Parses a learning record slug id (`lab-learn-<52 hex>`, 62 chars). */
export function asLearningRecordId(text: string): string | undefined {
  return /^lab-learn-[0-9a-f]{52}$/.test(text) ? text : undefined;
}
