/**
 * GAP LEARNING (PL-030, R18) — RECURRING capability-gap findings aggregated
 * across Lab cycles into typed summaries, classified by lab-contracts'
 * FROZEN gap ladder (lock rules 30/31/32; spec/architecture.md
 * "Capability gaps": existing organization → alternate organization →
 * package/platform capability → user/community contribution → Arena →
 * blocked).
 *
 * This module CONSUMES the ladder authority (lab-contracts gap-ladder.ts:
 * the frozen rung table, the stepwise transitions, `blocked` as the typed
 * terminal) and never re-implements it. Discipline:
 *
 * - aggregation key = the missing capability (tenant-scoped by the records
 *   the summaries are folded from);
 * - `currentRung` is the rung of the LAST attempt of the aggregated
 *   trails (the furthest point reached); `reachedRungs` lists every rung
 *   with at least one attempt, in ladder order;
 * - `recurrenceCount` = the number of DISTINCT Lab cycles that recorded
 *   the gap; `recurring` marks recurrence > 1 — recurring gaps surface
 *   with their counts, NEVER silently skipped;
 * - ESCALATION IS NOT HERE (E1/E11): this package only records and types.
 *   Advancing a rung is lab-organization's gap door and the host's
 *   decision; nothing here auto-escalates, contacts Arena or opens a
 *   contribution request;
 * - `resolved`/`blocked` are typed terminal markers derived from the
 *   trails (a resolved gap takes no further rungs; blocked is terminal).
 *
 * Pure module: no IO, no clocks, no network.
 */

import type {
  CapabilityGapRecord,
  GapLadderRung,
  LabCycleId,
} from "@playliquid/lab-contracts";
import { GAP_LADDER_RUNGS, gapLadderPosition } from "@playliquid/lab-contracts";
import type { LearningCycleRecord } from "./records.ts";

/** One aggregated, rung-classified capability-gap summary (R18). */
export interface GapLadderSummary {
  /** The capability that is missing (the aggregation key). */
  readonly missingCapability: string;
  /** The furthest rung reached by the aggregated trails. */
  readonly currentRung: GapLadderRung;
  /** Every rung with at least one attempt, in frozen ladder order. */
  readonly reachedRungs: readonly GapLadderRung[];
  /** Attempt counts per rung across the aggregated trails (ladder order). */
  readonly rungAttemptCounts: readonly { readonly rung: GapLadderRung; readonly attempts: number }[];
  /** The number of DISTINCT Lab cycles that recorded this gap. */
  readonly recurrenceCount: number;
  /** Sorted unique gap record ids backing the summary. */
  readonly gapIds: readonly string[];
  /** Sorted unique cycle ids backing the summary. */
  readonly cycleIds: readonly LabCycleId[];
  /** True when any aggregated trail resolved the gap. */
  readonly resolved: boolean;
  /** True when the furthest rung reached is the terminal `blocked`. */
  readonly blocked: boolean;
  /** True when the gap recurred across more than one cycle. */
  readonly recurring: boolean;
}

/** The furthest rung of one gap trail (the last attempt's rung). */
function currentRungOf(gap: CapabilityGapRecord): GapLadderRung {
  const last = gap.attempts[gap.attempts.length - 1];
  return last?.rung ?? "existing-organization";
}

/**
 * Aggregates the capability-gap records of accumulated learning cycles
 * into typed, rung-classified summaries. Pure and total: the input records
 * are already intake-validated (lab-contracts' own gap validator ran at
 * admission), so nothing is skipped — every gap appears in exactly one
 * summary. Enumeration order is content-derived (missingCapability asc).
 */
export function deriveGapLadderSummaries(records: readonly LearningCycleRecord[]): readonly GapLadderSummary[] {
  const aggregates = new Map<string, {
    rungs: Map<GapLadderRung, number>;
    gapIds: Set<string>;
    cycleIds: Set<LabCycleId>;
    resolved: boolean;
    blocked: boolean;
  }>();
  for (const record of records) {
    for (const gap of record.gaps) {
      const key = gap.missingCapability;
      let aggregate = aggregates.get(key);
      if (aggregate === undefined) {
        aggregate = { rungs: new Map(), gapIds: new Set(), cycleIds: new Set(), resolved: false, blocked: false };
        aggregates.set(key, aggregate);
      }
      aggregate.gapIds.add(String(gap.gapId));
      aggregate.cycleIds.add(record.cycleId);
      aggregate.resolved ||= gap.attempts.some((attempt) => attempt.rung !== "blocked" && attempt.outcome === "resolved");
      for (const attempt of gap.attempts) {
        aggregate.rungs.set(attempt.rung, (aggregate.rungs.get(attempt.rung) ?? 0) + 1);
      }
      if (currentRungOf(gap) === "blocked") aggregate.blocked = true;
    }
  }
  const summaries: GapLadderSummary[] = [];
  for (const [missingCapability, aggregate] of [...aggregates].sort(([a], [b]) => a.localeCompare(b))) {
    const currentRung = highestRungOf(aggregate.rungs);
    summaries.push({
      missingCapability,
      currentRung,
      reachedRungs: GAP_LADDER_RUNGS.filter((rung) => aggregate.rungs.has(rung)),
      rungAttemptCounts: GAP_LADDER_RUNGS.filter((rung) => aggregate.rungs.has(rung)).map((rung) => ({
        rung,
        attempts: aggregate.rungs.get(rung) ?? 0,
      })),
      recurrenceCount: aggregate.cycleIds.size,
      gapIds: [...aggregate.gapIds].sort(),
      cycleIds: [...aggregate.cycleIds].sort(),
      resolved: aggregate.resolved,
      blocked: aggregate.blocked,
      recurring: aggregate.cycleIds.size > 1,
    });
  }
  return Object.freeze(summaries);
}

/** The ladder-furthest rung among the recorded attempts. */
function highestRungOf(rungs: Map<GapLadderRung, number>): GapLadderRung {
  let best: GapLadderRung = "existing-organization";
  for (const rung of rungs.keys()) {
    if (gapLadderPosition(rung) > gapLadderPosition(best)) best = rung;
  }
  return best;
}
