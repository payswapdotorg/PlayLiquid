/**
 * CONTENT-ADDRESSED IDENTITY HELPERS (PL-030).
 *
 * Digest discipline (one authority per concern — the lab-simulation /
 * lab-organization precedent): the SERIALIZATION authority is
 * package-system's `canonicalJson`; this package hashes at its own seam
 * with node:crypto SHA-256. lab-contracts `ContentDigest` is the 64-hex
 * form; the learning record SLUG id is the first 52 hex characters of the
 * identity digest prefixed `lab-learn-` (62 chars — inside the
 * game-contracts 63-char id-text pattern).
 *
 * The identity digest covers the FOLDED CONTENT only — tenant, cycle id,
 * sequence, outcomes, conclusions, evaluations, search results and gaps.
 * `owner` and `learnedAt` are deliberately EXCLUDED: they are bookkeeping,
 * not cycle content (a different owner of the same tenant re-submitting
 * identical content gets the E10 duplicate receipt — the lab-simulation
 * identity discipline).
 *
 * The same content builder ({@link learningContentOf}) serves BOTH the
 * intake derivation and the tamper verification (E8): a record whose
 * stored identityDigest no longer equals the digest recomputed from its
 * own folded fields is tampered and refused everywhere it is read.
 *
 * Pure module: deterministic functions of their inputs; no IO beyond the
 * hash computation itself (same standing as lab-simulation/src/digest.ts).
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "@playliquid/package-system";
import type { CalibrationConclusion, CapabilityGapRecord, ContentDigest } from "@playliquid/lab-contracts";
import { asContentDigest } from "@playliquid/lab-contracts";
import type { FoldedEvaluation, FoldedOutcome, FoldedSearchResult, LearningCycleRecord } from "./records.ts";

/** Domain-separation tag for learning-cycle identities. */
const IDENTITY_TAG = "playliquid:lab-learning:cycle:1";

/** Domain-separation tag for learning-state signal digests. */
const SIGNALS_TAG = "playliquid:lab-learning:signals:1";

/** Domain-separation tag for guidance identities. */
const GUIDANCE_TAG = "playliquid:lab-learning:guidance:1";

/** Domain-separation tag for guidance estimate bases. */
const BASIS_TAG = "playliquid:lab-learning:guidance-basis:1";

/** The folded content that determines a learning-cycle identity. */
export interface LearningIdentityContent {
  readonly tenant: string;
  readonly cycleId: string;
  readonly sequence: number;
  readonly outcomes: readonly FoldedOutcome[];
  readonly conclusions: readonly CalibrationConclusion[];
  readonly evaluations: readonly FoldedEvaluation[];
  readonly searchResults: readonly FoldedSearchResult[];
  readonly gaps: readonly CapabilityGapRecord[];
}

/**
 * Recursively strips `undefined`-valued keys (package-system canonicalJson
 * REJECTS undefined values — the lab-simulation discipline). Deterministic
 * on every path: optional keys appear only when present.
 */
export function jsonSafeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => jsonSafeOf(item));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) continue;
    out[key] = jsonSafeOf(nested);
  }
  return out;
}

/** sha256 hex (64 chars) over the canonical JSON of `value`. */
export function learningDigestOf(value: unknown): ContentDigest {
  const form = canonicalJson(jsonSafeOf(value));
  const hex = createHash("sha256").update(form, "utf8").digest("hex");
  return asContentDigest(hex)!;
}

/** The identity digest of one folded learning-cycle content (E10 key). */
export function learningIdentityDigestOf(content: LearningIdentityContent): ContentDigest {
  return learningDigestOf({ tag: IDENTITY_TAG, ...content });
}

/** The learning record slug id (`lab-learn-<52 hex>`, 62 chars). */
export function learningRecordIdOf(digest: ContentDigest): string {
  return `lab-learn-${digest.slice(0, 52)}`;
}

/**
 * Rebuilds the identity content view of a SEALED record (tamper
 * verification and re-derivation use exactly the intake's content shape).
 */
export function learningContentOf(record: LearningCycleRecord): LearningIdentityContent {
  return {
    tenant: String(record.tenant),
    cycleId: String(record.cycleId),
    sequence: record.sequence,
    outcomes: [...record.outcomes],
    conclusions: [...record.conclusions],
    evaluations: [...record.evaluations],
    searchResults: [...record.searchResults],
    gaps: [...record.gaps],
  };
}

/**
 * The E10/E8 tamper oracle: a learning record is authentic iff its stored
 * identityDigest equals the digest recomputed from its own folded fields.
 * Pure; never throws.
 */
export function verifyLearningRecord(record: LearningCycleRecord): boolean {
  const recomputed = learningIdentityDigestOf(learningContentOf(record));
  return String(recomputed) === String(record.identityDigest);
}

/** The state digest of one derived signals view (determinism proof, E9). */
export function signalsStateDigestOf(signals: unknown): ContentDigest {
  return learningDigestOf({ tag: SIGNALS_TAG, signals });
}

/** The content digest of a guidance view, EXCLUDING the derived seed hint. */
export function guidanceDigestOf(guidanceContent: unknown): ContentDigest {
  return learningDigestOf({ tag: GUIDANCE_TAG, guidance: guidanceContent });
}

/** The estimate-basis digest of one guidance derivation (E11 provenance). */
export function guidanceBasisDigestOf(estimateInputs: readonly unknown[]): ContentDigest {
  return learningDigestOf({ tag: BASIS_TAG, inputs: estimateInputs });
}
