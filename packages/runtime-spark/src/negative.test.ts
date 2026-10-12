/**
 * The E8 negative matrix for the Spark runtime: every invalid input and
 * illegal transition is a typed kebab-case refusal — never an exception,
 * never a silent repair. Covers the work order's required cases:
 * invalid profile, budget inversion, oversized critical boot, schedule
 * cycle/contradiction (stream-schedule.test.ts), cache-rule violation
 * (cache.test.ts), cross-tenant (runtime.test.ts), content tamper.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SparkTargetProfile } from "@playliquid/runtime-contracts";
import {
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemorySnapshotStore,
  playerActor,
} from "@playliquid/runtime-core";
import { asIdempotencyNonce, asIntentId, asIntentKind } from "@playliquid/runtime-contracts";
import { asTenantId } from "@playliquid/platform-contracts";
import { createSparkRuntime } from "./runtime.ts";
import { FakeSparkContentSource, InMemorySparkCache, ManualSparkClock } from "./fakes.ts";
import type { CacheTamperScript } from "./fakes.ts";
import { fixtureCostModel, fixturePolicyRef, fixtureSparkDocument, fixtureSparkProfile } from "./fixtures.ts";

const TENANT = asTenantId("tenant-spark")!;

function makeRuntime(over: {
  readonly profile?: SparkTargetProfile;
  readonly document?: ReturnType<typeof fixtureSparkDocument>;
  readonly bytesPerMillisecond?: number;
  readonly tamper?: "wrong-digest" | "wrong-bytes";
  readonly cacheTamper?: CacheTamperScript;
  readonly cacheBudgetBytes?: number;
  readonly cache?: InMemorySparkCache;
} = {}) {
  const clock = new ManualSparkClock(0);
  return createSparkRuntime({
    tenant: TENANT,
    sessionId: "spark-negative",
    document: over.document ?? fixtureSparkDocument(),
    profile: over.profile ?? fixtureSparkProfile(),
    costModel: fixtureCostModel(over.bytesPerMillisecond ?? 100),
    policy: fixturePolicyRef(),
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: { "world.increment": "world.increment" }, clock }),
    snapshotStore: new InMemorySnapshotStore(),
    clock,
    contentSource: new FakeSparkContentSource({ tamper: over.tamper }),
    cache: over.cache ?? new InMemorySparkCache(over.cacheTamper),
    ...(over.cacheBudgetBytes === undefined ? {} : { cacheBudgetBytes: over.cacheBudgetBytes }),
  });
}

test("a non-spark profile is refused with every structural reason (E8)", () => {
  const refusal = makeRuntime({
    profile: fixtureSparkProfile({ aspectRatio: "16:9" as never, formFactor: "desktop-first" as never, orientation: "landscape" as never }),
  });
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "boot-refused");
    assert.ok(refusal.rejections?.some((rejection) => rejection.code === "not-spark-profile"));
  }
});

test("a budget inversion (first interaction before first paint) is refused (E8)", () => {
  const refusal = makeRuntime({
    profile: fixtureSparkProfile({ boot: { entries: fixtureSparkProfile().boot.entries, firstPaintTargetMs: 2_500, firstInteractionTargetMs: 1_500 } }),
  });
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.ok(refusal.rejections?.some((rejection) => rejection.code === "budget-inversion"));
  }
});

test("an oversized critical boot is refused against the budget (E8)", () => {
  const refusal = makeRuntime({ bytesPerMillisecond: 0.1 });
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    const codes = refusal.rejections?.map((rejection) => rejection.code) ?? [];
    assert.ok(codes.includes("critical-boot-oversized"), JSON.stringify(codes));
    assert.ok(codes.includes("first-paint-oversized"), JSON.stringify(codes));
  }
});

test("an invalid cost model is refused (E8)", () => {
  const refusal = makeRuntime({ bytesPerMillisecond: 0 });
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.ok(refusal.rejections?.some((rejection) => rejection.code === "invalid-cost-model"));
  }
});

test("an invalid game-ir document is refused with kernel diagnostics (E8)", () => {
  const document = fixtureSparkDocument();
  const refusal = makeRuntime({ document: { ...document, nodes: [...document.nodes, document.nodes[0]!] } });
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.ok(refusal.rejections?.some((rejection) => rejection.code === "duplicate-node-id"));
  }
  const noEntry = makeRuntime({ document: { ...document, entry: { world: "world-none" as never, scene: "scene-none" as never } } });
  assert.equal(noEntry.ok, false);
  if (!noEntry.ok) {
    assert.ok(noEntry.rejections?.some((rejection) => rejection.code === "entry-scene-missing"));
  }
  const dangling = makeRuntime({
    document: {
      ...document,
      nodes: document.nodes.filter((node) => node.id !== "event-moved-node"),
    },
  });
  assert.equal(dangling.ok, false);
  if (!dangling.ok) {
    // The kernel's own validator is the authority for dangling event
    // references (GAMEIR/E009); the walk's rule-event-unknown check is the
    // spark-side defense-in-depth layer. E8: typed refusal, never a crash.
    const rejection = dangling.rejections?.find((entry) => entry.code === "game-ir-invalid");
    assert.ok(rejection !== undefined, JSON.stringify(dangling.rejections));
    assert.match(rejection.message, /GAMEIR\/E009/);
  }
});

test("invalid tenant and session ids are refused at construction (E8)", () => {
  const badTenant = createSparkRuntime({
    tenant: "Bad Tenant!" as never,
    sessionId: "s",
    document: fixtureSparkDocument(),
    profile: fixtureSparkProfile(),
    costModel: fixtureCostModel(),
    policy: fixturePolicyRef(),
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: {}, clock: new ManualSparkClock() }),
    snapshotStore: new InMemorySnapshotStore(),
    clock: new ManualSparkClock(),
    contentSource: new FakeSparkContentSource(),
    cache: new InMemorySparkCache(),
  });
  assert.equal(badTenant.ok, false);
  if (!badTenant.ok) {
    assert.equal(badTenant.code, "invalid-tenant");
  }
});

test("boot/interaction ordering violations are typed refusals (E8)", () => {
  const created = makeRuntime();
  if (!created.ok) throw new Error(created.message);
  const interaction = created.runtime.firstInteraction(TENANT, {
    intent: { intentId: asIntentId("i-1"), kind: asIntentKind("world.increment"), actor: playerActor("player-1"), payload: { by: 1 }, issuedAt: 0 as never },
    nonce: asIdempotencyNonce("n-1"),
  });
  assert.equal(interaction.ok, false);
  if (!interaction.ok) {
    assert.equal(interaction.code, "not-booted");
  }
  assert.equal(created.runtime.boot(TENANT).ok, true);
  const again = created.runtime.boot(TENANT);
  assert.equal(again.ok, false);
  if (!again.ok) {
    assert.equal(again.code, "already-booted");
  }
});

test("a second first-interaction is refused: boot records are immutable (E10/E8)", () => {
  const created = makeRuntime();
  if (!created.ok) throw new Error(created.message);
  created.runtime.boot(TENANT);
  const first = created.runtime.firstInteraction(TENANT, {
    intent: { intentId: asIntentId("i-1"), kind: asIntentKind("world.increment"), actor: playerActor("player-1"), payload: { by: 1 }, issuedAt: 0 as never },
    nonce: asIdempotencyNonce("n-1"),
  });
  assert.equal(first.ok, true);
  const second = created.runtime.firstInteraction(TENANT, {
    intent: { intentId: asIntentId("i-2"), kind: asIntentKind("world.increment"), actor: playerActor("player-1"), payload: { by: 2 }, issuedAt: 0 as never },
    nonce: asIdempotencyNonce("n-2"),
  });
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.code, "boot-record-immutable");
  }
});

test("a non-committing first interaction does not seal a record (E8)", () => {
  const created = makeRuntime();
  if (!created.ok) throw new Error(created.message);
  created.runtime.boot(TENANT);
  const refused = created.runtime.firstInteraction(TENANT, {
    intent: { intentId: asIntentId("i-1"), kind: asIntentKind("world.unknown"), actor: playerActor("player-1"), payload: {}, issuedAt: 0 as never },
    nonce: asIdempotencyNonce("n-1"),
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "kernel-refused");
  }
  const noRecord = created.runtime.bootRecordOf(TENANT);
  assert.equal("code" in noRecord, true, JSON.stringify(noRecord));
  if ("code" in noRecord) {
    assert.equal(noRecord.code, "not-booted");
  }
});

test("tampered source content is refused (content tamper, E8)", () => {
  const created = makeRuntime({ tamper: "wrong-digest" });
  if (!created.ok) throw new Error(created.message);
  created.runtime.boot(TENANT);
  const refusal = created.runtime.streamNextBatch(TENANT);
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "source-refused");
    assert.match(refusal.message, /pinned digest/);
  }
  const refusing = makeRuntime({ tamper: "wrong-bytes" });
  if (!refusing.ok) throw new Error(refusing.message);
  refusing.runtime.boot(TENANT);
  const portRefusal = refusing.runtime.streamNextBatch(TENANT);
  assert.equal(portRefusal.ok, false);
  if (!portRefusal.ok) {
    assert.equal(portRefusal.code, "source-refused");
  }
});

test("tampered cache content is refused (content tamper, E8)", () => {
  // The mismatched-read tamper fires on a cache HIT: one runtime fills a
  // shared cache, a second runtime reuses it — the forged read must be
  // refused by the runtime's digest pin check.
  const shared = new InMemorySparkCache("mismatched-read");
  const filler = makeRuntime({ cache: shared });
  if (!filler.ok) throw new Error(filler.message);
  filler.runtime.boot(TENANT);
  const filled = filler.runtime.streamNextBatch(TENANT);
  assert.equal(filled.ok, true, JSON.stringify(filled));
  const reusing = makeRuntime({ cache: shared });
  if (!reusing.ok) throw new Error(reusing.message);
  reusing.runtime.boot(TENANT);
  const refusal = reusing.runtime.streamNextBatch(TENANT);
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "cache-refused");
  }
  // Any write attempt under reject-writes is refused by the port.
  const rejecting = makeRuntime({ cacheTamper: "reject-writes" });
  if (!rejecting.ok) throw new Error(rejecting.message);
  rejecting.runtime.boot(TENANT);
  const writeRefusal = rejecting.runtime.streamNextBatch(TENANT);
  assert.equal(writeRefusal.ok, false);
  if (!writeRefusal.ok) {
    assert.equal(writeRefusal.code, "cache-refused");
  }
});

test("a cache budget overflow refuses the streaming batch (E8)", () => {
  const created = makeRuntime({ cacheBudgetBytes: 16 });
  if (!created.ok) throw new Error(created.message);
  created.runtime.boot(TENANT);
  const refusal = created.runtime.streamNextBatch(TENANT);
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "cache-refused");
    assert.match(refusal.message, /cache-budget-exceeded/);
  }
});

test("an unavailable content source unit is refused (E8)", () => {
  const clock = new ManualSparkClock(0);
  const created = createSparkRuntime({
    tenant: TENANT,
    sessionId: "spark-negative",
    document: fixtureSparkDocument(),
    profile: fixtureSparkProfile(),
    costModel: fixtureCostModel(),
    policy: fixturePolicyRef(),
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: {}, clock }),
    snapshotStore: new InMemorySnapshotStore(),
    clock,
    contentSource: new FakeSparkContentSource({ unavailable: new Set(["scene-later-node"]) }),
    cache: new InMemorySparkCache(),
  });
  if (!created.ok) throw new Error(created.message);
  created.runtime.boot(TENANT);
  const refusal = created.runtime.streamNextBatch(TENANT);
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "source-refused");
    assert.match(refusal.message, /source\/unit-unavailable/);
  }
});
