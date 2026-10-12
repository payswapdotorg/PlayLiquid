/**
 * Stream-schedule tests (R6 progressive streaming; E9 determinism; E8
 * cycle/contradiction refusals): derivation, validation, tampering.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { planSparkBoot } from "./boot-plan.ts";
import { scheduleSparkStreams, sparkScheduleDigestOf, validateSparkSchedule } from "./stream-schedule.ts";
import type { SparkStreamSchedule } from "./stream-schedule.ts";
import { fixtureCostModel, fixtureSparkDocument, fixtureSparkProfile } from "./fixtures.ts";

function derivedPlan() {
  const plan = planSparkBoot(fixtureSparkDocument(), fixtureSparkProfile(), fixtureCostModel());
  if (!plan.ok) throw new Error(JSON.stringify(plan.rejections));
  return plan.plan;
}

function derivedSchedule(plan = derivedPlan(), maxConcurrentStreams = 2): SparkStreamSchedule {
  const schedule = scheduleSparkStreams(plan, fixtureSparkProfile({ maxConcurrentStreams }));
  if (!schedule.ok) throw new Error(schedule.message);
  return schedule;
}

test("the deferred remainder schedules in priority order, batched by concurrency", () => {
  const schedule = derivedSchedule();
  assert.equal(schedule.kind, "spark-stream-schedule");
  assert.equal(schedule.maxConcurrentStreams, 2);
  assert.deepEqual(
    schedule.batches.map((batch) => batch.units.map((unit) => unit.unitId)),
    [
      ["scene-later-node", "entity-later-node"],
      ["world-second-node", "scene-second-node"],
      ["entity-second-node", "rule-second"],
    ],
  );
  for (const batch of schedule.batches) {
    assert.ok(batch.units.length <= schedule.maxConcurrentStreams);
  }
  assert.deepEqual(
    schedule.batches.flatMap((batch) => batch.units.map((unit) => unit.streamPriority)),
    [0, 1, 2, 3, 4, 5],
  );
});

test("the derived schedule validates against its plan (content-derived order)", () => {
  const plan = derivedPlan();
  const schedule = derivedSchedule(plan);
  assert.equal(validateSparkSchedule(schedule, plan), true);
});

test("schedule digests are deterministic and re-computable (E9/E10)", () => {
  const first = derivedSchedule();
  const second = derivedSchedule();
  assert.equal(first.scheduleDigest, second.scheduleDigest);
  assert.equal(sparkScheduleDigestOf(first), first.scheduleDigest);
  assert.deepEqual(
    first.batches.map((batch) => batch.batchDigest),
    second.batches.map((batch) => batch.batchDigest),
  );
});

test("a tampered schedule digest is refused (content tamper, E8)", () => {
  const plan = derivedPlan();
  const schedule = derivedSchedule(plan);
  const tampered: SparkStreamSchedule = { ...schedule, scheduleDigest: `sha256:${"0".repeat(64)}` };
  const refusal = validateSparkSchedule(tampered, plan);
  if (refusal === true) throw new Error("expected a refusal");
  assert.equal(refusal.code, "schedule/digest-mismatch");
});

test("rescheduling a critical unit is a contradiction refusal (E8)", () => {
  const plan = derivedPlan();
  const schedule = derivedSchedule(plan);
  const criticalUnit = plan.criticalUnits[0]!;
  const contradictory: SparkStreamSchedule = {
    ...schedule,
    batches: [
      { batchIndex: 0, units: [{ ...criticalUnit, after: null, streamPriority: 99 }], batchDigest: `sha256:${"1".repeat(64)}` },
      ...schedule.batches,
    ],
  };
  const refusal = validateSparkSchedule(contradictory, plan);
  if (refusal === true) throw new Error("expected a refusal");
  assert.equal(refusal.code, "schedule/critical-unit-rescheduled");
});

test("an after-dependency cycle is refused before positional checks (E8)", () => {
  const plan = derivedPlan();
  const schedule = derivedSchedule(plan);
  const first = schedule.batches[0]!;
  const rest = schedule.batches.slice(1);
  // Hand-tamper the first batch into a two-unit cycle: each must follow the other.
  const units = [
    { ...first.units[0]!, after: first.units[1]!.unitId },
    { ...first.units[1]!, after: first.units[0]!.unitId },
  ];
  const cyclic: SparkStreamSchedule = {
    ...schedule,
    batches: [{ batchIndex: first.batchIndex, units, batchDigest: first.batchDigest }, ...rest],
  };
  const refusal = validateSparkSchedule(cyclic, plan);
  if (refusal === true) throw new Error("expected a refusal");
  assert.equal(refusal.code, "schedule/dependency-cycle");
});

test("a unit streaming before its dependency is refused (E8)", () => {
  const plan = derivedPlan();
  const schedule = derivedSchedule(plan);
  const first = schedule.batches[0]!;
  const rest = schedule.batches.slice(1);
  const swapped = [...first.units].reverse();
  const violated: SparkStreamSchedule = {
    ...schedule,
    batches: [{ batchIndex: first.batchIndex, units: swapped, batchDigest: first.batchDigest }, ...rest],
  };
  const refusal = validateSparkSchedule(violated, plan);
  if (refusal === true) throw new Error("expected a refusal");
  assert.equal(refusal.code, "schedule/dependency-violation");
});

test("duplicate scheduling is refused (E8)", () => {
  const plan = derivedPlan();
  const wide = derivedSchedule(plan, 7);
  const first = wide.batches[0]!;
  const rest = wide.batches.slice(1);
  const duplicated: SparkStreamSchedule = {
    ...wide,
    batches: [{ batchIndex: first.batchIndex, units: [...first.units, first.units[0]!], batchDigest: first.batchDigest }, ...rest],
  };
  const refusal = validateSparkSchedule(duplicated, plan);
  if (refusal === true) throw new Error("expected a refusal");
  assert.equal(refusal.code, "schedule/duplicate-unit");
});

test("batch overflow is refused (E8)", () => {
  const plan = derivedPlan();
  const schedule = derivedSchedule(plan, 2);
  const overflow: SparkStreamSchedule = { ...schedule, maxConcurrentStreams: 1 };
  const refusal = validateSparkSchedule(overflow, plan);
  if (refusal === true) throw new Error("expected a refusal");
  assert.equal(refusal.code, "schedule/batch-overflow");
});

test("an unknown unit is refused (E8)", () => {
  const plan = derivedPlan();
  const schedule = derivedSchedule(plan);
  const unknown: SparkStreamSchedule = {
    ...schedule,
    batches: [
      { batchIndex: 0, units: [{ ...schedule.batches[0]!.units[0]!, unitId: "ghost-node" }], batchDigest: `sha256:${"2".repeat(64)}` },
    ],
  };
  const refusal = validateSparkSchedule(unknown, plan);
  if (refusal === true) throw new Error("expected a refusal");
  assert.equal(refusal.code, "schedule/unknown-unit");
});

test("a priority inversion across batches is refused (E8)", () => {
  const plan = derivedPlan();
  const schedule = derivedSchedule(plan, 2);
  const [first, second, ...rest] = schedule.batches;
  const inverted: SparkStreamSchedule = { ...schedule, batches: [second!, first!, ...rest] };
  const refusal = validateSparkSchedule(inverted, plan);
  if (refusal === true) throw new Error("expected a refusal");
  assert.equal(refusal.code, "schedule/priority-not-increasing");
});

test("a profile without concurrency is refused at derivation", () => {
  const plan = derivedPlan();
  const refusal = scheduleSparkStreams(plan, fixtureSparkProfile({ maxConcurrentStreams: 0 }));
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "schedule/invalid-profile");
  }
});
