/**
 * qa/performance PUBLIC ENTRYPOINT (PL-042) — the cross-system
 * performance/scale suite.
 *
 * The suites measure the REAL public surfaces of the Simulation Runtime,
 * the replay command-stream artifacts, the LATTICE large-world streaming
 * reference and the PlayCanvas engine adapter under `node --test`, with
 * workload SHAPE DIGESTS proving determinism (timings are
 * machine-dependent; workload shapes are not) and every metric asserted
 * against the budgets from src/budgets.ts (the single source of truth).
 *
 * `node run-baselines.ts` (repo: qa/performance) regenerates the
 * committed baseline reports under reports/ from the same measurement
 * functions.
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// Module manifest (PL-010 governance format)
export { qaPerformanceModule } from "./module.ts";

// The single source of truth for every enforced budget.
export { PERFORMANCE_BUDGETS } from "./budgets.ts";
export type { MetricMeasurement } from "./budgets.ts";

// The shared measurement helpers (digests, stats, environment header).
export { environmentHeader, shapeDigestOf } from "./perf-kit.ts";

// The suite measurement functions (reports + tests share these).
export { measureSimulation } from "./measure-simulation.ts";
export { measureReplay } from "./measure-replay.ts";
export { measureLargeWorld } from "./measure-large-world.ts";
export { measureEngine } from "./measure-engine.ts";
