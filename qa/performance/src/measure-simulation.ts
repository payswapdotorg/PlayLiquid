/**
 * qa/performance — SIMULATION suite (PL-014 surface; PL-042).
 *
 * WHAT IS MEASURED (E11 honesty): headless session simulation at scale
 * over @playliquid/simulation's PUBLIC entrypoint — the REAL
 * SimulationSession (deterministic fixed-tick kernel, seeded RNG port,
 * append-only event log) with the package's own demo binding, fixed
 * clock and in-memory snapshot store:
 *
 * 1. SESSION SCALE: 500 sessions x (construct + seeded load + 20 steps)
 *    — sessions/sec, steps/sec and the heapUsed footprint delta.
 * 2. STEP THROUGHPUT: one deep session driven 10,000 fixed ticks —
 *    steps/sec at the kernel's steady state.
 *
 * The workload is fixed-seed; its shape digest (descriptor + observed
 * end state) is asserted stable across a small repeat (deterministic
 * workload, machine-dependent timings).
 */

import {
  FixedClock,
  InMemorySnapshotStore,
  SimulationSession,
  demoGameBinding,
  demoSeed,
} from "../../../packages/simulation/src/index.ts";
import { PERFORMANCE_BUDGETS } from "./budgets.ts";
import type { MetricMeasurement } from "./budgets.ts";
import { heapMb, logMetric, nowMs, shapeDigestOf } from "./perf-kit.ts";

const SESSIONS = 500;
const STEPS_PER_SESSION = 20;
const DEEP_STEPS = 10_000;

/** One seeded, loaded simulation session over the public surface. */
function makeSession(variant: number): SimulationSession {
  const sessionId = `perf-sim-${variant}`;
  const binding = demoGameBinding(sessionId);
  const session = new SimulationSession({
    sessionId: sessionId as never,
    binding,
    ports: { clock: new FixedClock([1000]), snapshotStore: new InMemorySnapshotStore() },
  });
  const loaded = session.load({
    op: "load",
    sessionId: session.sessionId,
    game: binding.game,
    role: "simulation",
    determinism: demoSeed(variant % 4),
  });
  if (loaded.status !== "loaded") throw new Error(`sim session ${variant} did not load: ${String(loaded.status)}`);
  return session;
}

/** Runs the session-scale workload; returns metrics + the observed state. */
function runSessionScale(): { metrics: MetricMeasurement[]; observed: unknown[] } {
  const before = heapMb();
  const started = nowMs();
  const observed: unknown[] = [];
  for (let i = 0; i < SESSIONS; i += 1) {
    const session = makeSession(i);
    const stepped = session.step({ op: "step", sessionId: session.sessionId, ticks: STEPS_PER_SESSION });
    if (stepped.status !== "stepped") throw new Error(`step refused for session ${i}: ${String(stepped.status)}`);
    observed.push(session.view());
  }
  const elapsed = nowMs() - started;
  const heapDelta = heapMb() - before;
  const totalSteps = SESSIONS * STEPS_PER_SESSION;
  logMetric("simulation session scale", `500 sessions x (create + seeded load + 20 steps)`, elapsed, SESSIONS, `heapUsed delta ${heapDelta.toFixed(1)}MB | ${((totalSteps * 1000) / elapsed).toLocaleString("en-US", { maximumFractionDigits: 0 })} steps/s`);
  const metrics: MetricMeasurement[] = [
    {
      metric: "simulation.sessionScale",
      scale: `${String(SESSIONS)} sessions x (create + seeded load + ${String(STEPS_PER_SESSION)} steps)`,
      count: SESSIONS,
      measuredMs: elapsed,
      budgetMs: PERFORMANCE_BUDGETS.simulation.sessionScaleMs,
      detail: `heapUsed delta ${heapDelta.toFixed(1)}MB (informational, no forced GC); ${String(Math.round((totalSteps * 1000) / elapsed))} steps/s`,
    },
    {
      metric: "simulation.sessionHeap",
      scale: "heapUsed delta across the 500-session workload",
      count: 1,
      measuredMs: heapDelta,
      budgetMs: PERFORMANCE_BUDGETS.simulation.sessionHeapMb,
      unit: "MB",
      detail: "footprint guard (no forced GC; informational bound)",
    },
  ];
  return { metrics, observed };
}

/** Runs the deep-session workload. */
function runDeepSteps(): { metrics: MetricMeasurement[]; observed: unknown } {
  const session = makeSession(99);
  const started = nowMs();
  const result = session.step({ op: "step", sessionId: session.sessionId, ticks: DEEP_STEPS });
  const elapsed = nowMs() - started;
  if (result.status !== "stepped") throw new Error(`deep step refused: ${String(result.status)}`);
  logMetric("simulation step throughput", "1 deep session x 10,000 fixed ticks", elapsed, DEEP_STEPS);
  return {
    metrics: [
      {
        metric: "simulation.deepSteps",
        scale: "one seeded session, 10,000 fixed ticks",
        count: DEEP_STEPS,
        measuredMs: elapsed,
        budgetMs: PERFORMANCE_BUDGETS.simulation.deepStepsMs,
        detail: `${String(Math.round((DEEP_STEPS * 1000) / elapsed))} steps/s`,
      },
    ],
    observed: session.view(),
  };
}

/** The full suite measurement (both workloads + the determinism repeat). */
export function measureSimulation(): {
  readonly suite: string;
  readonly metrics: readonly MetricMeasurement[];
  readonly shapeDigest: string;
  readonly determinism: { readonly repeated: boolean; readonly digest: string };
} {
  const scaleRun = runSessionScale();
  const deepRun = runDeepSteps();
  // Determinism: the same small program run twice must observe the same state.
  const program = (): string => {
    const observed: unknown[] = [];
    for (let i = 0; i < 8; i += 1) {
      const session = makeSession(i);
      session.step({ op: "step", sessionId: session.sessionId, ticks: 15 });
      observed.push(session.view());
    }
    return shapeDigestOf({
      suite: "qa/performance/simulation",
      binding: "demoGameBinding",
      seedCycle: 4,
      sessions: 8,
      steps: 15,
      observed,
    });
  };
  const digestA = program();
  const digestB = program();
  if (digestA !== digestB) throw new Error("simulation determinism violated: repeat digests differ");
  const shapeDigest = shapeDigestOf({
    suite: "qa/performance/simulation",
    workloads: {
      sessionScale: { sessions: SESSIONS, stepsPerSession: STEPS_PER_SESSION, seedCycle: 4 },
      deep: { sessions: 1, ticks: DEEP_STEPS },
    },
    deepObserved: deepRun.observed,
    sampleObserved: scaleRun.observed.slice(0, 3),
  });
  return {
    suite: "simulation",
    metrics: [...scaleRun.metrics, ...deepRun.metrics],
    shapeDigest,
    determinism: { repeated: true, digest: digestA },
  };
}
