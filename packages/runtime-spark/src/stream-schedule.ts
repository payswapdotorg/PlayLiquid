/**
 * SPARK STREAM SCHEDULE (R6 "progressive streaming"; R15).
 *
 * The deferred remainder of a boot plan becomes a TYPED, priority-ordered,
 * content-derived stream schedule:
 *
 * - derivation (`scheduleSparkStreams`) is deterministic (E9): units keep
 *   their content-derived stream priorities, after-dependencies are
 *   respected (a scene streams after its world, an entity after its
 *   scene, a rule after its entity, an event declaration after its
 *   rule) and the ordered stream is chunked into batches of at most
 *   `profile.maxConcurrentStreams`;
 * - validation (`validateSparkSchedule`) is TOTAL over untrusted input
 *   (E8): unknown units, critical/deferred contradictions, duplicates,
 *   priority inversions, dependency violations, dependency CYCLES, batch
 *   overflows and digest tampering are typed kebab-case refusals —
 *   never silently repaired.
 *
 * Pure module: no IO, no clocks, no globals.
 */

import type { SparkTargetProfile } from "@playliquid/runtime-contracts";
import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { SparkBootPlan } from "./boot-plan.ts";
import type { SparkDeferredUnit } from "./content.ts";

/** One batch of streamable units (bounded by maxConcurrentStreams). */
export interface SparkStreamBatch {
  readonly batchIndex: number;
  readonly units: readonly SparkDeferredUnit[];
  readonly batchDigest: ContentDigest;
}

/** The typed progressive stream schedule. */
export interface SparkStreamSchedule {
  /** Discriminator: a schedule (never a refusal). */
  readonly ok: true;
  readonly kind: "spark-stream-schedule";
  readonly maxConcurrentStreams: number;
  readonly batches: readonly SparkStreamBatch[];
  readonly scheduleDigest: ContentDigest;
}

/** Typed stream-schedule refusal codes (kebab-case, E8). */
export type SparkScheduleRefusalCode =
  | "schedule/invalid-profile"
  | "schedule/empty-plan"
  | "schedule/unknown-unit"
  | "schedule/critical-unit-rescheduled"
  | "schedule/duplicate-unit"
  | "schedule/priority-not-increasing"
  | "schedule/dependency-violation"
  | "schedule/dependency-cycle"
  | "schedule/batch-overflow"
  | "schedule/digest-mismatch";

/** A typed schedule refusal. */
export interface SparkScheduleRefusal {
  readonly ok: false;
  readonly code: SparkScheduleRefusalCode;
  readonly message: string;
}

function batchDigestOf(batchIndex: number, units: readonly SparkDeferredUnit[]): ContentDigest {
  return computeDigest({
    batchIndex,
    units: units.map((unit) => ({ unitId: unit.unitId, streamPriority: unit.streamPriority, contentDigest: unit.contentDigest })),
  });
}

/**
 * Derives the schedule from a boot plan's deferred remainder (E9: the
 * content-derived priorities ARE the order; batches chunk that order).
 */
export function scheduleSparkStreams(
  plan: SparkBootPlan,
  profile: SparkTargetProfile,
): SparkStreamSchedule | SparkScheduleRefusal {
  if (
    typeof profile?.maxConcurrentStreams !== "number" ||
    !Number.isSafeInteger(profile.maxConcurrentStreams) ||
    profile.maxConcurrentStreams < 1
  ) {
    return { ok: false, code: "schedule/invalid-profile", message: "profile maxConcurrentStreams must be a safe integer >= 1" };
  }
  if (!Array.isArray(plan?.deferredUnits)) {
    return { ok: false, code: "schedule/empty-plan", message: "plan carries no deferred units" };
  }
  const ordered = [...plan.deferredUnits].sort((a, b) => a.streamPriority - b.streamPriority);
  const batches: SparkStreamBatch[] = [];
  for (let index = 0; index < ordered.length; index += profile.maxConcurrentStreams) {
    const units = ordered.slice(index, index + profile.maxConcurrentStreams);
    batches.push({
      batchIndex: batches.length,
      units,
      batchDigest: batchDigestOf(batches.length, units),
    });
  }
  return {
    ok: true,
    kind: "spark-stream-schedule",
    maxConcurrentStreams: profile.maxConcurrentStreams,
    batches,
    scheduleDigest: scheduleDigestOf(profile.maxConcurrentStreams, batches),
  };
}

function scheduleDigestOf(maxConcurrentStreams: number, batches: readonly SparkStreamBatch[]): ContentDigest {
  return computeDigest({
    kind: "spark-stream-schedule",
    maxConcurrentStreams,
    batches: batches.map((batch) => ({ batchIndex: batch.batchIndex, batchDigest: batch.batchDigest })),
  });
}

/** Recomputes a schedule's digest (tamper evidence, E8/E10). */
export function sparkScheduleDigestOf(schedule: SparkStreamSchedule): ContentDigest {
  return scheduleDigestOf(schedule.maxConcurrentStreams, schedule.batches);
}

/**
 * TOTAL validation of a (possibly untrusted) schedule against the boot
 * plan it claims to schedule (E8): contradiction and cycle family first,
 * then order, then packing, then digest integrity. First refusal wins.
 */
export function validateSparkSchedule(
  schedule: SparkStreamSchedule,
  plan: SparkBootPlan,
): true | SparkScheduleRefusal {
  const critical = new Set(plan.criticalUnits.map((unit) => unit.unitId));
  const deferred = new Map(plan.deferredUnits.map((unit) => [unit.unitId, unit]));
  const cycle = findDependencyCycle(schedule, plan);
  if (cycle !== null) {
    return { ok: false, code: "schedule/dependency-cycle", message: `dependency cycle: ${cycle.join(" -> ")}` };
  }
  const seen = new Set<string>();
  const position = new Map<string, number>();
  let previousPriority: number | null = null;
  let cursor = 0;
  for (const batch of schedule?.batches ?? []) {
    if (!Array.isArray(batch.units) || batch.units.length > schedule.maxConcurrentStreams) {
      return {
        ok: false,
        code: "schedule/batch-overflow",
        message: `batch ${String(batch?.batchIndex)} carries ${String(batch.units?.length)} units, above maxConcurrentStreams ${String(schedule?.maxConcurrentStreams)}`,
      };
    }
    for (const unit of batch.units ?? []) {
      if (critical.has(unit.unitId)) {
        return {
          ok: false,
          code: "schedule/critical-unit-rescheduled",
          message: `unit ${unit.unitId} is a CRITICAL boot unit and cannot also stream (contradiction)`,
        };
      }
      if (!deferred.has(unit.unitId)) {
        return {
          ok: false,
          code: "schedule/unknown-unit",
          message: `unit ${unit.unitId} is not a deferred unit of the plan`,
        };
      }
      if (seen.has(unit.unitId)) {
        return { ok: false, code: "schedule/duplicate-unit", message: `unit ${unit.unitId} is scheduled twice` };
      }
      seen.add(unit.unitId);
      position.set(unit.unitId, cursor);
      const unitPriority = deferred.get(unit.unitId)?.streamPriority ?? 0;
      if (previousPriority !== null && unitPriority < previousPriority) {
        return {
          ok: false,
          code: "schedule/priority-not-increasing",
          message: `unit ${unit.unitId} (priority ${String(unitPriority)}) streams after a unit of priority ${String(previousPriority)}`,
        };
      }
      previousPriority = unitPriority;
      // A deferred unit must stream AFTER its `after` dependency when that
      // dependency is itself deferred (critical units boot before any
      // streaming, so they impose no ordering constraint here).
      if (
        unit.after !== null &&
        deferred.has(unit.after) &&
        (position.get(unit.after) === undefined || position.get(unit.after)! >= cursor)
      ) {
        return {
          ok: false,
          code: "schedule/dependency-violation",
          message: `unit ${unit.unitId} streams before the unit it must follow (${unit.after})`,
        };
      }
      cursor += 1;
    }
  }
  if (schedule.scheduleDigest !== scheduleDigestOf(schedule.maxConcurrentStreams, schedule.batches)) {
    return { ok: false, code: "schedule/digest-mismatch", message: "schedule digest does not match its content (tamper evidence)" };
  }
  return true;
}

/** Detects an after-dependency cycle among the scheduled units (E8). */
function findDependencyCycle(schedule: SparkStreamSchedule, plan: SparkBootPlan): string[] | null {
  const deferred = new Map(plan.deferredUnits.map((unit) => [unit.unitId, unit]));
  const edges = new Map<string, string[]>();
  for (const batch of schedule.batches) {
    for (const unit of batch.units) {
      if (unit.after !== null && deferred.has(unit.unitId)) {
        edges.set(unit.unitId, [...(edges.get(unit.unitId) ?? []), unit.after]);
      }
    }
  }
  const state = new Map<string, number>();
  const stack: string[] = [];
  function visit(node: string): string[] | null {
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (!edges.has(next)) continue;
      if (state.get(next) === 1) {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (!state.has(next)) {
        const found = visit(next);
        if (found !== null) return found;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  }
  for (const node of edges.keys()) {
    if (!state.has(node)) {
      const found = visit(node);
      if (found !== null) return found;
    }
  }
  return null;
}
