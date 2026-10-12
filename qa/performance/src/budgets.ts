/**
 * qa/performance — THE BUDGETS (PL-042): the single source of truth for
 * every enforced performance bound of the cross-system scale suite.
 *
 * Philosophy: budgets are generous UPPER bounds set ~3-10x the value
 * measured on this 4GB shared-CPU sandbox box — they exist to catch
 * ORDER-OF-MAGNITUDE regressions (an accidental O(n²), a leaked event
 * log, a broken batch path), never to chase percentage points. Timing
 * budgets are wall-clock milliseconds for the exact workload named by
 * the metric; heap budgets are process.memoryUsage() deltas (MB) across
 * an allocation loop (no forced GC — a footprint guard, not a residency
 * bound).
 *
 * Every metric measured by src/measure-*.ts carries its budget FROM THIS
 * FILE; the tests assert `measured < budget` against that value and
 * nothing else. Raising a budget is a reviewed decision that belongs in
 * this file alone.
 */

export const PERFORMANCE_BUDGETS = {
  simulation: {
    /** 500 sessions x (create + seeded load + 20 steps). */
    sessionScaleMs: 1_500,
    /** One deep session: 10,000 fixed ticks. */
    deepStepsMs: 1_200,
    /** HeapUsed delta across the 500-session workload (footprint guard). */
    sessionHeapMb: 64,
  },
  replay: {
    /** Seal 50 command-stream artifacts x 200 commands (10,000 commands). */
    sealArtifactsMs: 2_500,
    /** Verify the same 50 sealed artifacts. */
    verifyArtifactsMs: 2_500,
    /** 1,000 verifications of a tampered artifact (typed refusals). */
    tamperedVerifyMs: 2_000,
  },
  largeWorld: {
    /** One world composition: document -> model -> 87 packages -> verified lock. */
    compositionMs: 800,
    /** Streaming schedule over a 240-tick viewpoint tour. */
    streamingScheduleMs: 500,
    /** Wanted-set derivation: 4 radii x 289 viewpoint positions. */
    wantedSetScanMs: 150,
  },
  engine: {
    /** 2,000 typed engine-binding constructions. */
    bindingConstructionMs: 200,
    /** 2,000 adapter command dispatches through the (fake) bridge. */
    planApplicationMs: 1_500,
  },
} as const;

/** The shape of one measured metric (the suite report entry). */
export interface MetricMeasurement {
  /** Metric name (stable identifier; the budget key lives in the measure module). */
  readonly metric: string;
  /** The exact workload scale the number was measured on. */
  readonly scale: string;
  /** Operations covered by the measurement. */
  readonly count: number;
  /** Measured value (wall-clock ms, or MB for the explicitly-marked footprint metrics). */
  readonly measuredMs: number;
  /** The ENFORCED budget for this metric (from PERFORMANCE_BUDGETS). */
  readonly budgetMs: number;
  /** The unit of measuredMs/budgetMs (default "ms"). */
  readonly unit?: "ms" | "MB";
  /** Machine-dependent rates / honest notes. */
  readonly detail?: string;
}
