/**
 * PROGRESSIVE STREAM EXECUTION (R6/R15; E11) — the batch executor behind
 * `SparkRuntime.streamNextBatch`, extracted from runtime.ts (max-lines
 * discipline; the house service-arcs precedent).
 *
 * ONE batch at a time, in schedule order, through the injected IO ports:
 * - a cache HIT must pin the unit it claims (a forged read is a typed
 *   `cache-refused` refusal — content tamper, E8);
 * - a MISS fetches from the content source, which MUST return bytes that
 *   hash to the unit's pinned digest (the port contract; a mismatched or
 *   refused fetch is a typed `source-refused` refusal, never silently
 *   accepted content);
 * - an admitted unit is written through the cache port under the manifest
 *   rule (admission happened BEFORE, cache.ts); a must-revalidate unit is
 *   served from the source and NEVER admitted (R15 streaming-policy
 *   authority).
 *
 * Pure executor: no phase state, no cursor — the owning runtime instance
 * owns those (single mutable-state owner, E1).
 */

import { admitSparkCacheEntry } from "./cache.ts";
import type { SparkCacheManifest } from "./cache.ts";
import type { SparkStreamBatch } from "./stream-schedule.ts";
import type { SparkCachePort, SparkContentSourcePort } from "./ports.ts";

/** One streamed unit's outcome inside a batch execution. */
export interface SparkStreamedUnitReport {
  readonly unitId: string;
  readonly action: "serve-from-cache" | "store-then-serve" | "revalidated-from-source";
}

/** A successfully executed stream batch (the runtime advances its cursor). */
export interface SparkStreamSuccess {
  readonly ok: true;
  readonly batchIndex: number;
  readonly batchDigest: string;
  readonly served: readonly SparkStreamedUnitReport[];
}

/** Why a stream batch was refused (no cursor advance, no partial state). */
export interface SparkStreamFailure {
  readonly ok: false;
  readonly code: "source-refused" | "cache-refused";
  readonly message: string;
}

/** The result of executing one schedule batch through the ports. */
export type SparkStreamExecutionResult = SparkStreamSuccess | SparkStreamFailure;

/**
 * Executes ONE schedule batch through the ports (E11 seams): per unit —
 * pinned cache read → pinned source fetch → manifest-rule admission →
 * cache write. First refusal wins; nothing is repaired.
 */
export function executeSparkStreamBatch(
  batch: SparkStreamBatch,
  manifest: SparkCacheManifest,
  contentSource: SparkContentSourcePort,
  cache: SparkCachePort,
  cacheBudgetBytes: number | undefined,
): SparkStreamExecutionResult {
  const served: SparkStreamedUnitReport[] = [];
  for (const unit of batch.units) {
    const cached = cache.read(unit.contentDigest);
    if (cached !== undefined) {
      if (cached.unitId !== unit.unitId || cached.contentDigest !== unit.contentDigest) {
        return {
          ok: false,
          code: "cache-refused",
          message: `cache returned content that does not match unit ${unit.unitId} (content tamper, E8)`,
        };
      }
      served.push({ unitId: unit.unitId, action: "serve-from-cache" });
      continue;
    }
    const fetched = contentSource.fetch(unit);
    if (!fetched.ok) {
      return { ok: false, code: "source-refused", message: `content source refused unit ${unit.unitId}: ${fetched.code} — ${fetched.message}` };
    }
    if (fetched.contentDigest !== unit.contentDigest) {
      return {
        ok: false,
        code: "source-refused",
        message: `content source returned bytes that do not match unit ${unit.unitId}'s pinned digest (content tamper, E8)`,
      };
    }
    const rule = manifest.rules.find((entry) => entry.unitId === unit.unitId);
    if (rule === undefined) {
      return { ok: false, code: "cache-refused", message: `no cache rule for unit ${unit.unitId}` };
    }
    if (rule.admission === "cache-eligible") {
      const admission = admitSparkCacheEntry(
        manifest,
        { unitId: unit.unitId, contentDigest: unit.contentDigest, bytes: fetched.bytes.length },
        { cacheBudgetBytes, currentlyCachedBytes: cache.storedBytes() },
      );
      if (!admission.ok) {
        return { ok: false, code: "cache-refused", message: `cache admission refused unit ${unit.unitId}: ${admission.code}` };
      }
      const write = cache.write({ unitId: unit.unitId, contentDigest: unit.contentDigest, bytes: fetched.bytes });
      if (write !== true) {
        return { ok: false, code: "cache-refused", message: `cache write refused unit ${unit.unitId}: ${write.message}` };
      }
      served.push({ unitId: unit.unitId, action: "store-then-serve" });
    } else {
      served.push({ unitId: unit.unitId, action: "revalidated-from-source" });
    }
  }
  return { ok: true, batchIndex: batch.batchIndex, batchDigest: batch.batchDigest, served };
}
