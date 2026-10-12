/**
 * GAP-LADDER READ MODELS (pure): project lab-learning's rung-classified
 * recurring capability-gap summaries (GapLadderSummary, R18) into typed
 * view models for the workbench's Gaps surface.
 *
 * The ladder itself is lab-contracts' frozen authority (GAP_LADDER_RUNGS
 * is imported, never re-declared): rung order, positions and the terminal
 * `blocked` rung all render from the frozen table. Recurrence is a
 * first-class visible state — recurring gaps surface with their counts,
 * never silently skipped.
 *
 * Pure module: no IO, no React, no clock.
 */

import { GAP_LADDER_RUNGS } from "../../../../lab-contracts/src/index.ts";
import type { GapLadderRung } from "../../../../lab-contracts/src/index.ts";
import type { GapLadderSummary } from "../../../../lab-learning/src/index.ts";

/** One rung-classified recurring capability-gap row. */
export interface GapRowView {
  /** The missing capability (the aggregation key). */
  readonly missingCapability: string;
  /** The furthest rung reached by the aggregated trails. */
  readonly currentRung: GapLadderRung;
  /** The current rung's position in the frozen ladder (0-based). */
  readonly rungIndex: number;
  /** Every rung with at least one attempt, joined in ladder order. */
  readonly reached: string;
  /** Per-rung attempt counts, joined in ladder order ("rung ×n"). */
  readonly attemptTrail: string;
  /** The number of DISTINCT Lab cycles that recorded this gap. */
  readonly recurrenceCount: number;
  readonly recurring: boolean;
  readonly resolved: boolean;
  readonly blocked: boolean;
  readonly gapCount: number;
  readonly cycleCount: number;
  /** The backing gap record ids (sorted; the first backs the advance intent). */
  readonly gapIds: readonly string[];
}

/** The Gaps surface: ladder rows + the frozen ladder legend. */
export interface GapsView {
  readonly rows: readonly GapRowView[];
  /** The frozen ladder, imported verbatim (ladder order = display order). */
  readonly ladder: readonly GapLadderRung[];
  readonly recurringCount: number;
  readonly blockedCount: number;
  readonly resolvedCount: number;
}

/**
 * Project gap summaries into the ladder view. Rows enumerate in the
 * summaries' own content-derived order (missingCapability asc).
 */
export function projectGaps(summaries: readonly GapLadderSummary[]): GapsView {
  const rows = summaries.map((summary): GapRowView => {
    const rungIndex = GAP_LADDER_RUNGS.indexOf(summary.currentRung);
    return {
      missingCapability: summary.missingCapability,
      currentRung: summary.currentRung,
      rungIndex,
      reached: summary.reachedRungs.join(" > "),
      attemptTrail: summary.rungAttemptCounts.map((entry) => `${entry.rung} ×${entry.attempts}`).join(" · "),
      recurrenceCount: summary.recurrenceCount,
      recurring: summary.recurring,
      resolved: summary.resolved,
      blocked: summary.blocked,
      gapCount: summary.gapIds.length,
      cycleCount: summary.cycleIds.length,
      gapIds: summary.gapIds,
    } satisfies GapRowView;
  });
  return {
    rows,
    ladder: [...GAP_LADDER_RUNGS],
    recurringCount: rows.filter((row) => row.recurring).length,
    blockedCount: rows.filter((row) => row.blocked).length,
    resolvedCount: rows.filter((row) => row.resolved).length,
  } satisfies GapsView;
}

/** Deterministic summary line ("N gaps · R recurring · B blocked"). */
export function gapsSummary(view: GapsView): string {
  const total = view.rows.length;
  const recurring = view.recurringCount;
  const blocked = view.blockedCount;
  const resolved = view.resolvedCount;
  return `${total} gap${total === 1 ? "" : "s"} · ${recurring} recurring · ${blocked} blocked · ${resolved} resolved`;
}
