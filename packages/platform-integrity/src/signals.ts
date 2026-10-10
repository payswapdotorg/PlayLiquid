/**
 * SIGNAL EVALUATION — the deterministic heuristic layer (PL-018, R11/E9).
 *
 * Turns typed observations into contract {@link IntegritySignal}s under a
 * policy. Every signal is a bounded estimate with an EXPLICIT confidence
 * interval — never a certainty claim:
 *
 * - the risk POINT is a normalized deviation from the declared mode's
 *   expected profile, scaled by the policy's `maxSignalContribution`
 *   (strictly < 1: no signal may state certainty, E11);
 * - the CONFIDENCE interval is the point plus/minus a conservative
 *   proportion-sampling margin that shrinks as the trace grows
 *   (z * sqrt(0.25 / n) — the maximum-variance margin for an estimated
 *   proportion; deterministic arithmetic, no randomness);
 * - the OUTCOME signal comes from the replay re-execution comparison:
 *   divergence is deterministically proven (interval collapses to the
 *   point at level 1), a match is bounded by the unverified fraction
 *   (interval widens as coverage drops), and an inconclusive comparison
 *   contributes NO signal (honest absence, never a guessed value).
 *
 * Same observations + same policy → byte-identical signals, forever (E9).
 * Aggregation is the FROZEN platform-contracts oracle
 * (aggregateIntegritySignals) — this module never re-implements it.
 *
 * Purity: no IO, no clocks, no randomness.
 */

import type {
  AiPlayMode,
  ConfidenceInterval,
  IntegrityEvidenceRef,
  IntegritySignal,
  IntegritySignalKind,
} from "@playliquid/platform-contracts";
import type {
  ModeCalibration,
  PolicyConfidenceLevel,
  IntegrityRiskPolicy,
} from "./policy.ts";
import type {
  OutcomeObservations,
  TimingObservations,
  TrajectoryObservations,
} from "./observations.ts";

/** Frozen Wilson z values for the supported confidence levels. */
const WILSON_Z: Readonly<Record<PolicyConfidenceLevel, number>> = Object.freeze({
  0.9: 1.6448536269514722,
  0.95: 1.959963984540054,
});

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function clip01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Conservative sampling margin of an estimated proportion from
 * `sampleCount` observations at `level` (maximum-variance form). This is
 * the honest widening of every behavioral interval: small traces cannot
 * look precise. Deterministic arithmetic only.
 */
function proportionMargin(sampleCount: number, level: PolicyConfidenceLevel): number {
  const z = WILSON_Z[level];
  const n = Math.max(1, sampleCount);
  return round6(z * Math.sqrt(0.25 / n));
}

/** Interval around `point` with the conservative margin, clipped to [0, 1]. */
function estimateInterval(
  point: number,
  sampleCount: number,
  level: PolicyConfidenceLevel,
): ConfidenceInterval {
  const margin = proportionMargin(sampleCount, level);
  return {
    level,
    lowerBound: round6(Math.max(0, point - margin)),
    upperBound: round6(Math.min(1, point + margin)),
  };
}

/** Normalized deviation of `observed` from `expected` (1 at one tolerance). */
function normalizedDeviation(observed: number, expected: number, tolerance: number): number {
  if (tolerance <= 0) return 1;
  return clip01(Math.abs(observed - expected) / tolerance);
}

// ---------------------------------------------------------------------------
// Timing signal
// ---------------------------------------------------------------------------

/**
 * The timing signal: how far the trace's issue-time regularity deviates
 * from the declared mode's expected profile. Machine-regular input under
 * a human claim and human-irregular input under an autonomous-AI claim
 * both push this toward the policy cap.
 */
export function evaluateTimingSignal(
  observations: TimingObservations,
  calibration: ModeCalibration,
  policy: IntegrityRiskPolicy,
  evidence: readonly IntegrityEvidenceRef[],
): IntegritySignal {
  const gapDeviation = normalizedDeviation(observations.gapCv, calibration.expectedGapCv, calibration.gapCvTolerance);
  const modalDeviation = normalizedDeviation(
    observations.modalGapShare,
    calibration.expectedModalGapShare,
    calibration.modalGapTolerance,
  );
  const point = round6(Math.max(gapDeviation, modalDeviation) * policy.maxSignalContribution);
  return {
    kind: "timing",
    weight: policy.signalWeights.timing,
    riskContribution: point,
    confidence: estimateInterval(point, observations.gapCount, policy.confidenceLevel),
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Trajectory signal
// ---------------------------------------------------------------------------

/**
 * The trajectory signal: how far the command-path shape (vocabulary
 * variety, repetition structure, provenance composition) deviates from
 * the declared mode's expected profile.
 */
export function evaluateTrajectorySignal(
  observations: TrajectoryObservations,
  calibration: ModeCalibration,
  policy: IntegrityRiskPolicy,
  evidence: readonly IntegrityEvidenceRef[],
): IntegritySignal {
  const bigramDeviation = normalizedDeviation(
    observations.dominantBigramShare,
    calibration.expectedDominantBigramShare,
    calibration.bigramTolerance,
  );
  const distinctDeviation = normalizedDeviation(
    observations.distinctKindShare,
    calibration.expectedDistinctKindShare,
    calibration.distinctKindTolerance,
  );
  const brokerDeviation = normalizedDeviation(
    observations.brokerMediatedShare,
    calibration.expectedBrokerShare,
    calibration.brokerTolerance,
  );
  const point = round6(
    Math.max(bigramDeviation, distinctDeviation, brokerDeviation) * policy.maxSignalContribution,
  );
  const bigramCount = Math.max(1, observations.commandCount - 1);
  return {
    kind: "trajectory",
    weight: policy.signalWeights.trajectory,
    riskContribution: point,
    confidence: estimateInterval(point, bigramCount, policy.confidenceLevel),
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Outcome signal (from the replay re-execution comparison)
// ---------------------------------------------------------------------------

/**
 * The outcome signal from one replay re-execution comparison. Divergence
 * is deterministically proven — the interval collapses to the point at
 * confidence level 1. A match is bounded by the unverified fraction of
 * the stream: the interval's upper bound rises with the uncovered
 * remainder. An inconclusive comparison returns `undefined` — honest
 * absence, never a guessed contribution.
 */
export function evaluateOutcomeSignal(
  observations: OutcomeObservations,
  policy: IntegrityRiskPolicy,
  evidence: readonly IntegrityEvidenceRef[],
): IntegritySignal | undefined {
  if (observations.reexecutionKind === "inconclusive") return undefined;
  if (observations.reexecutionKind === "divergence") {
    const point = round6(policy.maxSignalContribution);
    return {
      kind: "outcome",
      weight: policy.signalWeights.outcome,
      riskContribution: point,
      confidence: { level: 1, lowerBound: point, upperBound: point },
      evidence,
    };
  }
  const point = round6(policy.matchOutcomeRisk);
  const unverified = clip01(1 - observations.coverage);
  return {
    kind: "outcome",
    weight: policy.signalWeights.outcome,
    riskContribution: point,
    confidence: {
      level: policy.confidenceLevel,
      lowerBound: point,
      upperBound: round6(Math.min(1, point + unverified)),
    },
    evidence,
  };
}

// ---------------------------------------------------------------------------
// The full signal set
// ---------------------------------------------------------------------------

/** The evidence citations of one behavioral evidence kind. */
export interface EvidenceRefsByKind {
  readonly timing: readonly IntegrityEvidenceRef[];
  readonly trajectory: readonly IntegrityEvidenceRef[];
  readonly outcome: readonly IntegrityEvidenceRef[];
}

/** Result of evaluating every available observation into signals. */
export interface SignalEvaluation {
  /** The evaluated signals, in frozen order: timing, trajectory, outcome. */
  readonly signals: readonly IntegritySignal[];
  /** The signal kinds that contributed (kinds with inadmissible evidence are absent). */
  readonly kinds: readonly IntegritySignalKind[];
}

/**
 * Pure evaluation of all observations under one policy for one declared
 * mode. Timing and trajectory signals are always present (both derive
 * from the verified command trace); the outcome signal is present only
 * when the re-execution comparison reached a typed conclusion.
 */
export function evaluateIntegritySignals(
  timing: TimingObservations,
  trajectory: TrajectoryObservations,
  outcome: OutcomeObservations | undefined,
  playMode: AiPlayMode,
  policy: IntegrityRiskPolicy,
  evidence: EvidenceRefsByKind,
): SignalEvaluation {
  const calibration = policy.modeCalibration[playMode];
  const signals: IntegritySignal[] = [
    evaluateTimingSignal(timing, calibration, policy, evidence.timing),
    evaluateTrajectorySignal(trajectory, calibration, policy, evidence.trajectory),
  ];
  if (outcome !== undefined) {
    const outcomeSignal = evaluateOutcomeSignal(outcome, policy, evidence.outcome);
    if (outcomeSignal !== undefined) signals.push(outcomeSignal);
  }
  return { signals, kinds: signals.map((signal) => signal.kind) };
}
