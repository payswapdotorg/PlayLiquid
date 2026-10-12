/**
 * SERVICE TESTS (PL-030) — the state owner: append-only learning with E10
 * duplicate receipts, tenant scoping (R20), tamper discipline (E8),
 * persistence round-trips (E6) and the no-rewrite surface (E10).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { verifyLearningRecord } from "./digest.ts";
import { LabLearningService } from "./service.ts";
import { createFixedClock, createLearningStore } from "./fakes.ts";
import { cycleSubmission, secondSubmission, testSubmission } from "./testkit.ts";

const tenant = testSubmission().tenant;
const owner = testSubmission().owner;
const caller = { tenant, subject: owner };
const foreign = { tenant: asTenantId("tenant-service-foreign")!, subject: asSubjectId("subject-foreign")! };

function service() {
  const clock = createFixedClock();
  const store = createLearningStore();
  return {
    clock,
    store,
    learning: new LabLearningService({ ports: { clock: clock.clock, store: store.store } }),
  };
}

function learned() {
  const stack = service();
  const first = stack.learning.learnCycle(testSubmission());
  assert.ok(first.ok);
  return { stack, first };
}

test("service: learnCycle appends one sealed record and persists one document", () => {
  const { stack, first } = learned();
  assert.equal(first.duplicate, false);
  assert.equal(stack.learning.listLearningCycles(caller).length, 1);
  assert.equal(stack.store.documents().length, 1);
  assert.ok(Object.isFrozen(first.record));
});

test("service: re-learning identical content returns the E10 receipt without a second copy", () => {
  const { stack, first } = learned();
  const again = stack.learning.learnCycle(testSubmission());
  assert.ok(again.ok);
  assert.equal(again.duplicate, true);
  assert.equal(again.record.recordId, first.record.recordId);
  assert.equal(stack.learning.listLearningCycles(caller).length, 1);
  assert.equal(stack.store.documents().length, 1);
});

test("service: there is no update, revise or rewrite door anywhere (E10)", () => {
  const { learning } = service();
  const surface = learning as unknown as Record<string, unknown>;
  for (const forbidden of ["updateLearningCycle", "reviseLearningCycle", "rewriteLearningCycle", "deleteLearningCycle", "unlearnCycle", "editRecord"]) {
    assert.equal(surface[forbidden], undefined, `${forbidden} must not exist`);
  }
  assert.equal(typeof learning.learnCycle, "function");
});

test("service: records read by record id and by cycle id; unknown ids refuse typed", () => {
  const { stack, first } = learned();
  const byId = stack.learning.getLearningCycle(first.record.recordId, caller);
  assert.ok(byId.ok);
  const byCycle = stack.learning.getLearningCycle(String(first.record.cycleId), caller);
  assert.ok(byCycle.ok);
  assert.equal(byCycle.record.recordId, byId.record.recordId);
  const unknown = stack.learning.getLearningCycle("lab-learn-0000000000000000000000000000000000000000000000000000", caller);
  assert.ok(!unknown.ok && unknown.code === "cycle-record-unknown");
  const unknownCycle = stack.learning.getLearningCycle("cycle-never-learned", caller);
  assert.ok(!unknownCycle.ok && unknownCycle.code === "cycle-record-unknown");
});

test("service: cross-tenant reads are a typed refusal (R20, E8)", () => {
  const { stack, first } = learned();
  const read = stack.learning.getLearningCycle(first.record.recordId, foreign);
  assert.ok(!read.ok);
  assert.equal(read.code, "cross-tenant");
  assert.ok(read.detail.includes("R20"));
  assert.equal(stack.learning.listLearningCycles(foreign).length, 0);
});

test("service: a foreign caller's signals and guidance fold their OWN (empty) state (R20)", () => {
  const { stack } = learned();
  const signals = stack.learning.deriveSignals(foreign);
  assert.ok(signals.ok);
  assert.equal(signals.signals.recordCount, 0);
  const guidance = stack.learning.deriveSearchGuidance(foreign, { mode: "with-estimates" });
  assert.ok(guidance.ok);
  assert.equal(guidance.guidance.cycleCount, 0);
  assert.equal(guidance.guidance.baseline.direction, "insufficient-evidence");
});

test("service: multi-tenant records coexist without cross-tenant leakage (R20)", () => {
  const stack = service();
  const mine = stack.learning.learnCycle(testSubmission());
  const otherTenant = asTenantId("tenant-service-other")!;
  const theirs = stack.learning.learnCycle({
    ...testSubmission(),
    cycleId: testSubmission().cycleId,
    evaluations: [{ ...testSubmission().evaluations[0]!, tenant: otherTenant }],
    tenant: otherTenant,
  });
  assert.ok(mine.ok && theirs.ok);
  assert.equal(stack.learning.listLearningCycles(caller).length, 1);
  assert.equal(stack.learning.listLearningCycles({ tenant: otherTenant, subject: asSubjectId("subject-other")! }).length, 1);
});

test("service: sequences only move forward across learns (E8)", () => {
  const { stack } = learned();
  const second = stack.learning.learnCycle(secondSubmission());
  assert.ok(second.ok);
  const regressed = stack.learning.learnCycle(cycleSubmission("cycle-lab-learning-test-3", 1));
  assert.ok(!regressed.ok && regressed.code === "non-monotonic-cycle-order");
  assert.equal(stack.learning.listLearningCycles(caller).length, 2);
});

test("service: signals derive deterministically across instances (E9)", () => {
  const { stack } = learned();
  stack.learning.learnCycle(secondSubmission());
  const first = stack.learning.deriveSignals(caller);
  const again = stack.learning.deriveSignals(caller);
  assert.ok(first.ok && again.ok);
  assert.equal(String(first.signals.stateDigest), String(again.signals.stateDigest));
  const restored = new LabLearningService({ ports: { clock: stack.clock.clock, store: stack.store.store } });
  const roundTrip = restored.restore();
  assert.ok(roundTrip.ok && roundTrip.count === 2);
  const after = restored.deriveSignals(caller);
  assert.ok(after.ok);
  assert.equal(String(after.signals.stateDigest), String(first.signals.stateDigest));
});

test("service: the gap door returns recurring summaries with counts (R18)", () => {
  const { stack } = learned();
  stack.learning.learnCycle(secondSubmission());
  const summaries = stack.learning.summarizeGaps(caller);
  const recurring = summaries.find((summary) => summary.missingCapability === "lab-cap-engineering");
  assert.ok(recurring);
  assert.equal(recurring.recurrenceCount, 2);
  assert.equal(recurring.recurring, true);
});

test("service: the guidance door verifies freshly derived guidance and refuses stripped markers (E11)", () => {
  const { stack } = learned();
  const derived = stack.learning.deriveSearchGuidance(caller, { mode: "with-estimates" });
  assert.ok(derived.ok);
  const verified = stack.learning.verifyGuidance(caller, { mode: "with-estimates", guidance: derived.guidance });
  assert.ok(verified.ok && verified.matches);
  const stripped = { ...derived.guidance, epistemic: "observed-evidence" as const };
  const refused = stack.learning.verifyGuidance(caller, { mode: "with-estimates", guidance: stripped });
  assert.ok(!refused.ok && refused.code === "guidance-marker-forged");
});

test("service: restore refuses tampered persisted content (E8, E10)", () => {
  const { stack, first } = learned();
  const tampered = { ...first.record, outcomes: [{ ...first.record.outcomes[0]!, summary: "rewritten history" }] };
  assert.equal(verifyLearningRecord(tampered), false);
  const tamperStore = createLearningStore();
  tamperStore.store.save({ ...stack.learning.document(), records: [tampered] });
  const victim = new LabLearningService({ ports: { clock: stack.clock.clock, store: tamperStore.store } });
  const restored = victim.restore();
  assert.ok(!restored.ok);
  assert.equal(restored.code, "tampered-content-digest");
});

test("service: restore without a persisted document is a typed refusal (E6)", () => {
  const stack = service();
  const restored = stack.learning.restore();
  assert.ok(!restored.ok);
  assert.equal(restored.code, "no-persisted-document");
});

test("service: refused commands mutate nothing (no partial writes)", () => {
  const { stack } = learned();
  const before = stack.learning.document();
  const refused = stack.learning.learnCycle({ ...testSubmission(), sequence: 0 });
  assert.ok(!refused.ok && refused.code === "invalid-sequence");
  const after = stack.learning.document();
  assert.equal(before.stateDigest, after.stateDigest);
  assert.equal(stack.store.documents().length, 1);
});

test("service: the document is content-addressed and stable per state (E6)", () => {
  const { stack } = learned();
  const a = stack.learning.document();
  const b = stack.learning.document();
  assert.equal(a.stateDigest, b.stateDigest);
  assert.match(a.stateDigest, /^[0-9a-f]{64}$/);
  stack.learning.learnCycle(secondSubmission());
  const grown = stack.learning.document();
  assert.notEqual(grown.stateDigest, a.stateDigest);
});
