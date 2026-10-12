/**
 * Determinism tests (E9): same content + profile + cost model ⇒ identical
 * digests and identical boot records; tampered evidence is refused (E10).
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
import type { SparkBootRecord } from "./record.ts";
import { FakeSparkContentSource, InMemorySparkCache, ManualSparkClock } from "./fakes.ts";
import { fixtureCostModel, fixturePolicyRef, fixtureSparkDocument, fixtureSparkProfile } from "./fixtures.ts";

const TENANT = asTenantId("tenant-spark")!;

function makeRuntime(sessionId: string): { runtime: SparkRuntime<{ count: number; moves: readonly number[] }>; clock: ManualSparkClock } {
  const clock = new ManualSparkClock(1_000);
  const created = createSparkRuntime({
    tenant: TENANT,
    sessionId,
    document: fixtureSparkDocument(),
    profile: fixtureSparkProfile(),
    costModel: fixtureCostModel(),
    policy: fixturePolicyRef(),
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({
      capabilityIntentKinds: {},
      intentCommandKinds: { "world.increment": "world.increment" },
      clock,
    }),
    snapshotStore: new InMemorySnapshotStore(),
    clock,
    contentSource: new FakeSparkContentSource(),
    cache: new InMemorySparkCache(),
    seed: "spark-seed-1",
  });
  if (!created.ok) throw new Error(created.message);
  return { runtime: created.runtime, clock };
}

function firstIntent(n: number): ActInput {
  return {
    intent: {
      intentId: asIntentId(`i-p-${n}`),
      kind: asIntentKind("world.increment"),
      actor: playerActor("player-1"),
      payload: { by: 1 },
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce(`n-p-${n}`),
  };
}

function bootAndInteract(sessionId: string): SparkBootRecord {
  const { runtime, clock } = makeRuntime(sessionId);
  runtime.boot(TENANT);
  clock.advance(42);
  const result = runtime.firstInteraction(TENANT, firstIntent(1));
  if (!result.ok) throw new Error(result.message);
  return result.bootRecord;
}

test("same content + profile + cost model produce identical boot records (E9)", () => {
  const first = bootAndInteract("spark-determinism");
  const second = bootAndInteract("spark-determinism");
  assert.equal(first.planDigest, second.planDigest);
  assert.equal(first.scheduleDigest, second.scheduleDigest);
  assert.equal(first.cacheManifestDigest, second.cacheManifestDigest);
  assert.equal(first.firstCommandDigest, second.firstCommandDigest);
  assert.equal(first.recordDigest, second.recordDigest);
  assert.deepEqual(first.bootOrdering, second.bootOrdering);
  assert.equal(first.firstInteractionAt - first.interactionReadyAt, 42);
  assert.equal(second.firstInteractionAt - second.interactionReadyAt, 42);
});

test("the boot record verifies against its own digest (E10)", () => {
  const record = bootAndInteract("spark-verify-1");
  assert.equal(verifySparkBootRecord(record), true);
});

test("a tampered boot record is refused by verification (E8/E10)", () => {
  const record = bootAndInteract("spark-verify-2");
  const tampered: SparkBootRecord = { ...record, criticalBytes: record.criticalBytes + 1 };
  assert.notEqual(verifySparkBootRecord(tampered), true);
  const tamperedOrdering: SparkBootRecord = { ...record, bootOrdering: [...record.bootOrdering].reverse() };
  assert.notEqual(verifySparkBootRecord(tamperedOrdering), true);
});

test("different content produces different digests across the whole chain", () => {
  const base = bootAndInteract("spark-chain-1");
  const clock = new ManualSparkClock(1_000);
  const mutatedDocument: ReturnType<typeof fixtureSparkDocument> = {
    ...fixtureSparkDocument(),
    nodes: fixtureSparkDocument().nodes.map((node) =>
      node.id === "entity-hero-node" && node.kind === "entity"
        ? { ...node, state: { kind: "record", fields: { health: { kind: "int", value: 50n } } } }
        : node,
    ),
  };
  const created = createSparkRuntime({
    tenant: TENANT,
    sessionId: "spark-chain-1",
    document: mutatedDocument,
    profile: fixtureSparkProfile(),
    costModel: fixtureCostModel(),
    policy: fixturePolicyRef(),
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: { "world.increment": "world.increment" }, clock }),
    snapshotStore: new InMemorySnapshotStore(),
    clock,
    contentSource: new FakeSparkContentSource(),
    cache: new InMemorySparkCache(),
    seed: "spark-seed-1",
  });
  if (!created.ok) throw new Error(created.message);
  created.runtime.boot(TENANT);
  const mutated = created.runtime.firstInteraction(TENANT, firstIntent(1));
  if (!mutated.ok) throw new Error(mutated.message);
  assert.notEqual(base.planDigest, mutated.bootRecord.planDigest);
  assert.notEqual(base.cacheManifestDigest, mutated.bootRecord.cacheManifestDigest);
  assert.notEqual(base.recordDigest, mutated.bootRecord.recordDigest);
  // The first-command digest covers the SESSION-SCOPED command identity
  // (command id + sequence + intent), never the world content: the same
  // session + same intent keeps it stable while the content digests move.
  assert.equal(base.firstCommandDigest, mutated.bootRecord.firstCommandDigest);
});

test("the kernel's own determinism holds under the spark shell (fixed tick, E9)", () => {
  const { runtime } = makeRuntime("spark-tick-1");
  runtime.boot(TENANT);
  const stepped = runtime.interact(TENANT, firstIntent(1));
  if (!("status" in stepped)) throw new Error(stepped.message);
  assert.equal(stepped.status, "committed");
  const duplicate = runtime.interact(TENANT, firstIntent(1));
  if (!("status" in duplicate)) throw new Error(duplicate.message);
  assert.equal(duplicate.status, "duplicate");
});
