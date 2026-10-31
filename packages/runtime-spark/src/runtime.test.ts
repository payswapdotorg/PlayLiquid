/**
 * Runtime shell tests (PL-035): boot → interaction-ready → first
 * interaction (immutable boot record, E10), progressive streaming with
 * aggressive cache reuse, and R20 tenant isolation on every door.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asIdempotencyNonce, asIntentId, asIntentKind } from "@playliquid/runtime-contracts";
import {
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemorySnapshotStore,
  playerActor,
} from "@playliquid/runtime-core";
import type { ActInput } from "@playliquid/runtime-core";
import { asTenantId } from "@playliquid/platform-contracts";
import { createSparkRuntime } from "./runtime.ts";
import type { SparkRuntime } from "./runtime.ts";
import { verifySparkBootRecord } from "./record.ts";
import { FakeSparkContentSource, InMemorySparkCache, ManualSparkClock } from "./fakes.ts";
import { fixtureCostModel, fixturePolicyRef, fixtureSparkDocument, fixtureSparkProfile } from "./fixtures.ts";

const TENANT = asTenantId("tenant-spark")!;

interface Kit {
  readonly runtime: SparkRuntime<{ count: number; moves: readonly number[] }>;
  readonly clock: ManualSparkClock;
  readonly cache: InMemorySparkCache;
}

function makeKit(over: { readonly secondWorldCaching?: boolean; readonly cache?: InMemorySparkCache } = {}): Kit {
  const clock = new ManualSparkClock(1_000);
  const cache = over.cache ?? new InMemorySparkCache();
  const created = createSparkRuntime({
    tenant: TENANT,
    sessionId: "spark-session-1",
    document: fixtureSparkDocument({ secondWorldCaching: over.secondWorldCaching }),
    profile: fixtureSparkProfile(),
    costModel: fixtureCostModel(),
    policy: fixturePolicyRef(),
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({
      capabilityIntentKinds: {},
      intentCommandKinds: { "world.increment": "world.increment", "world.move": "world.move" },
      clock,
    }),
    snapshotStore: new InMemorySnapshotStore(),
    clock,
    contentSource: new FakeSparkContentSource(),
    cache,
    seed: "spark-seed-1",
  });
  if (!created.ok) throw new Error(created.message);
  return { runtime: created.runtime, clock, cache };
}

function playerAct(n: number, kind = "world.increment", payload: unknown = { by: 1 }): ActInput {
  return {
    intent: {
      intentId: asIntentId(`i-p-${n}`),
      kind: asIntentKind(kind),
      actor: playerActor("player-1"),
      payload,
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce(`n-p-${n}`),
  };
}

test("boot applies the plan and marks the session interaction-ready", () => {
  const { runtime } = makeKit();
  const initial = runtime.view(TENANT);
  if (!initial.ok) throw new Error(initial.message);
  assert.equal(initial.phase, "created");
  const booted = runtime.boot(TENANT);
  assert.equal(booted.ok, true);
  if (booted.ok) {
    assert.equal(booted.bootedAt, 1_000);
    assert.equal(booted.interactionReadyAt, 1_000);
    assert.ok(booted.plannedFirstPaintMs <= 1_500);
    assert.ok(booted.plannedFirstInteractionMs <= 2_500);
  }
  const view = runtime.view(TENANT);
  if (!view.ok) throw new Error(view.message);
  assert.equal(view.phase, "booted");
  assert.equal(view.streamedBatchCount, 0);
  assert.equal(view.bootRecordDigest, null);
});

test("the first interaction seals the immutable boot record (E10)", () => {
  const { runtime, clock } = makeKit();
  runtime.boot(TENANT);
  clock.advance(37);
  const first = runtime.firstInteraction(TENANT, playerAct(1));
  assert.equal(first.ok, true);
  assert.equal(first.act.status, "committed");
  assert.equal(first.bootRecord.kind, "spark-boot-record");
  assert.equal(first.bootRecord.tenant, TENANT);
  assert.equal(first.bootRecord.profileId, "spark");
  assert.equal(first.bootRecord.firstCommandKind, "world.increment");
  assert.equal(first.bootRecord.firstCommandSeq, 1);
  assert.equal(first.bootRecord.bootOrdering[0], "world-spark-node");
  assert.equal(first.bootRecord.bootedAt, 1_000);
  assert.equal(first.bootRecord.firstInteractionAt, 1_037);
  assert.equal(verifySparkBootRecord(first.bootRecord), true);
  const view = runtime.view(TENANT);
  if (!view.ok) throw new Error(view.message);
  assert.equal(view.phase, "live");
  assert.equal(view.bootRecordDigest, first.bootRecord.recordDigest);
  const record = runtime.bootRecordOf(TENANT);
  if (!("recordDigest" in record)) throw new Error(JSON.stringify(record));
  assert.equal(record.recordDigest, first.bootRecord.recordDigest);
});

test("ongoing commands flow through interact without re-recording", () => {
  const { runtime } = makeKit();
  runtime.boot(TENANT);
  runtime.firstInteraction(TENANT, playerAct(1));
  const second = runtime.interact(TENANT, playerAct(2, "world.move", { to: 5 }));
  if (!("status" in second)) throw new Error(second.message);
  assert.equal(second.status, "committed");
  const view = runtime.view(TENANT);
  if (!view.ok) throw new Error(view.message);
  assert.notEqual(view.bootRecordDigest, null);
});

test("streaming serves, caches, and reuses content aggressively", () => {
  const shared = new InMemorySparkCache();
  const first = makeKit({ cache: shared });
  first.runtime.boot(TENANT);
  const batches: string[][] = [];
  for (let index = 0; index < 3; index += 1) {
    const streamed = first.runtime.streamNextBatch(TENANT);
    assert.equal(streamed.ok, true, JSON.stringify(streamed));
    if (streamed.ok) {
      batches.push(streamed.served.map((entry) => entry.action));
      assert.equal(streamed.batchIndex, index);
    }
  }
  assert.deepEqual(batches, [
    ["store-then-serve", "store-then-serve"],
    ["store-then-serve", "store-then-serve"],
    ["store-then-serve", "store-then-serve"],
  ]);
  const exhausted = first.runtime.streamNextBatch(TENANT);
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) {
    assert.equal(exhausted.code, "stream-exhausted");
  }
  assert.equal(shared.entries().length, 6);
  // A second, identically-planned runtime reuses the shared cache: every
  // unit is served FROM CACHE — aggressive caching across boots (R6).
  const second = makeKit({ cache: shared });
  second.runtime.boot(TENANT);
  for (let index = 0; index < 3; index += 1) {
    const streamed = second.runtime.streamNextBatch(TENANT);
    assert.equal(streamed.ok, true);
    if (streamed.ok) {
      assert.ok(streamed.served.every((entry) => entry.action === "serve-from-cache"));
    }
  }
});

test("a world that refuses caching streams by revalidation only (R15)", () => {
  const { runtime } = makeKit({ secondWorldCaching: false });
  runtime.boot(TENANT);
  // batch 0 carries the entry world's deferred units — cacheable.
  const batch0 = runtime.streamNextBatch(TENANT);
  if (!batch0.ok) throw new Error(batch0.message);
  assert.deepEqual(batch0.served.map((entry) => entry.action), ["store-then-serve", "store-then-serve"]);
  // batches 1 and 2 carry the second world's units — its streaming policy
  // says cacheable: false, so every unit re-validates from the source and
  // NOTHING of that world is admitted to the cache.
  const batch1 = runtime.streamNextBatch(TENANT);
  if (!batch1.ok) throw new Error(batch1.message);
  assert.deepEqual(batch1.served.map((entry) => entry.action), ["revalidated-from-source", "revalidated-from-source"]);
  const batch2 = runtime.streamNextBatch(TENANT);
  if (!batch2.ok) throw new Error(batch2.message);
  assert.deepEqual(batch2.served.map((entry) => entry.action), ["revalidated-from-source", "revalidated-from-source"]);
});

test("every door enforces tenant isolation (R20)", () => {
  const { runtime } = makeKit();
  const other = asTenantId("tenant-other")!;
  for (const refusal of [
    runtime.view(other),
    runtime.boot(other),
    runtime.firstInteraction(other, playerAct(1)),
    runtime.interact(other, playerAct(1)),
    runtime.bootRecordOf(other),
    runtime.streamNextBatch(other),
  ]) {
    assert.equal("code" in refusal, true, JSON.stringify(refusal));
    if ("code" in refusal) {
      assert.equal(refusal.code, "cross-tenant");
    }
  }
  runtime.boot(TENANT);
  const cross = runtime.streamNextBatch(other);
  if (!cross.ok) {
    assert.equal(cross.code, "cross-tenant");
  }
});

// ---------------------------------------------------------------------------
// ACR-001 (PLX-ARCH-003): the (worldKind, targetProfile)-aware runtime door.
// ---------------------------------------------------------------------------

type FixtureWorldKind = "spark" | "game" | "experience" | "digital_twin" | "other";
type FixtureDelivery = "spark_vertical" | "web" | "desktop";

/** The fixture document plus an explicit ACR-001 world declaration. */
function worldDeclaredDocument(
  kind: FixtureWorldKind | undefined,
  targetProfile: FixtureDelivery | undefined,
): ReturnType<typeof fixtureSparkDocument> {
  return { ...fixtureSparkDocument(), world: { ...(kind ? { kind } : {}), ...(targetProfile ? { targetProfile } : {}) } };
}

function makeWorldKit(document: ReturnType<typeof fixtureSparkDocument>) {
  const clock = new ManualSparkClock(1_000);
  const created = createSparkRuntime({
    tenant: TENANT,
    sessionId: "spark-session-world",
    document,
    profile: fixtureSparkProfile(),
    costModel: fixtureCostModel(),
    policy: fixturePolicyRef(),
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({
      capabilityIntentKinds: {},
      intentCommandKinds: { "world.increment": "world.increment", "world.move": "world.move" },
      clock,
    }),
    snapshotStore: new InMemorySnapshotStore(),
    clock,
    contentSource: new FakeSparkContentSource(),
    cache: new InMemorySparkCache(),
    seed: "spark-seed-world",
  });
  return created;
}

test("ACR-001: a declared non-spark delivery is refused at the runtime door (world-delivery-not-spark)", () => {
  const refused = makeWorldKit(worldDeclaredDocument("game", "web"));
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "world-delivery-not-spark");
    assert.match(refused.message, /targetProfile "web"/);
  }
  const desktop = makeWorldKit(worldDeclaredDocument("spark", "desktop"));
  assert.equal(desktop.ok, false);
  if (!desktop.ok) {
    // Even a spark-KIND world with a desktop delivery refuses: dual
    // citizenship — the kind never implies the delivery.
    assert.equal(desktop.code, "world-delivery-not-spark");
  }
});

test("ACR-001: every world kind with a declared spark_vertical delivery boots (kind never gates)", () => {
  for (const kind of ["spark", "game", "experience", "digital_twin", "other"] as const) {
    const created = makeWorldKit(worldDeclaredDocument(kind, "spark_vertical"));
    assert.equal(created.ok, true, `${kind}: ${created.ok ? "" : created.message}`);
    if (created.ok) {
      created.runtime.boot(TENANT);
      const view = created.runtime.view(TENANT);
      assert.equal(view.ok, true, JSON.stringify(view));
      if (view.ok) {
        assert.equal(view.phase, "booted");
      }
    }
  }
});

test("ACR-001: a legacy undeclared document keeps the exact pre-ACR runtime behavior", () => {
  const created = makeWorldKit(fixtureSparkDocument());
  assert.equal(created.ok, true);
});
