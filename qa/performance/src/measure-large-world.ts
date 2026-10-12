/**
 * qa/performance — LARGE-WORLD suite (PL-039 surface; PL-042).
 *
 * WHAT IS MEASURED (E11 honesty): R15 chunk streaming with a moving
 * viewpoint over the LATTICE large-world reference, through
 * examples/large-world's PUBLIC entrypoint:
 *
 * 1. COMPOSITION: one world composition — validated GameIR document ->
 *    derived 128x128 world model -> 87 immutable packages published
 *    through the REAL registry/CAS authorities -> verified lock.
 * 2. STREAMING SCHEDULE: the pure streaming state machine
 *    (deriveStreamingSchedule) over a deterministic 240-tick viewpoint
 *    tour — steps/sec, streaming-window resolutions/sec (loads +
 *    unloads through the CAS-backed chunk resolver), resident counts.
 * 3. REGION/ZONE RESOLUTION: wanted-set derivation (circle vs chunk
 *    bounds, the streaming spatial query) at view radii 8/24/48/96 over
 *    a 17x17 viewpoint grid — derivations/sec and mean wanted-set size
 *    per radius (how the resolution work scales with view distance).
 *
 * Determinism: the same 48-tick schedule derived twice must produce the
 * identical totals digest.
 */

import { composeLatticeWorld, deriveStreamingSchedule, wantedChunkIds } from "../../../examples/large-world/src/index.ts";
import type { LatticeComposition } from "../../../examples/large-world/src/index.ts";
import { PERFORMANCE_BUDGETS } from "./budgets.ts";
import type { MetricMeasurement } from "./budgets.ts";
import { logMetric, nowMs, shapeDigestOf } from "./perf-kit.ts";

const TOUR_TICKS = 240;
const RADII: readonly number[] = [8, 24, 48, 96];
const GRID_POSITIONS = 17;

/** The deterministic viewpoint tour: a fixed Lissajous sweep of the world. */
function tourWaypoints(): { readonly tick: number; readonly x: number; readonly y: number }[] {
  const waypoints: { tick: number; x: number; y: number }[] = [];
  for (let tick = 1; tick <= TOUR_TICKS; tick += 1) {
    const x = Math.min(Math.max(64 + 56 * Math.sin(tick * 0.26), 0.5), 127.5);
    const y = Math.min(Math.max(64 + 56 * Math.cos(tick * 0.19), 0.5), 127.5);
    waypoints.push({ tick, x, y });
  }
  return waypoints;
}

/** Composes the world once; measures the composition wall time. */
async function composeWorld(): Promise<{ composition: LatticeComposition; metric: MetricMeasurement }> {
  const started = nowMs();
  const composition = await composeLatticeWorld();
  const elapsed = nowMs() - started;
  if (!composition.ok) throw new Error(`world composition refused: ${String(composition.code)}`);
  logMetric("world composition", "document -> model -> 87 packages -> verified lock", elapsed, composition.packageCount);
  return {
    composition,
    metric: {
      metric: "largeWorld.composition",
      scale: "one full world composition (87 packages through registry/CAS)",
      count: composition.packageCount,
      measuredMs: elapsed,
      budgetMs: PERFORMANCE_BUDGETS.largeWorld.compositionMs,
      detail: `${String(composition.chunkCount)} chunks; lock ${composition.lockFingerprint.slice(0, 18)}…`,
    },
  };
}

/** Derives the streaming schedule over the viewpoint tour. */
function runStreamingSchedule(composition: LatticeComposition): { metric: MetricMeasurement; totals: Record<string, number> } {
  const waypoints = tourWaypoints();
  const started = nowMs();
  const schedule = deriveStreamingSchedule(composition.model, waypoints, composition.graph.resolver);
  const elapsed = nowMs() - started;
  const resolutions = schedule.totalLoads + schedule.totalUnloads;
  logMetric("chunk streaming schedule", "240-tick viewpoint tour (pure R15 state machine)", elapsed, resolutions, `${String(schedule.totalLoads)} loads + ${String(schedule.totalUnloads)} unloads | windows/s ${String(Math.round((resolutions * 1000) / elapsed))}`);
  return {
    metric: {
      metric: "largeWorld.streamingSchedule",
      scale: "240-tick deterministic viewpoint tour over 64 chunks",
      count: TOUR_TICKS,
      measuredMs: elapsed,
      budgetMs: PERFORMANCE_BUDGETS.largeWorld.streamingScheduleMs,
      detail: `${String(resolutions)} window resolutions (${String(schedule.totalLoads)} loads, ${String(schedule.totalUnloads)} unloads, ${String(schedule.totalCasFetches)} CAS fetches, ${String(schedule.totalCheckpointReloads)} checkpoint reloads)`,
    },
    totals: {
      totalLoads: schedule.totalLoads,
      totalUnloads: schedule.totalUnloads,
      totalCasFetches: schedule.totalCasFetches,
      totalCheckpointReloads: schedule.totalCheckpointReloads,
    },
  };
}

/** Wanted-set derivation at multiple view radii over a position grid. */
function runResolutionScaling(composition: LatticeComposition): { metric: MetricMeasurement; detail: string } {
  const started = nowMs();
  const sizes: Record<string, number> = {};
  let derivations = 0;
  for (const radius of RADII) {
    let total = 0;
    for (let gx = 0; gx < GRID_POSITIONS; gx += 1) {
      for (let gy = 0; gy < GRID_POSITIONS; gy += 1) {
        const x = 4 + (gx * 120) / (GRID_POSITIONS - 1);
        const y = 4 + (gy * 120) / (GRID_POSITIONS - 1);
        total += wantedChunkIds(composition.model, x, y, radius).length;
        derivations += 1;
      }
    }
    sizes[String(radius)] = Math.round((total / (GRID_POSITIONS * GRID_POSITIONS)) * 10) / 10;
  }
  const elapsed = nowMs() - started;
  const detail = `mean wanted-set size per radius: ${Object.entries(sizes).map(([radius, size]) => `r${radius}=${String(size)}`).join(", ")}`;
  logMetric("wanted-set derivation", "4 radii x 289 viewpoint positions", elapsed, derivations, detail);
  return {
    metric: {
      metric: "largeWorld.wantedSetScan",
      scale: `${String(RADII.length)} radii (8/24/48/96) x ${String(GRID_POSITIONS * GRID_POSITIONS)} viewpoint positions`,
      count: derivations,
      measuredMs: elapsed,
      budgetMs: PERFORMANCE_BUDGETS.largeWorld.wantedSetScanMs,
      detail,
    },
    detail,
  };
}

/** The full suite measurement (async: composition publishes through the authorities). */
export async function measureLargeWorld(): Promise<{
  readonly suite: string;
  readonly metrics: readonly MetricMeasurement[];
  readonly shapeDigest: string;
  readonly determinism: { readonly repeated: boolean; readonly digest: string };
}> {
  const { composition, metric: compositionMetric } = await composeWorld();
  const schedule = runStreamingSchedule(composition);
  const resolution = runResolutionScaling(composition);

  // Determinism: the same short schedule derived twice must agree exactly.
  const shortTour = tourWaypoints().slice(0, 48);
  const derive = (): Record<string, number> => {
    const scheduleA = deriveStreamingSchedule(composition.model, shortTour, composition.graph.resolver);
    return {
      loads: scheduleA.totalLoads,
      unloads: scheduleA.totalUnloads,
      casFetches: scheduleA.totalCasFetches,
      checkpointReloads: scheduleA.totalCheckpointReloads,
    };
  };
  const digestA = shapeDigestOf(derive());
  const digestB = shapeDigestOf(derive());
  if (digestA !== digestB) throw new Error("large-world determinism violated: repeated schedules differ");

  const shapeDigest = shapeDigestOf({
    suite: "qa/performance/large-world",
    compositionDigest: composition.compositionDigest,
    packageCount: composition.packageCount,
    tourTicks: TOUR_TICKS,
    radii: RADII,
    scheduleTotals: schedule.totals,
    determinismDigest: digestA,
  });
  return {
    suite: "large-world",
    metrics: [compositionMetric, schedule.metric, resolution.metric],
    shapeDigest,
    determinism: { repeated: true, digest: digestA },
  };
}
