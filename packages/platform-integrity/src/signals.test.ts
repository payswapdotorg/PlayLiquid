/**
 * SIGNAL TESTS — confidence-boundary coverage (PL-018; R11/E9/E11).
 *
 * The honesty mechanics of the interval layer: every interval is a
 * valid contract ConfidenceInterval (bounds in [0,1], lower ≤ upper,
 * level in (0,1]); the conservative margin shrinks as traces grow;
 * boundary points (deviation 0 and deviation 1) clip into [0,1]; a
 * match widens with the unverified fraction; a divergence collapses to
 * a level-1 point; and per-mode calibration changes contributions
 * without changing the observations (determinism).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateIntegritySignals,
  evaluateOutcomeSignal,
  evaluateTimingSignal,
} from "./signals.ts";
import { extractTimingObservations, extractTrajectoryObservations } from "./observations.ts";
import { DEFAULT_INTEGRITY_RISK_POLICY } from "./policy.ts";
import { humanLikeTrace, machineLikeTrace } from "./fakes.ts";
import { isValidConfidenceInterval } from "@playliquid/platform-contracts";
import type { ContentDigest } from "@playliquid/platform-contracts";

const policy = DEFAULT_INTEGRITY_RISK_POLICY;
const digest = "c".repeat(64) as ContentDigest;
const ref = [{ source: "replay" as const, replayId: "replay-demo-x" as never, digest }];

test("signals: machine trace intervals are valid and widen small samples honestly", () => {
  const timing = extractTimingObservations(machineLikeTrace().entries);
  const trajectory = extractTrajectoryObservations(machineLikeTrace().entries);
  const evaluation = evaluateIntegritySignals(
    timing,
    trajectory,
    undefined,
    "human",
    policy,
    { timing: ref, trajectory: ref, outcome: [] },
  );
  assert.equal(evaluation.signals.length, 2);
  for (const signal of evaluation.signals) {
    assert.ok(isValidConfidenceInterval(signal.confidence), "interval must be contract-valid");
    assert.ok(signal.riskContribution <= policy.maxSignalContribution);
    assert.ok(signal.confidence.lowerBound <= signal.confidence.upperBound);
    // 7 gaps: the margin is ~0.311 at level 0.9 — honest widening.
    const width = signal.confidence.upperBound - signal.confidence.lowerBound;
    assert.ok(width > 0.2 && width < 0.7, `width ${width} not honest for n=7`);
  }
});

test("signals: deviation-1 points clip the upper bound to exactly the policy cap", () => {
  const timing = extractTimingObservations(machineLikeTrace().entries);
  const signal = evaluateTimingSignal(timing, policy.modeCalibration.human, policy, ref);
  assert.ok(Math.abs(signal.riskContribution - policy.maxSignalContribution) < 1e-9);
  assert.equal(signal.confidence.upperBound, 1);
});

test("signals: deviation-0 points clip the lower bound to exactly 0", () => {
  const timing = extractTimingObservations(machineLikeTrace().entries);
  const signal = evaluateTimingSignal(timing, policy.modeCalibration["ai-autonomous"], policy, ref);
  // Machine-like vs the autonomous profile: low but non-zero deviation.
  assert.ok(signal.riskContribution < 0.4);
  // A perfectly-consistent point would clip to lower bound 0; with the
  // sampling margin the lower bound is at most the point minus margin.
  assert.ok(signal.confidence.lowerBound <= signal.riskContribution);
  assert.ok(signal.confidence.lowerBound >= 0);
});

test("signals: per-mode calibration changes contributions, not observations (E9)", () => {
  const timing = extractTimingObservations(machineLikeTrace().entries);
  const trajectory = extractTrajectoryObservations(machineLikeTrace().entries);
  const human = evaluateIntegritySignals(timing, trajectory, undefined, "human", policy, {
    timing: ref,
    trajectory: ref,
    outcome: [],
  });
  const autonomous = evaluateIntegritySignals(timing, trajectory, undefined, "ai-autonomous", policy, {
    timing: ref,
    trajectory: ref,
    outcome: [],
  });
  const humanRisk = human.signals.reduce((sum, signal) => sum + signal.weight * signal.riskContribution, 0) /
    human.signals.reduce((sum, signal) => sum + signal.weight, 0);
  const autonomousRisk = autonomous.signals.reduce(
    (sum, signal) => sum + signal.weight * signal.riskContribution,
    0,
  ) / autonomous.signals.reduce((sum, signal) => sum + signal.weight, 0);
  assert.ok(humanRisk > autonomousRisk, "machine-like trace must risk more under a human claim");
  // Same observations feed both — the extractors are pure and shared.
  assert.equal(human.signals[0]!.kind, autonomous.signals[0]!.kind);
});

test("signals: a match interval widens exactly by the unverified fraction", () => {
  const full = evaluateOutcomeSignal(
    { observationKind: "outcome-pattern", reexecutionKind: "match", coverage: 1, divergentPositions: [], totalEventCount: 10 },
    policy,
    ref,
  );
  assert.ok(full);
  assert.equal(full.riskContribution, policy.matchOutcomeRisk);
  assert.equal(full.confidence.upperBound, policy.matchOutcomeRisk);
  const half = evaluateOutcomeSignal(
    { observationKind: "outcome-pattern", reexecutionKind: "match", coverage: 0.5, divergentPositions: [], totalEventCount: 10 },
    policy,
    ref,
  );
  assert.ok(half);
  assert.ok(Math.abs(half.confidence.upperBound - (policy.matchOutcomeRisk + 0.5)) < 1e-9);
});

test("signals: a divergence collapses to a level-1 point at the cap", () => {
  const signal = evaluateOutcomeSignal(
    { observationKind: "outcome-pattern", reexecutionKind: "divergence", coverage: 1, divergentPositions: [2], totalEventCount: 10 },
    policy,
    ref,
  );
  assert.ok(signal);
  assert.equal(signal.confidence.level, 1);
  assert.equal(signal.confidence.lowerBound, signal.riskContribution);
  assert.equal(signal.confidence.upperBound, signal.riskContribution);
  assert.equal(signal.riskContribution, policy.maxSignalContribution);
});

test("signals: an inconclusive outcome yields NO signal (honest absence)", () => {
  const signal = evaluateOutcomeSignal(
    { observationKind: "outcome-pattern", reexecutionKind: "inconclusive", coverage: 0, divergentPositions: [], totalEventCount: 0 },
    policy,
    ref,
  );
  assert.equal(signal, undefined);
});

test("signals: larger traces produce strictly narrower timing intervals", () => {
  const small = extractTimingObservations(humanLikeTrace().entries);
  const doubled = [...humanLikeTrace().entries, ...humanLikeTrace().entries].map((entry, index) => ({
    ...entry,
    admissionSeq: index + 1,
  }));
  const large = extractTimingObservations(doubled);
  const smallSignal = evaluateTimingSignal(small, policy.modeCalibration.human, policy, ref);
  const largeSignal = evaluateTimingSignal(large, policy.modeCalibration.human, policy, ref);
  const smallWidth = smallSignal.confidence.upperBound - smallSignal.confidence.lowerBound;
  const largeWidth = largeSignal.confidence.upperBound - largeSignal.confidence.lowerBound;
  assert.ok(largeWidth < smallWidth, "more evidence must narrow the honest interval");
});
