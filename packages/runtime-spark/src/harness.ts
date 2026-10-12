/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives the full PL-035 spark-runtime story over the REAL runtime-core
 * kernel, printing machine-readable JSON; exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no clock reads (the injected
 * ManualSparkClock is the only time source); no randomness (the fakes
 * are deterministic, E9).
 *
 * Story:
 * 1. plan the minimal critical boot from game-ir content under the 9:16
 *    profile budgets (R6) — plan/schedule/manifest digests;
 * 2. boot → interaction-ready, first interaction through the kernel's
 *    canonical act path, the immutable SparkBootRecord sealed (E10);
 * 3. progressive streaming of every deferred batch through the ports
 *    with aggressive cache admission (E11: deterministic fakes);
 * 4. E8 refusal evidence: budget inversion, oversized critical boot,
 *    cross-tenant, second first-interaction (immutability), tampered
 *    source content;
 * 5. E9 determinism: a second identically-wired runtime produces the
 *    identical boot record.
 */

import { asIdempotencyNonce, asIntentId, asIntentKind } from "@playliquid/runtime-contracts";
import {
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemorySnapshotStore,
  playerActor,
} from "@playliquid/runtime-core";
import { asTenantId } from "@playliquid/platform-contracts";
import { createSparkRuntime } from "./runtime.ts";
import type { SparkRuntime } from "./runtime.ts";
import { verifySparkBootRecord } from "./record.ts";
import { FakeSparkContentSource, InMemorySparkCache, ManualSparkClock } from "./fakes.ts";
import { fixtureCostModel, fixturePolicyRef, fixtureSparkDocument, fixtureSparkProfile } from "./fixtures.ts";

const TENANT = asTenantId("tenant-harness")!;

interface World {
  readonly sessionId: string;
  readonly cache: InMemorySparkCache;
  readonly clock: ManualSparkClock;
  readonly runtime: SparkRuntime<{ count: number; moves: readonly number[] }>;
}

function wire(sessionId: string, cache: InMemorySparkCache): World {
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
    cache,
    seed: "spark-harness-seed",
  });
  if (!created.ok) throw new Error(created.message);
  return { sessionId, cache, clock, runtime: created.runtime };
}

function intent(n: number) {
  return {
    intent: {
      intentId: asIntentId(`i-h-${n}`),
      kind: asIntentKind("world.increment"),
      actor: playerActor("player-harness"),
      payload: { by: 1 },
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce(`n-h-${n}`),
  };
}

const evidence: Record<string, unknown> = {};
function record(key: string, value: unknown): void {
  evidence[key] = value;
}

// 1-2. boot + first interaction over the real kernel.
const first = wire("spark-harness-1", new InMemorySparkCache());
const booted = first.runtime.boot(TENANT);
if (!booted.ok) throw new Error(booted.message);
first.clock.advance(42);
const interaction = first.runtime.firstInteraction(TENANT, intent(1));
if (!interaction.ok) throw new Error(interaction.message);
if (verifySparkBootRecord(interaction.bootRecord) !== true) throw new Error("boot record failed verification");
record("boot", {
  criticalUnits: interaction.bootRecord.bootOrdering.length,
  criticalBytes: interaction.bootRecord.criticalBytes,
  plannedFirstPaintMs: booted.plannedFirstPaintMs,
  plannedFirstInteractionMs: booted.plannedFirstInteractionMs,
  firstCommandKind: interaction.bootRecord.firstCommandKind,
  firstCommandDigest: interaction.bootRecord.firstCommandDigest,
  recordDigest: interaction.bootRecord.recordDigest,
  verified: true,
});

// 3. progressive streaming with aggressive caching.
const streamedBatches: unknown[] = [];
for (;;) {
  const streamed = first.runtime.streamNextBatch(TENANT);
  if (!streamed.ok) break;
  streamedBatches.push({
    batchIndex: streamed.batchIndex,
    actions: streamed.served.map((entry) => entry.action),
  });
}
record("streaming", {
  batches: streamedBatches,
  cachedEntries: first.cache.entries().length,
  cacheBytes: first.cache.storedBytes(),
});

// 4. E8 refusals.
const invertedProfile = fixtureSparkProfile({
  boot: { entries: fixtureSparkProfile().boot.entries, firstPaintTargetMs: 2_500, firstInteractionTargetMs: 1_500 },
});
const clock = new ManualSparkClock(0);
const inverted = createSparkRuntime({
  tenant: TENANT,
  sessionId: "spark-harness-inverted",
  document: fixtureSparkDocument(),
  profile: invertedProfile,
  costModel: fixtureCostModel(),
  policy: fixturePolicyRef(),
  driver: new CounterWorldDriver(),
  capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: {}, clock }),
  snapshotStore: new InMemorySnapshotStore(),
  clock,
  contentSource: new FakeSparkContentSource(),
  cache: new InMemorySparkCache(),
});
record("refusals", {
  budgetInversion: inverted.ok ? "UNEXPECTED ACCEPT" : inverted.rejections?.map((rejection) => rejection.code),
  crossTenant: (() => {
    const refusal = first.runtime.view(asTenantId("tenant-other")!);
    return refusal.ok ? "UNEXPECTED ACCEPT" : refusal.code;
  })(),
  immutableBootRecord: (() => {
    const second = first.runtime.firstInteraction(TENANT, intent(2));
    return !second.ok ? second.code : "UNEXPECTED ACCEPT";
  })(),
  tamperedSource: (() => {
    const tamperedClock = new ManualSparkClock(0);
    const created = createSparkRuntime({
      tenant: TENANT,
      sessionId: "spark-harness-tamper",
      document: fixtureSparkDocument(),
      profile: fixtureSparkProfile(),
      costModel: fixtureCostModel(),
      policy: fixturePolicyRef(),
      driver: new CounterWorldDriver(),
      capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: {}, clock: tamperedClock }),
      snapshotStore: new InMemorySnapshotStore(),
      clock: tamperedClock,
      contentSource: new FakeSparkContentSource({ tamper: "wrong-digest" }),
      cache: new InMemorySparkCache(),
    });
    if (!created.ok) throw new Error(created.message);
    created.runtime.boot(TENANT);
    const refusal = created.runtime.streamNextBatch(TENANT);
    return !refusal.ok ? refusal.code : "UNEXPECTED ACCEPT";
  })(),
});

// 5. E9 determinism: identical wiring → identical boot record.
const second = wire("spark-harness-1", new InMemorySparkCache());
second.runtime.boot(TENANT);
second.clock.advance(42);
const secondInteraction = second.runtime.firstInteraction(TENANT, intent(1));
if (!secondInteraction.ok) throw new Error(secondInteraction.message);
record("determinism", {
  identicalPlanDigest: interaction.bootRecord.planDigest === secondInteraction.bootRecord.planDigest,
  identicalRecordDigest: interaction.bootRecord.recordDigest === secondInteraction.bootRecord.recordDigest,
});

process.stdout.write(`${JSON.stringify({ harness: "runtime-spark", evidence }, null, 2)}\n`);
