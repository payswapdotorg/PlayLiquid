/**
 * GUIDANCE READ MODELS (pure) — THE E11 EPISTEMIC SURFACE of the Lab
 * workbench: project lab-learning's search guidance (the learning layer's
 * top-level product) into view models whose two epistemic classes are
 * STRUCTURALLY DISJOINT.
 *
 * The authoritative disjoint union (lab-learning guidance.ts) is
 * consumed, never re-declared:
 * - {@link ObservedGuidanceView} — guidance derived only from observed
 *   evidence. It has NO method, NO basis, NO estimateSupport field.
 * - {@link EstimateGuidanceView} — guidance derived wholly or partly
 *   from labeled estimates. It carries the estimate method, the
 *   content-addressed basis and the per-dimension estimate support.
 *
 * Classification is BY MARKER verified by the AUTHORITATIVE verifier:
 * lab-learning's own `verifySearchGuidanceMarker` is imported and called
 * on every guidance BEFORE it projects (E5 — the check is the domain's
 * authority, never re-implemented here). A stripped, forged or tampered
 * marker breaks the content-addressed digest the verifier recomputes and
 * yields a typed REFUSAL view (E8: tampering is surfaced, never silently
 * accepted), carrying the authoritative refusal code + detail verbatim.
 *
 * Pure module: no IO, no React, no clock.
 */

import { verifySearchGuidanceMarker } from "../../../../lab-learning/src/index.ts";
import type {
  GuidanceRefusalCode,
  LabSearchGuidance,
} from "../../../../lab-learning/src/index.ts";

/** One dimension bounds adjustment row (shared by both epistemic classes). */
export interface GuidanceAdjustmentRowView {
  readonly dimension: string;
  /** The preferred values, ranked (joined "a > b > c"). */
  readonly preferredValues: string;
  readonly observationCount: number;
}

/** Common fields of both guidance view classes (never exported alone). */
interface GuidanceCommonView {
  readonly digest: string;
  readonly derivedFromRecords: number;
  readonly cycleCount: number;
  readonly observationCount: number;
  readonly baselineDirection: string;
  readonly baselineNote: string;
  readonly adjustments: readonly GuidanceAdjustmentRowView[];
  /** The deterministic seed hint for the next search (E9). */
  readonly seedHint: string;
}

/** Guidance derived ONLY from observed evidence (E11 observed class). */
export interface ObservedGuidanceView extends GuidanceCommonView {
  readonly epistemic: "observed-evidence";
}

/** Guidance derived wholly or partly from labeled estimates (E11 estimate class). */
export interface EstimateGuidanceView extends GuidanceCommonView {
  readonly epistemic: "labeled-estimate";
  /** The estimate method of every contributing evaluation run. */
  readonly method: string;
  /** The content-addressed basis of the estimate inputs (provenance). */
  readonly basis: string;
  readonly estimateSupport: readonly {
    readonly dimension: string;
    readonly value: string;
    readonly evaluationCount: number;
    readonly estimatedCompletedWork: number;
  }[];
}

/** A typed guidance refusal: a stripped or forged epistemic marker (E8). */
export interface GuidanceRefusalView {
  readonly epistemic: "refused";
  /** The authoritative lab-learning refusal code, verbatim (never forked). */
  readonly code: GuidanceRefusalCode;
  readonly detail: string;
}

/** The projected guidance set: three buckets, classified by marker. */
export interface GuidanceSetView {
  readonly observed: readonly ObservedGuidanceView[];
  readonly estimates: readonly EstimateGuidanceView[];
  readonly refusals: readonly GuidanceRefusalView[];
}

function adjustmentRows(guidance: LabSearchGuidance): readonly GuidanceAdjustmentRowView[] {
  return guidance.dimensionAdjustments.map((adjustment) => ({
    dimension: adjustment.dimension,
    preferredValues: adjustment.preferredValues.join(" > "),
    observationCount: adjustment.observationIds.length,
  }));
}

function commonView(guidance: LabSearchGuidance): GuidanceCommonView {
  return {
    digest: guidance.digest,
    derivedFromRecords: guidance.derivedFromRecords.length,
    cycleCount: guidance.cycleCount,
    observationCount: guidance.observationCount,
    baselineDirection: guidance.baseline.direction,
    baselineNote: guidance.baseline.note,
    adjustments: adjustmentRows(guidance),
    seedHint: guidance.seedHint,
  };
}

/**
 * Classify ONE guidance value by its marker and project it into the
 * matching view class — or the typed refusal view when the AUTHORITATIVE
 * marker verification fails (a hostile or confused port handing a
 * stripped/forged/tampered guidance object; E8).
 */
export function projectGuidance(
  guidance: LabSearchGuidance,
): ObservedGuidanceView | EstimateGuidanceView | GuidanceRefusalView {
  const verification = verifySearchGuidanceMarker(guidance);
  if (!verification.ok) {
    return {
      epistemic: "refused",
      code: verification.code,
      detail: verification.detail,
    };
  }
  if (guidance.epistemic === "observed-evidence") {
    return { epistemic: "observed-evidence", ...commonView(guidance) };
  }
  return {
    epistemic: "labeled-estimate",
    ...commonView(guidance),
    method: guidance.method,
    basis: guidance.basis,
    estimateSupport: guidance.estimateSupport.map((support) => ({
      dimension: support.dimension,
      value: support.value,
      evaluationCount: support.evaluationCount,
      estimatedCompletedWork: support.estimatedCompletedWork,
    })),
  };
}

/**
 * Project the derived guidance set into the three marker-classified
 * buckets. Deterministic: same input set → same buckets, same order.
 */
export function projectGuidanceSet(
  guidances: readonly LabSearchGuidance[],
): GuidanceSetView {
  const observed: ObservedGuidanceView[] = [];
  const estimates: EstimateGuidanceView[] = [];
  const refusals: GuidanceRefusalView[] = [];
  for (const guidance of guidances) {
    const projected = projectGuidance(guidance);
    if (projected.epistemic === "observed-evidence") observed.push(projected);
    else if (projected.epistemic === "labeled-estimate") estimates.push(projected);
    else refusals.push(projected);
  }
  return { observed, estimates, refusals } satisfies GuidanceSetView;
}

/** Deterministic summary line ("observed N · estimates M · refusals K"). */
export function guidanceSummary(view: GuidanceSetView): string {
  return `${view.observed.length} observed-evidence · ${view.estimates.length} labeled-estimate · ${view.refusals.length} refused`;
}
