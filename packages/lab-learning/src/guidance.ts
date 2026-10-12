/**
 * SEARCH GUIDANCE (PL-030) — the top-level product of the learning layer:
 * a TYPED guidance object that parameterizes lab-organization's next search
 * request (dimension bounds adjustments, ordering hints, baseline promotion
 * notes and a deterministic seed hint), derived ONLY from the learning
 * state (spec/architecture.md §Lab loop: "calibration → next search").
 *
 * EPISTEMIC DISCIPLINE IS STRUCTURAL (E11, lock rules 28/29):
 *
 * - guidance derived ONLY from observed evidence carries the
 *   `observed-evidence` marker (the lab-contracts estimate vocabulary,
 *   consumed — never re-declared);
 * - guidance derived WHOLLY OR PARTLY from simulator/counterfactual
 *   estimates (the folded evaluation runs) carries the `labeled-estimate`
 *   marker plus its estimate method and a content-addressed basis;
 * - the two guidance classes are STRUCTURALLY DISJOINT (disjoint marker
 *   literals; the estimate-support field exists only on the estimate
 *   class) — proven by `@ts-expect-error` type-misuse tests;
 * - a STRIPPED or FORGED marker is a typed refusal, never silently
 *   accepted: {@link verifySearchGuidanceMarker} recomputes the
 *   content-addressed guidance digest from the object's own fields and
 *   checks marker/method/basis coherence — any tamper breaks the digest.
 *
 * The derivation's mode states what the caller WANTS; the MARKER states
 * what the derivation ACTUALLY used: `with-estimates` over a state with
 * no folded evaluations still yields honest observed-evidence guidance.
 *
 * Pure module: no IO, no clocks, no randomness (E9: the seed hint is a
 * deterministic function of the guidance digest).
 */

import type { ContentDigest, EstimateMethod } from "@playliquid/lab-contracts";
import { asEvaluationSeed, isEstimateMethod, isValidContentDigest } from "@playliquid/lab-contracts";
import type { TenantId } from "@playliquid/platform-contracts";
import type { LearningCycleRecord } from "./records.ts";
import type { LabDimension } from "./signals.ts";
import { blueprintDimensions } from "./signals.ts";
import { guidanceBasisDigestOf, guidanceDigestOf } from "./digest.ts";

/** What the derivation may consume (the marker always tells the truth). */
export type GuidanceDerivationMode = "observed-only" | "with-estimates";

/** Returns true when `value` is a valid {@link GuidanceDerivationMode}. */
export function isGuidanceDerivationMode(value: unknown): value is GuidanceDerivationMode {
  return value === "observed-only" || value === "with-estimates";
}

/** The baseline promotion note (lock 26 — the generalist is always candidate zero). */
export interface BaselinePromotionNote {
  readonly direction: "insufficient-evidence" | "promote-baseline" | "explore-beyond-baseline";
  readonly note: string;
  /** Sorted unique record ids backing the note. */
  readonly evidence: readonly string[];
}

/** One dimension bounds adjustment for the next search request. */
export interface DimensionBoundsAdjustment {
  readonly dimension: LabDimension;
  /**
   * Ordering hints: the dimension's values ranked for the next search —
   * observed affinity count desc (estimate mode adds estimated completed
   * work desc), ties by value asc. Content-derived, deterministic.
   */
  readonly preferredValues: readonly string[];
  /** Sorted unique observation ids backing the ranking. */
  readonly observationIds: readonly string[];
  /** Sorted unique record ids backing the ranking. */
  readonly recordIds: readonly string[];
}

/** One estimate-backed dimension support entry (labeled-estimate class only). */
export interface EstimateDimensionSupport {
  readonly dimension: LabDimension;
  readonly value: string;
  readonly evaluationCount: number;
  /** Total estimated completed work of evaluations of candidates carrying this value. */
  readonly estimatedCompletedWork: number;
}

/** The shared guidance content (both epistemic classes). */
interface LabSearchGuidanceCommon {
  readonly tenant: TenantId;
  /** The record ids the guidance derives from (fold order). */
  readonly derivedFromRecords: readonly string[];
  readonly cycleCount: number;
  readonly observationCount: number;
  readonly baseline: BaselinePromotionNote;
  /** Dimension bounds adjustments (empty in the empty state). */
  readonly dimensionAdjustments: readonly DimensionBoundsAdjustment[];
  /** A deterministic seed hint for the next search (E9; digest-derived). */
  readonly seedHint: string;
  /** Content-addressed identity over the guidance content EXCLUDING the seed hint. */
  readonly digest: ContentDigest;
}

/** Guidance derived ONLY from observed evidence (E11 observed class). */
export interface ObservedEvidenceGuidance extends LabSearchGuidanceCommon {
  readonly epistemic: "observed-evidence";
}

/** Guidance derived wholly or partly from labeled estimates (E11 estimate class). */
export interface LabeledEstimateGuidance extends LabSearchGuidanceCommon {
  readonly epistemic: "labeled-estimate";
  /** The estimate method of every contributing evaluation run. */
  readonly method: EstimateMethod;
  /** The content-addressed basis of the estimate inputs (provenance). */
  readonly basis: ContentDigest;
  readonly estimateSupport: readonly EstimateDimensionSupport[];
}

/** Any search guidance (the disjoint E11 union). */
export type LabSearchGuidance = ObservedEvidenceGuidance | LabeledEstimateGuidance;

/** Refusal codes of guidance derivation and marker verification. */
export type GuidanceRefusalCode = "invalid-mode" | "estimate-method-mixed" | "guidance-marker-forged";

/** Result of {@link deriveSearchGuidance}. */
export type GuidanceDerivationResult =
  | { readonly ok: true; readonly guidance: LabSearchGuidance }
  | { readonly ok: false; readonly code: GuidanceRefusalCode; readonly detail: string };

/** Result of {@link verifySearchGuidanceMarker}. */
export type GuidanceVerificationResult =
  | { readonly ok: true; readonly matches: boolean }
  | { readonly ok: false; readonly code: GuidanceRefusalCode; readonly detail: string };

/** One accumulated per-dimension-value affinity (the derivation's working set). */
interface GuidanceAffinity {
  readonly dimension: LabDimension;
  readonly value: string;
  count: number;
  readonly observations: Set<string>;
  readonly records: Set<string>;
}

/**
 * Derives the next-search guidance from one tenant's accumulated learning
 * records. PURE and total: the empty state yields the typed baseline
 * guidance (dimensionAdjustments: [], direction "insufficient-evidence"),
 * never an exception. The epistemic marker ALWAYS reflects the inputs the
 * derivation actually consumed.
 */
export function deriveSearchGuidance(input: {
  readonly records: readonly LearningCycleRecord[];
  readonly tenant: TenantId;
  readonly mode: GuidanceDerivationMode;
}): GuidanceDerivationResult {
  if (!isGuidanceDerivationMode(input.mode)) {
    return { ok: false, code: "invalid-mode", detail: "mode must be observed-only or with-estimates" };
  }
  const ordered = [...input.records].sort((a, b) => a.sequence - b.sequence || a.recordId.localeCompare(b.recordId));
  const hasEstimates = ordered.some((record) => record.evaluations.length > 0);
  const useEstimates = input.mode === "with-estimates" && hasEstimates;

  let estimateSupport: readonly EstimateDimensionSupport[] = [];
  if (useEstimates) {
    const derived = deriveEstimateSupport(ordered);
    if (typeof derived === "string") {
      return {
        ok: false,
        code: "estimate-method-mixed",
        detail: `guidance estimate inputs mix methods (${derived}) — an incoherent estimate basis is refused (E11)`,
      };
    }
    estimateSupport = derived;
  }
  const methods = new Set<string>(ordered.flatMap((record) => record.evaluations.map((evaluation) => evaluation.method)));
  const basis = guidanceBasisDigestOf(ordered.flatMap((record) => [...record.evaluations]));

  const affinities = new Map<string, GuidanceAffinity>();
  for (const record of ordered) {
    for (const result of record.searchResults) {
      if (result.blueprint === undefined) continue;
      for (const { dimension, value } of blueprintDimensions(result.blueprint)) {
        for (const outcome of record.outcomes) {
          const key = `${dimension}\u0000${value}`;
          let affinity = affinities.get(key);
          if (affinity === undefined) {
            affinity = { dimension, value, count: 0, observations: new Set(), records: new Set() };
            affinities.set(key, affinity);
          }
          affinity.count += 1;
          affinity.records.add(record.recordId);
          affinity.observations.add(outcome.observationId);
        }
      }
    }
  }

  const supportOf = (dimension: LabDimension, value: string): number =>
    estimateSupport.find((support) => support.dimension === dimension && support.value === value)?.estimatedCompletedWork ?? 0;
  const byDimension = new Map<LabDimension, GuidanceAffinity[]>();
  for (const affinity of affinities.values()) {
    const list = byDimension.get(affinity.dimension) ?? [];
    list.push(affinity);
    byDimension.set(affinity.dimension, list);
  }
  const dimensionAdjustments: DimensionBoundsAdjustment[] = [...byDimension.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dimension, list]) => ({
      dimension,
      preferredValues: [...list]
        .sort((a, b) => b.count - a.count || supportOf(b.dimension, b.value) - supportOf(a.dimension, a.value) || a.value.localeCompare(b.value))
        .map((affinity) => affinity.value),
      observationIds: [...new Set(list.flatMap((affinity) => [...affinity.observations]))].sort(),
      recordIds: [...new Set(list.flatMap((affinity) => [...affinity.records]))].sort(),
    }));

  const observationCount = new Set(ordered.flatMap((record) => record.outcomes.map((outcome) => outcome.observationId))).size;
  const common = {
    tenant: input.tenant,
    derivedFromRecords: ordered.map((record) => record.recordId),
    cycleCount: ordered.length,
    observationCount,
    baseline: baselineNoteOf(ordered),
    dimensionAdjustments: Object.freeze(dimensionAdjustments),
  };
  if (!useEstimates) {
    const digest = guidanceDigestOf({ ...common, epistemic: "observed-evidence" });
    return { ok: true, guidance: { ...common, epistemic: "observed-evidence", seedHint: seedHintOf(digest), digest } };
  }
  const method = [...methods][0] as EstimateMethod;
  const digest = guidanceDigestOf({ ...common, epistemic: "labeled-estimate", method, basis, estimateSupport });
  return {
    ok: true,
    guidance: {
      ...common,
      epistemic: "labeled-estimate",
      method,
      basis,
      estimateSupport: Object.freeze(estimateSupport),
      seedHint: seedHintOf(digest),
      digest,
    },
  };
}

/**
 * Verifies a guidance object's E11 marker honesty: the recomputed
 * content-addressed digest over the object's own fields (excluding the
 * derived seed hint) must equal the carried digest, and the marker must be
 * coherent (observed guidance carries no method/basis/support;
 * labeled-estimate guidance carries a valid method and digest). A
 * stripped or forged marker changes the content and breaks the digest —
 * a typed refusal, never a silent accept.
 */
export function verifySearchGuidanceMarker(value: unknown): GuidanceVerificationResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, code: "guidance-marker-forged", detail: "guidance is not an object" };
  }
  const guidance = value as Record<string, unknown>;
  const marker = guidance.epistemic;
  if (marker !== "observed-evidence" && marker !== "labeled-estimate") {
    return { ok: false, code: "guidance-marker-forged", detail: `unknown epistemic marker ${String(marker)}` };
  }
  if (marker === "labeled-estimate") {
    if (!isEstimateMethod(guidance.method)) {
      return { ok: false, code: "guidance-marker-forged", detail: "labeled-estimate guidance carries no valid estimate method" };
    }
    if (typeof guidance.basis !== "string" || !isValidContentDigest(guidance.basis)) {
      return { ok: false, code: "guidance-marker-forged", detail: "labeled-estimate guidance carries no valid estimate basis" };
    }
  } else if (guidance.method !== undefined || guidance.basis !== undefined || guidance.estimateSupport !== undefined) {
    return { ok: false, code: "guidance-marker-forged", detail: "observed-evidence guidance must not carry estimate fields" };
  }
  const { seedHint: _seedHint, digest: _digest, ...content } = guidance;
  const recomputed = guidanceDigestOf(content);
  const carried = guidance.digest;
  if (typeof carried !== "string" || !isValidContentDigest(carried) || String(recomputed) !== carried) {
    return {
      ok: false,
      code: "guidance-marker-forged",
      detail: "the guidance content digest does not match its fields — the marker was stripped, forged or the object tampered (E11)",
    };
  }
  if (typeof guidance.seedHint !== "string" || asEvaluationSeed(guidance.seedHint) === undefined) {
    return { ok: false, code: "guidance-marker-forged", detail: "the seed hint is not valid evaluation seed text" };
  }
  return { ok: true, matches: true };
}

/** Structural guard for the observed-evidence guidance class. */
export function asObservedEvidenceGuidance(value: unknown): ObservedEvidenceGuidance | undefined {
  const verification = verifySearchGuidanceMarker(value);
  return verification.ok && (value as { epistemic: string }).epistemic === "observed-evidence"
    ? (value as ObservedEvidenceGuidance)
    : undefined;
}

/** Structural guard for the labeled-estimate guidance class. */
export function asLabeledEstimateGuidance(value: unknown): LabeledEstimateGuidance | undefined {
  const verification = verifySearchGuidanceMarker(value);
  return verification.ok && (value as { epistemic: string }).epistemic === "labeled-estimate"
    ? (value as LabeledEstimateGuidance)
    : undefined;
}

/** Derives the estimate-backed support per dimension value (or the mixed-method detail). */
function deriveEstimateSupport(records: readonly LearningCycleRecord[]): readonly EstimateDimensionSupport[] | string {
  const support = new Map<string, { dimension: LabDimension; value: string; evaluationCount: number; work: number }>();
  const methods = new Set<string>();
  for (const record of records) {
    for (const evaluation of record.evaluations) {
      methods.add(evaluation.method);
      for (const result of record.searchResults) {
        if (result.blueprint === undefined || result.organization !== evaluation.organization) continue;
        for (const { dimension, value } of blueprintDimensions(result.blueprint)) {
          const key = `${dimension}\u0000${value}`;
          let entry = support.get(key);
          if (entry === undefined) {
            entry = { dimension, value, evaluationCount: 0, work: 0 };
            support.set(key, entry);
          }
          entry.evaluationCount += 1;
          entry.work += evaluation.statistics.completedWork;
        }
      }
    }
  }
  if (methods.size > 1) return [...methods].sort().join(", ");
  return [...support.values()]
    .sort((a, b) => a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value))
    .map(({ dimension, value, evaluationCount, work }) => ({ dimension, value, evaluationCount, estimatedCompletedWork: work }));
}

/** The baseline promotion note of the accumulated records (lock 26). */
function baselineNoteOf(records: readonly LearningCycleRecord[]): BaselinePromotionNote {
  if (records.every((record) => record.outcomes.length === 0)) {
    return {
      direction: "insufficient-evidence",
      note: "no observed outcomes recorded yet — the generalist baseline (lock 26) remains the always-available candidate",
      evidence: [],
    };
  }
  let baselineCo = 0;
  let otherCo = 0;
  for (const record of records) {
    for (const result of record.searchResults) {
      if (result.isBaseline) baselineCo += record.outcomes.length;
      else if (result.blueprint !== undefined) otherCo += record.outcomes.length;
    }
  }
  if (baselineCo > 0 && baselineCo >= otherCo) {
    return {
      direction: "promote-baseline",
      note: `the generalist baseline co-occurred with ${baselineCo} observed outcome(s) — at least as many as non-baseline candidates (${otherCo})`,
      evidence: records.filter((record) => record.searchResults.some((result) => result.isBaseline)).map((record) => record.recordId),
    };
  }
  return {
    direction: "explore-beyond-baseline",
    note: `non-baseline candidates co-occurred with ${otherCo} observed outcome(s) vs the baseline's ${baselineCo} — the next search should explore beyond the baseline`,
    evidence: records.filter((record) => record.outcomes.length > 0).map((record) => record.recordId),
  };
}

/** The deterministic seed hint of one guidance digest (E9). */
function seedHintOf(digest: ContentDigest): string {
  const hint = `lab-seed-${digest.slice(0, 40)}`;
  const parsed = asEvaluationSeed(hint);
  if (parsed === undefined) {
    // Canonical prefix + hex slice — unreachable by construction.
    throw new Error(`lab-learning: derived seed hint failed to parse: ${hint}`);
  }
  return hint;
}
