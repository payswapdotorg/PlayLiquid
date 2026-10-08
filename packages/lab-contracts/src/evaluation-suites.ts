/**
 * THE GAME-IR EVALUATION-SUITE SEAM.
 *
 * spec/architecture.md ("GameIR"): the semantic kernel contains evaluation
 * suites. spec/architecture.md ("Lab loop"): the simulation/evaluation
 * stage of the Lab loop evaluates candidate organizations against those
 * suites. This module defines the seam through which Lab evaluations
 * CONSUME game-ir evaluation suites — a content-addressed reference plus
 * a resolved suite view whose metric readings are typed with the kernel's
 * OWN value system (`GameIRValue` / `ValueShape` from
 * `@playliquid/game-ir`, imported — never duplicated — per the module
 * dependency matrix: lab-contracts | game-contracts, game-ir).
 *
 * There is deliberately NO evaluation engine, simulator or scoring
 * algorithm here (lock rule 12's split, applied to the Lab): the ports are
 * consumed by lab-simulation (PL-028) and lab-organization (PL-029).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import type { GameIRValue, GameIRVersion, ValueShape } from "@playliquid/game-ir";
import { isGameIRVersion } from "@playliquid/game-ir";
import type {
  ContentDigest,
  LabEvaluationMetricId,
  LabEvaluationSuiteId,
} from "./primitives.ts";
import { asLabEvaluationMetricId, asLabEvaluationSuiteId, isValidContentDigest } from "./primitives.ts";

/**
 * A content-addressed reference to a GameIR evaluation suite: which suite,
 * targeted at which GameIR version, pinned by which content digest (lock
 * rule 9 / E9 reproducible pinning). Mirrors the reference shape
 * established by `package-system`'s `EvaluationSuiteRef` seam.
 */
export interface LabEvaluationSuiteRef {
  readonly suiteId: LabEvaluationSuiteId;
  readonly irVersion: GameIRVersion;
  readonly contentDigest: ContentDigest;
}

/** Returns true when `value` is structurally a valid {@link LabEvaluationSuiteRef}. */
export function isLabEvaluationSuiteRef(value: unknown): value is LabEvaluationSuiteRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.suiteId === "string" &&
    asLabEvaluationSuiteId(ref.suiteId) !== undefined &&
    isGameIRVersion(ref.irVersion) &&
    typeof ref.contentDigest === "string" &&
    isValidContentDigest(ref.contentDigest)
  );
}

/**
 * One metric of an evaluation suite: what is measured, human-reviewably
 * (R1), and the kernel {@link ValueShape} its readings must satisfy.
 * Shape authority stays with game-ir; the Lab never invents a second
 * metric-shape language.
 */
export interface LabEvaluationMetric {
  readonly metricId: LabEvaluationMetricId;
  readonly summary: string;
  readonly shape: ValueShape;
}

/**
 * The resolved view of a GameIR evaluation suite as the Lab consumes it.
 * The full suite definition lives in the kernel/package graph; this is the
 * contract-level projection evaluations program against.
 */
export interface LabEvaluationSuite {
  readonly ref: LabEvaluationSuiteRef;
  readonly summary: string;
  readonly metrics: readonly LabEvaluationMetric[];
}

/** One reading of one suite metric: a kernel value (deterministic, canonically serializable). */
export interface EvaluationMetricReading {
  readonly metricId: LabEvaluationMetricId;
  readonly value: GameIRValue;
}

/**
 * PORT (no engine here): resolves a content-addressed suite reference into
 * the resolved suite view, or `undefined` when the pinned suite is unknown.
 * Implemented by the Lab simulation/organization packages (PL-028/029),
 * backed by the package graph — never by this contracts package.
 */
export type EvaluationSuiteResolver = (ref: LabEvaluationSuiteRef) => LabEvaluationSuite | undefined;

/**
 * Structural guard for {@link LabEvaluationMetric}. Shape validity itself
 * is delegated to game-ir's `isValueShape` at the call sites that need it.
 */
export function isLabEvaluationMetric(value: unknown): value is LabEvaluationMetric {
  if (typeof value !== "object" || value === null) return false;
  const metric = value as Record<string, unknown>;
  return (
    typeof metric.metricId === "string" &&
    asLabEvaluationMetricId(metric.metricId) !== undefined &&
    typeof metric.summary === "string" &&
    metric.summary.length > 0 &&
    typeof metric.shape === "object" &&
    metric.shape !== null
  );
}
