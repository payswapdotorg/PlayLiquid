/**
 * EPISTEMIC LABELING (E11, lock rules 28/29 — THE trust-boundary surface of
 * the Lab).
 *
 * "Counterfactuals and simulator output are explicitly labeled estimates."
 * "Simulator output is not ground truth."
 *
 * This module makes the estimate/observation distinction UNREPRESENTABLE-
 * WRONG: the two epistemic classes carry structurally disjoint marker
 * literals (`"labeled-estimate"` vs `"observed-evidence"`), so a value of
 * one class cannot be assigned where the other is required — proven by
 * `@ts-expect-error` type-misuse tests in estimates.test.ts. Runtime guards
 * discriminate the same way for untyped input.
 *
 * Every quantitative statement the Lab produces about FUTURE or
 * COUNTERFACTUAL organization performance is a {@link LabeledEstimate};
 * every statement about what ACTUALLY HAPPENED is an observed-evidence
 * record (see evidence.ts). A counterfactual is a
 * {@link Counterfactual}; a simulator run result is a
 * {@link SimulatorOutput}. Neither can masquerade as the other, and no
 * function in this package converts between them.
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import type { ContentDigest } from "./primitives.ts";

/**
 * The frozen vocabulary of estimate methods. How an estimate was produced
 * is part of its honesty: an estimate without a method is unreviewable.
 */
export const ESTIMATE_METHODS = Object.freeze([
  "simulation",
  "counterfactual-replay",
  "analytical-model",
  "expert-judgment",
] as const);

/** How a {@link LabeledEstimate} was produced. */
export type EstimateMethod = (typeof ESTIMATE_METHODS)[number];

/** Returns true when `value` is a valid {@link EstimateMethod}. */
export function isEstimateMethod(value: unknown): value is EstimateMethod {
  return typeof value === "string" && (ESTIMATE_METHODS as readonly string[]).includes(value);
}

/** Marker literal carried by EVERY explicitly-labeled estimate (E11). */
export type LabeledEstimateMarker = "labeled-estimate";

/** Marker literal carried by EVERY observed-evidence record (E10). */
export type ObservedEvidenceMarker = "observed-evidence";

/**
 * Marker interface for observed evidence. Records that state what actually
 * happened (project evidence, observed outcomes — evidence.ts) intersect
 * this marker so they can never be confused with estimates.
 */
export interface ObservedEvidence {
  readonly epistemic: ObservedEvidenceMarker;
}

/**
 * An explicitly-labeled estimate (E11): a statement about expected or
 * counterfactual outcomes, produced by a declared method. The payload is
 * generic so callers attach typed result data; the label is the contract.
 */
export interface LabeledEstimate<P = unknown> {
  readonly epistemic: LabeledEstimateMarker;
  readonly method: EstimateMethod;
  readonly payload: P;
}

/**
 * Output of a simulator run (lock rule 29: simulator output is not ground
 * truth). A specialization of {@link LabeledEstimate} whose method is
 * pinned to `"simulation"` and which names the simulator that produced it.
 */
export interface SimulatorOutput<P = unknown> {
  readonly epistemic: LabeledEstimateMarker;
  readonly method: "simulation";
  /** Opaque simulator identity (e.g. `lab-sim-headless-v2`). */
  readonly simulator: string;
  readonly payload: P;
}

/**
 * A counterfactual statement (lock rule 28): what the estimate believes
 * WOULD have happened under different circumstances, explicitly contrasted
 * with what actually happened. `versus` references the observed evidence
 * the counterfactual is contrasted against (an observation id or summary).
 */
export interface Counterfactual<P = unknown> {
  readonly epistemic: LabeledEstimateMarker;
  readonly method: "counterfactual-replay";
  readonly versus: string;
  readonly payload: P;
}

/**
 * Optional provenance for an estimate: the content digest of the simulator
 * build or input set that produced it. Never a substitute for observation —
 * it makes the estimate REVIEWABLE, not more true.
 */
export interface EstimateProvenance {
  readonly basis: ContentDigest;
}

/** Returns true when `value` carries the observed-evidence marker literal. */
export function isObservedEvidence(value: unknown): value is ObservedEvidence {
  if (typeof value !== "object" || value === null) return false;
  return (value as Record<string, unknown>).epistemic === "observed-evidence";
}

/** Returns true when `value` is structurally a valid {@link LabeledEstimate}. */
export function isLabeledEstimate(value: unknown): value is LabeledEstimate {
  if (typeof value !== "object" || value === null) return false;
  const estimate = value as Record<string, unknown>;
  return estimate.epistemic === "labeled-estimate" && isEstimateMethod(estimate.method);
}

/** Returns true when `value` is structurally a valid {@link SimulatorOutput}. */
export function isSimulatorOutput(value: unknown): value is SimulatorOutput {
  if (typeof value !== "object" || value === null) return false;
  const output = value as Record<string, unknown>;
  return (
    output.epistemic === "labeled-estimate" &&
    output.method === "simulation" &&
    typeof output.simulator === "string" &&
    output.simulator.length > 0
  );
}

/** Returns true when `value` is structurally a valid {@link Counterfactual}. */
export function isCounterfactual(value: unknown): value is Counterfactual {
  if (typeof value !== "object" || value === null) return false;
  const counterfactual = value as Record<string, unknown>;
  return (
    counterfactual.epistemic === "labeled-estimate" &&
    counterfactual.method === "counterfactual-replay" &&
    typeof counterfactual.versus === "string" &&
    counterfactual.versus.length > 0
  );
}

/**
 * The honesty oracle (E11): given any value, report which epistemic class
 * it belongs to. Estimates report `"estimate"` (never `"observation"`);
 * observed-evidence records report `"observation"`; anything else is
 * `"unlabeled"` and therefore unusable as either.
 */
export type EpistemicClass = "observation" | "estimate" | "unlabeled";

/** Classifies `value` into the E11 epistemic classes. Pure. */
export function epistemicClassOf(value: unknown): EpistemicClass {
  if (isObservedEvidence(value)) return "observation";
  if (isLabeledEstimate(value)) return "estimate";
  return "unlabeled";
}
