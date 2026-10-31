/**
 * World dispatch tests (PLX-ARCH-003, ACR-001 Phase B): the pure
 * (worldKind, targetProfile)-aware routing projection — kind/profile
 * INDEPENDENCE (the ACR's core decision), legacy compatibility, and the
 * runtime-door admission rule.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchSparkWorld, sparkRuntimeAdmitsWorld } from "./dispatch.ts";
import type { SparkWorldDispatch } from "./dispatch.ts";
import { fixtureSparkDocument } from "./fixtures.ts";
import type { GameIRDocument } from "@playliquid/game-ir";
import { WORLD_KINDS } from "@playliquid/game-contracts";
import type { TargetProfile, WorldKind } from "@playliquid/game-contracts";

const NON_SPARK_DELIVERIES: readonly TargetProfile[] = [
  "web",
  "desktop",
  "mobile",
  "xr",
  "dedicated_server",
  "simulation",
];

/** A fixture document carrying an explicit world declaration. */
function declaredDocument(kind: WorldKind | undefined, targetProfile: TargetProfile | undefined): GameIRDocument {
  const document = fixtureSparkDocument();
  const world: { kind?: WorldKind; targetProfile?: TargetProfile } = {};
  if (kind !== undefined) world.kind = kind;
  if (targetProfile !== undefined) world.targetProfile = targetProfile;
  return { ...document, world };
}

test("dispatch: a legacy document with no world declaration is legacy-undeclared, kind game", () => {
  const document = fixtureSparkDocument();
  assert.equal(document.world, undefined);
  const dispatch = dispatchSparkWorld(document);
  assert.deepEqual(dispatch, { routing: "legacy-undeclared", worldKind: "game", targetProfile: null });
  assert.equal(sparkRuntimeAdmitsWorld(document), true);
});

test("dispatch: an empty world declaration is still legacy-undeclared (both dimensions optional)", () => {
  const dispatch = dispatchSparkWorld({ ...fixtureSparkDocument(), world: {} });
  assert.deepEqual(dispatch, { routing: "legacy-undeclared", worldKind: "game", targetProfile: null });
});

test("dispatch: EVERY world kind with declared spark_vertical routes through the spark runtime (ACR-001 §2)", () => {
  for (const kind of WORLD_KINDS) {
    const dispatch = dispatchSparkWorld(declaredDocument(kind, "spark_vertical"));
    assert.deepEqual(
      dispatch,
      { routing: "spark-vertical", worldKind: kind, targetProfile: "spark_vertical" },
      `kind ${kind} must route spark_vertical regardless of content kind`,
    );
    assert.equal(sparkRuntimeAdmitsWorld(declaredDocument(kind, "spark_vertical")), true);
  }
});

test("dispatch: NO non-spark delivery routes through the spark runtime, for any kind", () => {
  for (const kind of WORLD_KINDS) {
    for (const delivery of NON_SPARK_DELIVERIES) {
      const dispatch = dispatchSparkWorld(declaredDocument(kind, delivery));
      assert.deepEqual(
        dispatch,
        { routing: "other-delivery", worldKind: kind, targetProfile: delivery },
        `kind ${kind} + delivery ${delivery} must NOT route here`,
      );
      assert.equal(sparkRuntimeAdmitsWorld(declaredDocument(kind, delivery)), false);
    }
  }
});

test("dispatch: a spark-KIND world with a declared web delivery does NOT route here (dual citizenship)", () => {
  // The ACR's sharpest edge: Spark is both a World kind and a delivery
  // profile, and neither implies the other.
  const dispatch = dispatchSparkWorld(declaredDocument("spark", "web"));
  assert.deepEqual(dispatch, { routing: "other-delivery", worldKind: "spark", targetProfile: "web" });
  assert.equal(sparkRuntimeAdmitsWorld(declaredDocument("spark", "web")), false);
});

test("dispatch: the resolved kind defaults to game when only the delivery is declared", () => {
  const dispatch: SparkWorldDispatch = dispatchSparkWorld(declaredDocument(undefined, "spark_vertical"));
  assert.deepEqual(dispatch, { routing: "spark-vertical", worldKind: "game", targetProfile: "spark_vertical" });
});

test("dispatch: the projection is pure — same document, same verdict (E9 discipline)", () => {
  const document = declaredDocument("digital_twin", "spark_vertical");
  assert.deepEqual(dispatchSparkWorld(document), dispatchSparkWorld(document));
});
