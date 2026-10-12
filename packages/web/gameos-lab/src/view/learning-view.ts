/**
 * LEARNING READ MODELS (pure): project lab-learning's authoritative
 * outputs — the sealed LearningCycleRecord set (R17: the Lab learns from
 * real project evidence over time) and the derived LabLearningSignals
 * (the deterministic dimension-affinity fold, E9) — into typed view
 * models for the workbench's Learning surface.
 *
 * This module NEVER re-derives signals or folds records (that is
 * lab-learning's authority); it projects what the service already
 * derived. The signals' content-addressed state digest renders so E9
 * determinism is observable in the UI.
 *
 * Pure module: no IO, no React, no clock.
 */

import type {
  LabLearningSignals,
  LearningCycleRecord,
} from "../../../../lab-learning/src/index.ts";

/** One sealed learning-cycle record row. */
export interface LearningRowView {
  readonly recordId: string;
  readonly cycleId: string;
  readonly sequence: number;
  readonly learnedAt: number;
  readonly outcomeCount: number;
  readonly conclusionCount: number;
  readonly evaluationCount: number;
  readonly searchResultCount: number;
  readonly gapCount: number;
}

/** One dimension-affinity signal row. */
export interface SignalRowView {
  readonly dimension: string;
  readonly value: string;
  readonly coOccurrences: number;
  readonly cycleCount: number;
}

/** The Learning surface: record rows + signal rows + the state digest. */
export interface LearningView {
  readonly rows: readonly LearningRowView[];
  readonly signals: readonly SignalRowView[];
  /** The signals fold's content-addressed digest (E9 observable). */
  readonly stateDigest: string | null;
  readonly recordCount: number;
}

/**
 * Project learning records + derived signals into the Learning view.
 * Records enumerate in fold order (sequence, recordId); signal rows in
 * the derived affinities' own order — both content-derived, deterministic.
 */
export function projectLearning(
  records: readonly LearningCycleRecord[],
  signals: LabLearningSignals | undefined,
): LearningView {
  const rows = [...records]
    .sort((a, b) => a.sequence - b.sequence || a.recordId.localeCompare(b.recordId))
    .map((record): LearningRowView => ({
      recordId: record.recordId,
      cycleId: String(record.cycleId),
      sequence: record.sequence,
      learnedAt: record.learnedAt,
      outcomeCount: record.outcomes.length,
      conclusionCount: record.conclusions.length,
      evaluationCount: record.evaluations.length,
      searchResultCount: record.searchResults.length,
      gapCount: record.gaps.length,
    }));
  const signalRows = (signals?.affinities ?? []).map((affinity): SignalRowView => ({
    dimension: affinity.dimension,
    value: affinity.value,
    coOccurrences: affinity.coOccurrences,
    cycleCount: affinity.cycleIds.length,
  }));
  return {
    rows,
    signals: signalRows,
    stateDigest: signals === undefined ? null : String(signals.stateDigest),
    recordCount: rows.length,
  } satisfies LearningView;
}

/** Deterministic summary line ("N cycles · M signals · digest …"). */
export function learningSummary(view: LearningView): string {
  const digest = view.stateDigest === null ? "not yet derived" : `sha256:${view.stateDigest.slice(0, 12)}`;
  return `${view.recordCount} cycle${view.recordCount === 1 ? "" : "s"} · ${view.signals.length} signal${view.signals.length === 1 ? "" : "s"} · ${digest}`;
}
