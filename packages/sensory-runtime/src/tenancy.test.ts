/**
 * R20 tenant-isolation tests for the sensory service: tenant-scoped
 * polls and reads, host registries per tenant, and the cross-tenant
 * typed-refusal surface.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAvatar } from "@playliquid/avatar-runtime";
import { asAgentId, asAvatarId } from "@playliquid/game-contracts";
import { asDigest, asSessionEpoch, asTick } from "@playliquid/runtime-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { SensoryService } from "./service.ts";
import { InMemorySensoryHistory, ManualClock, SeededProducer } from "./fakes.ts";
import type { ComposeAvatarInput } from "@playliquid/avatar-runtime";

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const adminA = asSubjectId("admin-a")!;
const adminB = asSubjectId("admin-b")!;
const D = asDigest("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const E1 = asSessionEpoch(1);

function pkg(packageId: string): { packageId: string; version: string } {
  return { packageId, version: "1.0.0" };
}

function avatar() {
  const input = {
    avatarId: asAvatarId("iso-avatar") as never,
    agent: asAgentId("iso-agent"),
    body: {
      subRecordVersion: { subRecord: "body" as const, version: 1, revisionDigest: D },
      geometry: pkg("b.g"),
      skeleton: pkg("b.s"),
      animation: pkg("b.a"),
      physics: pkg("b.p"),
      appearance: pkg("b.ap"),
    },
    sensors: {
      subRecordVersion: { subRecord: "sensors" as const, version: 1, revisionDigest: D },
      channels: [{ capability: "audio" as const, channel: "audio.main" }],
    },
    actuators: {
      subRecordVersion: { subRecord: "actuators" as const, version: 1, revisionDigest: D },
      actuators: [{ capability: "movement" as const, serves: [{ kind: "move.to" } as never] }],
    },
    memory: {
      subRecordVersion: { subRecord: "memory" as const, version: 1, revisionDigest: D },
      topology: "local" as const,
      persistence: "session" as const,
    },
    intelligence: {
      subRecordVersion: { subRecord: "intelligence" as const, version: 1, revisionDigest: D },
      cognitiveSubstrate: pkg("brain.substrate"),
      skills: [pkg("skill.nav")],
    },
  } as unknown as ComposeAvatarInput;
  const composed = composeAvatar(input);
  if (!composed.ok) throw new Error(composed.detail);
  return composed.definition;
}

function makeService() {
  return new SensoryService({ history: new InMemorySensoryHistory(), clock: new ManualClock(500) });
}

test("tenancy: each tenant's hosts poll and record independently", () => {
  const service = makeService();
  const a = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 1 });
  const b = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 2 });
  assert.ok(service.registerHost({ tenant: tenantA, subject: adminA }, { tenant: tenantA, avatarKey: "av", definition: avatar(), producers: [a] }).ok);
  assert.ok(service.registerHost({ tenant: tenantB, subject: adminB }, { tenant: tenantB, avatarKey: "av", definition: avatar(), producers: [b] }).ok);
  a.emit(E1, asTick(1));
  b.emit(E1, asTick(1));
  const pollA = service.poll({ tenant: tenantA, subject: adminA }, E1, asTick(1));
  const pollB = service.poll({ tenant: tenantB, subject: adminB }, E1, asTick(1));
  assert.ok(pollA.ok && pollA.reports.length === 1 && pollA.reports[0]!.appended === 1);
  assert.ok(pollB.ok && pollB.reports.length === 1 && pollB.reports[0]!.appended === 1);
  const historyA = service.historyOf({ tenant: tenantA, subject: adminA }, tenantA);
  const historyB = service.historyOf({ tenant: tenantB, subject: adminB }, tenantB);
  assert.ok(historyA.ok && historyA.records.length === 1 && historyA.records[0]!.tenant === tenantA);
  assert.ok(historyB.ok && historyB.records.length === 1 && historyB.records[0]!.tenant === tenantB);
  // Different seeds -> different content digests across tenants.
  assert.notEqual(
    historyA.ok ? historyA.records[0]!.contentDigest : "",
    historyB.ok ? historyB.records[0]!.contentDigest : "",
  );
});

test("tenancy: a tenant-A caller cannot poll, read or probe tenant B", () => {
  const service = makeService();
  const b = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 3 });
  assert.ok(service.registerHost({ tenant: tenantB, subject: adminB }, { tenant: tenantB, avatarKey: "av", definition: avatar(), producers: [b] }).ok);
  b.emit(E1, asTick(1));
  assert.ok(service.poll({ tenant: tenantB, subject: adminB }, E1, asTick(1)).ok);

  const crossPoll = service.poll({ tenant: tenantA, subject: adminA }, E1, asTick(2));
  assert.ok(crossPoll.ok && crossPoll.reports.length === 0, "tenant-A polls drive no tenant-B hosts");
  const crossRead = service.historyOf({ tenant: tenantA, subject: adminA }, tenantB);
  assert.ok(!crossRead.ok && crossRead.code === "cross-tenant");
  const crossHostPoll = service.pollHost({ tenant: tenantA, subject: adminA }, "av", E1, asTick(2));
  assert.ok(!crossHostPoll.ok && crossHostPoll.code === "host-unknown", "host registry is tenant-scoped");
  const historyB = service.historyOf({ tenant: tenantB, subject: adminB }, tenantB);
  assert.ok(historyB.ok && historyB.records.length === 1, "tenant B's record is untouched by the cross attempts");
});

test("tenancy: an admin cannot register a host under another tenant", () => {
  const service = makeService();
  const producers = [new SeededProducer({ channel: "audio.main", capability: "audio", seed: 4 })];
  const cross = service.registerHost({ tenant: tenantA, subject: adminA }, { tenant: tenantB, avatarKey: "av", definition: avatar(), producers });
  assert.ok(!cross.ok && cross.code === "cross-tenant");
});

test("tenancy: content-key lookups are tenant-scoped", () => {
  const service = makeService();
  const b = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 5 });
  assert.ok(service.registerHost({ tenant: tenantB, subject: adminB }, { tenant: tenantB, avatarKey: "av", definition: avatar(), producers: [b] }).ok);
  b.emit(E1, asTick(1));
  assert.ok(service.poll({ tenant: tenantB, subject: adminB }, E1, asTick(1)).ok);
  const historyB = service.historyOf({ tenant: tenantB, subject: adminB }, tenantB);
  assert.ok(historyB.ok);
  const key = historyB.ok ? historyB.records[0]!.contentKey : undefined;
  assert.ok(key);
  const own = service.findByKey({ tenant: tenantB, subject: adminB }, tenantB, key);
  assert.ok(own.ok);
  const foreign = service.findByKey({ tenant: tenantA, subject: adminA }, tenantB, key);
  assert.ok(!foreign.ok && foreign.code === "cross-tenant");
  // Even tenant B cannot find a key that does not exist.
  const missing = service.findByKey({ tenant: tenantB, subject: adminB }, tenantB, "sha256:" + "0".repeat(64) as never);
  assert.ok(!missing.ok && missing.code === "key-unknown");
});
