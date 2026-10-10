/**
 * THE INTEGRITY RISK POLICY — the typed evaluation seam (PL-018, E9).
 *
 * All interpretation of behavioral observations flows through ONE
 * injectable policy: which statistics are expected under which declared
 * play mode, how wide the honest confidence intervals are, and which
 * aggregate risk ranges map to which frozen verdict kind. The policy is
 * pure data; the evaluator (signals.ts / verdicts.ts) is a pure function
 * of (observations, policy). Same evidence + same policy → same verdict,
 * forever (E9). A different policy is a DIFFERENT evaluation context: it
 * mints NEW report/verdict versions and never edits history (E10).
 *
 * Per-mode calibration is how "explicit AI-player modes" are first-class
 * (architecture "Competitive Integrity"): a declared AI-assisted session
 * is evaluated against the expectations of THAT mode — the declaration is
 * evidence that shapes evaluation, never a bypass past it. A claimed-human
 * session with machine-regular timing and a declared-AI session with
 * human-irregular timing BOTH surface as deviation-observed; only the
 * expected profile differs.
 *
 * E11 discipline baked into the shape: `maxSignalContribution` is capped
 * strictly below 1 (no signal may state certainty), `matchOutcomeRisk`
 * bounds how much a clean re-execution lowers risk, and verdict
 * thresholds are explicit numbers, never magic.
 *
 * Purity: types + one frozen default + one pure validator. No IO.
 */

import type { AiPlayMode } from "@playliquid/platform-contracts";

/** Confidence levels the Wilson interval z-table is frozen for. */
export type PolicyConfidenceLevel = 0.9 | 0.95;

/**
 * One mode's expected behavioral profile. `expected*` values are the
 * statistic EXPECTED under the declared mode; `*Tolerance` is the
 * deviation denominator — a statistic at the expectation contributes 0
 * risk, one full tolerance away contributes the policy's
 * `maxSignalContribution`.
 */
export interface ModeCalibration {
  /** Expected coefficient of variation of issued-at gaps. */
  readonly expectedGapCv: number;
  readonly gapCvTolerance: number;
  /** Expected share of gaps equal to the modal gap. */
  readonly expectedModalGapShare: number;
  readonly modalGapTolerance: number;
  /** Expected share of the dominant consecutive command-kind pair. */
  readonly expectedDominantBigramShare: number;
  readonly bigramTolerance: number;
  /** Expected share of distinct command kinds in the trace. */
  readonly expectedDistinctKindShare: number;
  readonly distinctKindTolerance: number;
  /** Expected share of broker-mediated avatar origins. */
  readonly expectedBrokerShare: number;
  readonly brokerTolerance: number;
}

/** Verdict classification thresholds (all in [0, 1]). */
export interface VerdictThresholds {
  /** Aggregate interval width at or above this → `inconclusive`. */
  readonly inconclusiveIntervalWidth: number;
  /** Aggregate riskScore at or above this → `deviation-observed`. */
  readonly deviationRiskFloor: number;
  /** Aggregate riskScore at or above this → pronounced deviation. */
  readonly pronouncedRiskFloor: number;
  /** Aggregate lowerBound at or above this (with the risk floor) → pronounced. */
  readonly pronouncedLowerBoundFloor: number;
}

/** The complete evaluation policy. */
export interface IntegrityRiskPolicy {
  /** Canonical slug identifying this policy (E9/E10: pins evaluations). */
  readonly policyId: string;
  readonly confidenceLevel: PolicyConfidenceLevel;
  /** Minimum command count admitted for evaluation (below → refusal). */
  readonly minTraceCommands: number;
  /** Relative signal weights (aggregation input, all > 0). */
  readonly signalWeights: {
    readonly timing: number;
    readonly trajectory: number;
    readonly outcome: number;
  };
  /** Hard cap of any single signal's risk contribution (E11: < 1). */
  readonly maxSignalContribution: number;
  /** Risk contribution of a clean re-execution match. */
  readonly matchOutcomeRisk: number;
  readonly verdictThresholds: VerdictThresholds;
  /** Calibration per declared play mode (all three, frozen vocabulary). */
  readonly modeCalibration: Readonly<Record<AiPlayMode, ModeCalibration>>;
}

const ID_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// ---------------------------------------------------------------------------
// The frozen default
// ---------------------------------------------------------------------------

/**
 * The platform default risk policy. Deliberately conservative: human
 * profiles expect irregular timing and varied command paths; autonomous
 * AI profiles expect machine-regular timing and repetitive paths; the
 * tolerances are wide enough that ordinary honest play under the matching
 * declaration stays `consistent-with-declared-mode`, while machine-regular
 * play claimed as human and human-irregular play declared as autonomous
 * both surface as deviations.
 *
 * The band asymmetry is deliberate and recorded: UNDECLARED automation
 * (machine-regular play under a human claim — the primary competitive-
 * integrity threat) saturates toward `pronounced-deviation-observed` under
 * the TIGHT human calibration, while the reverse mismatch (human-irregular
 * play under an AI declaration — a declaration/behavior mismatch, not
 * undeclared automation) surfaces mid-band as `deviation-observed` under
 * the wider autonomous calibration. Both directions stay visible; neither
 * is a bypass.
 */
export const DEFAULT_INTEGRITY_RISK_POLICY: IntegrityRiskPolicy = Object.freeze({
  policyId: "integrity-risk-default-v1",
  confidenceLevel: 0.9,
  minTraceCommands: 8,
  signalWeights: Object.freeze({ timing: 1, trajectory: 1, outcome: 1.25 }),
  maxSignalContribution: 0.9,
  matchOutcomeRisk: 0.1,
  verdictThresholds: Object.freeze({
    inconclusiveIntervalWidth: 0.9,
    deviationRiskFloor: 0.4,
    pronouncedRiskFloor: 0.7,
    pronouncedLowerBoundFloor: 0.5,
  }),
  modeCalibration: Object.freeze({
    human: Object.freeze({
      expectedGapCv: 0.6,
      gapCvTolerance: 0.9,
      expectedModalGapShare: 0.3,
      modalGapTolerance: 0.6,
      expectedDominantBigramShare: 0.45,
      bigramTolerance: 0.6,
      expectedDistinctKindShare: 0.5,
      distinctKindTolerance: 0.8,
      expectedBrokerShare: 0.2,
      brokerTolerance: 0.8,
    }),
    "ai-assisted": Object.freeze({
      expectedGapCv: 0.6,
      gapCvTolerance: 0.9,
      expectedModalGapShare: 0.4,
      modalGapTolerance: 0.7,
      expectedDominantBigramShare: 0.5,
      bigramTolerance: 0.6,
      expectedDistinctKindShare: 0.5,
      distinctKindTolerance: 0.8,
      expectedBrokerShare: 0.5,
      brokerTolerance: 0.7,
    }),
    "ai-autonomous": Object.freeze({
      expectedGapCv: 0.2,
      gapCvTolerance: 1.0,
      expectedModalGapShare: 0.7,
      modalGapTolerance: 0.9,
      expectedDominantBigramShare: 0.7,
      bigramTolerance: 0.9,
      expectedDistinctKindShare: 0.4,
      distinctKindTolerance: 0.8,
      expectedBrokerShare: 0.7,
      brokerTolerance: 0.9,
    }),
  }),
}) as IntegrityRiskPolicy;

// ---------------------------------------------------------------------------
// Validation (pure; E8 negative coverage)
// ---------------------------------------------------------------------------

/** Result of {@link validateIntegrityRiskPolicy}. */
export type PolicyValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: PolicyRefusalCode; readonly detail: string };

/** Typed refusal codes a policy may fail validation with. */
export type PolicyRefusalCode =
  | "policy-id-malformed"
  | "policy-level-unsupported"
  | "policy-min-trace-invalid"
  | "policy-weights-invalid"
  | "policy-contribution-cap-invalid"
  | "policy-match-risk-invalid"
  | "policy-thresholds-invalid"
  | "policy-calibration-invalid"
  | "policy-modes-incomplete";

function inUnitRange(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isCalibrationShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const calibration = value as Record<string, unknown>;
  const expectedKeys = [
    "expectedGapCv",
    "gapCvTolerance",
    "expectedModalGapShare",
    "modalGapTolerance",
    "expectedDominantBigramShare",
    "bigramTolerance",
    "expectedDistinctKindShare",
    "distinctKindTolerance",
    "expectedBrokerShare",
    "brokerTolerance",
  ];
  for (const key of expectedKeys) {
    const metric = calibration[key];
    if (!inUnitRange(metric)) return false;
  }
  return true;
}

/**
 * Pure policy validator. A policy that fails any invariant is refused
 * with a typed code — the evaluator never runs on an unvalidated policy
 * (fail closed, E8).
 */
export function validateIntegrityRiskPolicy(value: unknown): PolicyValidation {
  if (typeof value !== "object" || value === null) {
    return { ok: false, code: "policy-calibration-invalid", detail: "policy must be an object" };
  }
  const policy = value as Record<string, unknown>;
  if (typeof policy.policyId !== "string" || !ID_SLUG_PATTERN.test(policy.policyId)) {
    return { ok: false, code: "policy-id-malformed", detail: "policyId must be a canonical slug" };
  }
  if (policy.confidenceLevel !== 0.9 && policy.confidenceLevel !== 0.95) {
    return {
      ok: false,
      code: "policy-level-unsupported",
      detail: "confidenceLevel must be 0.9 or 0.95 (frozen Wilson z-table)",
    };
  }
  if (
    typeof policy.minTraceCommands !== "number" ||
    !Number.isInteger(policy.minTraceCommands) ||
    policy.minTraceCommands < 2
  ) {
    return {
      ok: false,
      code: "policy-min-trace-invalid",
      detail: "minTraceCommands must be an integer >= 2",
    };
  }
  const weights = policy.signalWeights as Record<string, unknown> | undefined;
  if (
    typeof weights !== "object" ||
    weights === null ||
    !["timing", "trajectory", "outcome"].every(
      (key) =>
        typeof weights[key] === "number" &&
        Number.isFinite(weights[key] as number) &&
        (weights[key] as number) > 0 &&
        (weights[key] as number) <= 10,
    )
  ) {
    return { ok: false, code: "policy-weights-invalid", detail: "signal weights must be > 0" };
  }
  if (
    typeof policy.maxSignalContribution !== "number" ||
    !Number.isFinite(policy.maxSignalContribution) ||
    policy.maxSignalContribution < 0.5 ||
    policy.maxSignalContribution >= 1
  ) {
    return {
      ok: false,
      code: "policy-contribution-cap-invalid",
      detail: "maxSignalContribution must be in [0.5, 1) — certainty is unrepresentable (E11)",
    };
  }
  if (
    typeof policy.matchOutcomeRisk !== "number" ||
    !Number.isFinite(policy.matchOutcomeRisk) ||
    policy.matchOutcomeRisk < 0 ||
    policy.matchOutcomeRisk > policy.maxSignalContribution
  ) {
    return {
      ok: false,
      code: "policy-match-risk-invalid",
      detail: "matchOutcomeRisk must be in [0, maxSignalContribution]",
    };
  }
  const thresholds = policy.verdictThresholds as Record<string, unknown> | undefined;
  if (
    typeof thresholds !== "object" ||
    thresholds === null ||
    !inUnitRange(thresholds.inconclusiveIntervalWidth) ||
    (thresholds.inconclusiveIntervalWidth as number) <= 0 ||
    !inUnitRange(thresholds.deviationRiskFloor) ||
    (thresholds.deviationRiskFloor as number) <= 0 ||
    !inUnitRange(thresholds.pronouncedRiskFloor) ||
    !inUnitRange(thresholds.pronouncedLowerBoundFloor) ||
    (thresholds.pronouncedRiskFloor as number) < (thresholds.deviationRiskFloor as number)
  ) {
    return {
      ok: false,
      code: "policy-thresholds-invalid",
      detail: "verdict thresholds malformed or pronounced floor below deviation floor",
    };
  }
  const calibration = policy.modeCalibration as Record<string, unknown> | undefined;
  if (typeof calibration !== "object" || calibration === null) {
    return { ok: false, code: "policy-calibration-invalid", detail: "modeCalibration missing" };
  }
  for (const mode of ["human", "ai-assisted", "ai-autonomous"] as const) {
    if (!isCalibrationShaped(calibration[mode])) {
      return {
        ok: false,
        code: "policy-modes-incomplete",
        detail: `modeCalibration.${mode} missing or malformed`,
      };
    }
  }
  return { ok: true };
}
