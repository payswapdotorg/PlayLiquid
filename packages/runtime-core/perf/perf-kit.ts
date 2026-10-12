/**
 * Shared helpers for the runtime-core perf suites (PL-042).
 *
 * Every symbol the suites use comes from the package's PUBLIC entrypoint
 * (../src/index.ts) — no deep imports, no sibling packages. Node builtins
 * only (node:crypto for digest evidence, node:perf_hooks for timing).
 *
 * Determinism discipline (E9): each suite builds its workload from fixed
 * seeds/shapes and derives a WORKLOAD SHAPE DIGEST (sha256 over a local
 * canonical JSON of the workload descriptor + the observed end state).
 * The digest is stable across repeats even though timings are not — the
 * suites assert exactly that.
 *
 * HONESTY (E11): timings are wall-clock measurements on THIS box, taken
 * with performance.now(); heap numbers are process.memoryUsage() deltas
 * WITHOUT forced GC (informational footprint, not an exact residency
 * bound). Nothing here is extrapolated.
 */

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemorySnapshotStore,
  ManualClock,
  createInteractiveRuntime,
  interactiveDescriptor,
} from "../src/index.ts";
import type { InteractiveRuntimeKernel, KernelLimits } from "../src/index.ts";
import type { CounterWorld } from "../src/index.ts";

/** Canonical JSON (sorted keys; the repo's own canonicalization rules). */
export function canonicalJsonOf(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((entry) => serialize(entry)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(",")}}`;
    }
    default:
      throw new Error(`cannot canonicalize ${String(typeof value)}`);
  }
}

/** The workload shape digest: sha256 hex of the canonical form. */
export function shapeDigestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJsonOf(value), "utf8").digest("hex");
}

/** Wall-clock now in fractional milliseconds. */
export function nowMs(): number {
  return performance.now();
}

/** Mean of a non-empty sample set. */
export function meanOf(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error("mean of empty sample set");
  return samples.reduce((total, value) => total + value, 0) / samples.length;
}

/** Percentile by nearest-rank over sorted samples (p in (0, 100]). */
export function percentileOf(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error("percentile of empty sample set");
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

/** Ops per second given a count and elapsed ms. */
export function rateOf(count: number, elapsedMs: number): number {
  return elapsedMs <= 0 ? Number.POSITIVE_INFINITY : (count * 1000) / elapsedMs;
}

/** Heap snapshot (MB) for footprint deltas (no forced GC — informational). */
export function heapMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

/** Logs one measured metric line (the suite's observable evidence). */
export function logMetric(metric: string, scale: string, elapsedMs: number, count: number, extra = ""): void {
  const rate = rateOf(count, elapsedMs).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const detail = extra === "" ? "" : ` ${extra}`;
  console.log(`[perf] ${metric} | ${scale} | ${count.toLocaleString("en-US")} ops | ${elapsedMs.toFixed(1)} ms | ${rate} ops/s${detail}`);
}

/**
 * One interactive session kit over the package's own fakes (the PUBLIC
 * test-support surface): manual clock, volatile snapshot store, the
 * grant-table CapabilityPort seam and the reference counter driver.
 */
export function makePerfSession(
  sessionId: string,
  options: { readonly seed?: string; readonly limits?: Partial<KernelLimits> } = {},
): InteractiveRuntimeKernel<CounterWorld> {
  const clock = new ManualClock(0);
  const broker = new GrantTableCapabilityPort({
    capabilityIntentKinds: {},
    intentCommandKinds: { "world.increment": "world.increment", "world.move": "world.move" },
    clock,
  });
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor(sessionId, options.seed),
    driver: new CounterWorldDriver(),
    capabilityPort: broker,
    snapshotStore: new InMemorySnapshotStore(),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  if (created.status !== "created") {
    throw new Error(`perf session ${sessionId} was refused: ${created.detail}`);
  }
  return created.kernel;
}

/** One player-origin `world.increment` act input (unique nonce per call). */
export function playerIncrementAct(n: number, by = 1) {
  return {
    intent: {
      intentId: `perf-intent-${n}` as never,
      kind: "world.increment" as never,
      actor: { actorClass: "player" as const, actorId: "perf-player-1" as never },
      payload: { by },
      issuedAt: 0 as never,
    },
    nonce: `perf-nonce-${n}` as never,
  };
}

/** The observable end state of one kernel (the determinism projection). */
export function stateProjectionOf(kernel: InteractiveRuntimeKernel<CounterWorld>): Record<string, number> {
  const view = kernel.view();
  return {
    committedEventSeq: Number(view.committedEventSeq),
    admittedCommandSeq: Number(view.admittedCommandSeq),
    tick: Number(view.tick),
    epoch: Number(view.epoch),
  };
}
