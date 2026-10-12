/**
 * qa/performance — shared measurement helpers (PL-042).
 *
 * The suites import ONLY the public entrypoints of the systems under test
 * (relative paths into each package's src/index.ts — the PL-033 qa-mount
 * precedent: this tree carries no package.json/workspace importer). Node
 * builtins only (crypto for digest evidence, perf_hooks for timing, os
 * for the environment header).
 *
 * Determinism discipline (E9): every suite builds its workload from
 * fixed seeds/shapes and derives a WORKLOAD SHAPE DIGEST (sha256 over a
 * local canonical JSON of the workload descriptor + observed end state);
 * each suite asserts the digest is stable across a small repeat even
 * though timings are machine-dependent.
 *
 * HONESTY (E11): timings are wall-clock measurements on THIS box;
 * nothing is extrapolated; heap numbers are memoryUsage() deltas
 * without forced GC.
 */

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import os from "node:os";

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

/** HeapUsed snapshot (MB) for footprint deltas (no forced GC — informational). */
export function heapMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

/** The environment header every baseline report carries (E11 honesty). */
export function environmentHeader(): Record<string, string | number> {
  return {
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
  };
}

/** Logs one measured metric line (the suite's observable evidence). */
export function logMetric(metric: string, scale: string, elapsedMs: number, count: number, extra = ""): void {
  const rate = rateOf(count, elapsedMs).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const detail = extra === "" ? "" : ` ${extra}`;
  console.log(`[perf] ${metric} | ${scale} | ${count.toLocaleString("en-US")} ops | ${elapsedMs.toFixed(1)} ms | ${rate} ops/s${detail}`);
}
