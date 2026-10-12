/**
 * Boot-plan tests (R6 minimal critical boot; E9 determinism): critical
 * vs deferred derivation, budget planning, digest stability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { planSparkBoot } from "./boot-plan.ts";
import { fixtureCostModel, fixtureSparkDocument, fixtureSparkProfile } from "./fixtures.ts";

test("the plan splits minimal critical boot from the deferred remainder", () => {
  const result = planSparkBoot(fixtureSparkDocument(), fixtureSparkProfile(), fixtureCostModel());
  assert.equal(result.ok, true);
  const { plan } = result;
  const criticalKinds = plan.criticalUnits.map((unit) => unit.unitId);
  assert.deepEqual(criticalKinds, [
    "world-spark-node",
    "scene-entry-node",
    "entity-hero-node",
    "rule-hero-motion",
    "event-spawned-node",
    "event-moved-node",
    "capability-replay-node",
    "avatar-binding-hero",
  ]);
  assert.deepEqual(
    plan.deferredUnits.map((unit) => unit.unitId),
    ["scene-later-node", "entity-later-node", "world-second-node", "scene-second-node", "entity-second-node", "rule-second"],
  );
  assert.equal(plan.entrySceneId, "scene-entry");
  assert.equal(plan.entryWorldId, "world-spark-node");
});

test("the world and entry scene are first-paint; the rest is first-interaction", () => {
  const result = planSparkBoot(fixtureSparkDocument(), fixtureSparkProfile(), fixtureCostModel());
  if (!result.ok) throw new Error("unreachable");
  const byClassification = result.plan.criticalUnits.map((unit) => `${unit.unitId}:${unit.classification}`);
  assert.equal(byClassification[0], "world-spark-node:first-paint");
  assert.equal(byClassification[1], "scene-entry-node:first-paint");
  for (const entry of byClassification.slice(2)) {
    assert.match(entry, /:first-interaction$/);
  }
  for (let index = 1; index < result.plan.criticalUnits.length; index += 1) {
    assert.equal(result.plan.criticalUnits[index]?.order, index + 1);
  }
});

test("boot order is deterministic and the plan digest is stable (E9)", () => {
  const first = planSparkBoot(fixtureSparkDocument(), fixtureSparkProfile(), fixtureCostModel());
  const second = planSparkBoot(fixtureSparkDocument(), fixtureSparkProfile(), fixtureCostModel());
  if (!first.ok || !second.ok) throw new Error("unreachable");
  assert.equal(first.plan.planDigest, second.plan.planDigest);
  assert.deepEqual(first.plan.criticalUnits.map((unit) => unit.unitId), second.plan.criticalUnits.map((unit) => unit.unitId));
  assert.deepEqual(
    first.plan.deferredUnits.map((unit) => unit.streamPriority),
    second.plan.deferredUnits.map((unit) => unit.streamPriority),
  );
  // The digest input is plan content only — document metadata outside the
  // plan (lifecycle state here) and TENANT (nowhere in the input) never
  // move it; tenant isolation is the runtime's concern (R20), not the
  // digest's.
  const third = planSparkBoot(
    { ...fixtureSparkDocument(), lifecycle: "released" },
    fixtureSparkProfile(),
    fixtureCostModel(),
  );
  if (!third.ok) throw new Error("unreachable");
  assert.equal(third.plan.planDigest, first.plan.planDigest);
});

test("budget planning derives byte and millisecond figures from the cost model", () => {
  const result = planSparkBoot(fixtureSparkDocument(), fixtureSparkProfile(), { bytesPerMillisecond: 1 });
  if (!result.ok) throw new Error("unreachable");
  const { budgets } = result.plan;
  assert.equal(budgets.criticalBytes, budgets.firstPaintBytes + result.plan.criticalUnits
    .filter((unit) => unit.classification === "first-interaction")
    .reduce((sum, unit) => sum + unit.bytes, 0));
  assert.equal(budgets.plannedFirstPaintMs, Math.ceil(budgets.firstPaintBytes / 1));
  assert.equal(budgets.plannedFirstInteractionMs, Math.ceil(budgets.criticalBytes / 1));
  assert.equal(budgets.firstPaintTargetMs, 1_500);
  assert.equal(budgets.firstInteractionTargetMs, 2_500);
  assert.ok(budgets.criticalBytes < budgets.firstInteractionTargetMs);
});

test("different content produces a different plan digest (content addressing)", () => {
  const base = planSparkBoot(fixtureSparkDocument(), fixtureSparkProfile(), fixtureCostModel());
  const mutated = planSparkBoot(
    { ...fixtureSparkDocument(), entry: { world: "world-second" as never, scene: "scene-second" as never } },
    fixtureSparkProfile(),
    fixtureCostModel(),
  );
  if (!base.ok || !mutated.ok) throw new Error("unreachable");
  assert.notEqual(base.plan.planDigest, mutated.plan.planDigest);
  assert.equal(mutated.plan.entrySceneId, "scene-second");
});

test("different profiles produce different plan digests", () => {
  const base = planSparkBoot(fixtureSparkDocument(), fixtureSparkProfile(), fixtureCostModel());
  const stricter = planSparkBoot(
    fixtureSparkDocument(),
    fixtureSparkProfile({ boot: { entries: fixtureSparkProfile().boot.entries, firstPaintTargetMs: 10, firstInteractionTargetMs: 20 } }),
    fixtureCostModel(),
  );
  if (!base.ok || !stricter.ok) throw new Error("unreachable");
  assert.notEqual(base.plan.planDigest, stricter.plan.planDigest);
});
