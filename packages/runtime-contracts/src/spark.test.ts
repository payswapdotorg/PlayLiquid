/**
 * Spark target profile tests (R6, lock rule 16): 9:16 mobile-first fast-start
 * as a TARGET PROFILE — including the proof that it is NOT a game model.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asSparkProfileId,
  validateSparkProfile,
  type SparkTargetProfile,
  type TargetProfile,
} from "./spark.ts";
import { asDigest, asSessionId, asTimestamp } from "./primitives.ts";
import { asGameIrDigest, type GameRefSummary } from "./game-ir-seam.ts";

const profile = (over: Partial<SparkTargetProfile> = {}): SparkTargetProfile => ({
  profileId: asSparkProfileId("spark"),
  formFactor: "mobile-first",
  orientation: "portrait",
  aspectRatio: "9:16",
  boot: {
    entries: [
      { priority: 0, assetRef: "cas://shell", byteCeiling: 50_000, requiredFor: "first-paint" },
      { priority: 1, assetRef: "cas://hud", byteCeiling: 30_000, requiredFor: "first-interaction" },
    ],
    firstPaintTargetMs: 1_200,
    firstInteractionTargetMs: 2_000,
  },
  caching: "aggressive",
  streaming: "progressive",
  maxConcurrentStreams: 4,
  pinnedAt: asTimestamp(0),
  ...over,
});

test("a well-formed Spark profile validates", () => {
  const result = validateSparkProfile(profile());
  assert.deepEqual(result, { ok: true, entries: 2 });
});

test("type-level: wrong Spark literals cannot even be constructed", () => {
  const good = profile();
  assert.equal(good.aspectRatio, "9:16");
  // @ts-expect-error TS2322: aspectRatio is the literal "9:16"
  good.aspectRatio = "16:9";
  // @ts-expect-error TS2353/TS2322: formFactor is the literal "mobile-first"
  const desktop = profile({ formFactor: "desktop-first" });
  void desktop;
  // @ts-expect-error TS2322: orientation is the literal "portrait"
  const landscape = profile({ orientation: "landscape" });
  void landscape;
  assert.ok(true, "non-Spark literals are unrepresentable (lock 16)");
});

test("value-level: untyped wire data violating Spark literals is rejected", () => {
  const forged = {
    ...profile(),
    aspectRatio: "16:9",
  } as unknown as SparkTargetProfile;
  const result = validateSparkProfile(forged);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "not-spark-profile");
  }
});

test("boot manifest invariants: non-empty, strictly increasing, non-negative", () => {
  const empty = validateSparkProfile(
    profile({ boot: { entries: [], firstPaintTargetMs: 1, firstInteractionTargetMs: 2 } }),
  );
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.equal(empty.code, "empty-boot-manifest");
  }

  const flat = validateSparkProfile(
    profile({
      boot: {
        entries: [
          { priority: 0, assetRef: "a", byteCeiling: 1, requiredFor: "first-paint" },
          { priority: 0, assetRef: "b", byteCeiling: 1, requiredFor: "first-paint" },
        ],
        firstPaintTargetMs: 1,
        firstInteractionTargetMs: 2,
      },
    }),
  );
  assert.equal(flat.ok, false);
  if (!flat.ok) {
    assert.equal(flat.code, "boot-priority-not-strictly-increasing");
  }

  const negative = validateSparkProfile(
    profile({
      boot: {
        entries: [{ priority: 0, assetRef: "a", byteCeiling: -1, requiredFor: "first-paint" }],
        firstPaintTargetMs: 1,
        firstInteractionTargetMs: 2,
      },
    }),
  );
  assert.equal(negative.ok, false);
  if (!negative.ok) {
    assert.equal(negative.code, "negative-budget");
  }
});

test("first interaction may not precede first paint; concurrency >= 1", () => {
  const backwards = validateSparkProfile(
    profile({
      boot: {
        entries: profile().boot.entries,
        firstPaintTargetMs: 2_000,
        firstInteractionTargetMs: 1_000,
      },
    }),
  );
  assert.equal(backwards.ok, false);
  if (!backwards.ok) {
    assert.equal(backwards.code, "first-interaction-before-first-paint");
  }

  const noStreams = validateSparkProfile(profile({ maxConcurrentStreams: 0 }));
  assert.equal(noStreams.ok, false);
  if (!noStreams.ok) {
    assert.equal(noStreams.code, "bad-concurrency");
  }
});

test("lock 16: Spark IS a TargetProfile and is NOT a game model", () => {
  const spark = profile();
  const asTarget: TargetProfile = spark;
  assert.equal(asTarget.profileId, spark.profileId);

  // "world" is not even a key of a target profile — profiles carry no game content.
  // @ts-expect-error TS2339: a target profile has no world field
  const world = spark.world;
  assert.equal(world, undefined, "profiles cannot hold world content (lock 16)");

  const game: GameRefSummary = {
    gameDigest: asGameIrDigest("gd-1"),
    world: { worldId: "w-1", revisionDigest: asDigest("d".repeat(64)) },
    policy: { policyId: "p-1", revisionDigest: asDigest("e".repeat(64)) },
  };
  // @ts-expect-error TS2322: a game composition is not a target profile
  const notAProfile: TargetProfile = game;
  void notAProfile;
  assert.ok(true, "game models cannot masquerade as profiles");
});

test("lock 16 type-level: session ids are not profile ids", () => {
  const sessionId = asSessionId("s-1");
  // @ts-expect-error TS2322: id spaces do not cross even inside profiles
  const profileId: SparkTargetProfile["profileId"] = sessionId;
  void profileId;
  assert.ok(true);
});
