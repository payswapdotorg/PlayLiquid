/**
 * R20 tenant-isolation + least-privilege tests for the social service.
 * Cross-tenant targets are typed violations; grants from other tenants
 * never satisfy a request; identical subject ids under different
 * tenants are perfectly isolated graphs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SocialService } from "./service.ts";
import {
  createFixedClock,
  createMemoryGrantDirectory,
  createMemorySocialStore,
  createMemorySubjectDirectory,
  socialGrant,
} from "./fakes.ts";
import { asGameEventKind } from "@playliquid/platform-contracts";
import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { asEventTypeId } from "@playliquid/game-ir";

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const subjectOne = asSubjectId("player-one")!;
const subjectTwo = asSubjectId("player-two")!;
const subjectBeta = asSubjectId("player-beta")!;

function evidenceOf(kind: string, actor: string, target: string, tick: number) {
  return {
    event: {
      type: asEventTypeId(kind)!,
      payload: {
        kind: "record" as const,
        fields: {
          actor: { kind: "string" as const, value: actor },
          target: { kind: "string" as const, value: target },
        },
      },
      tick,
    },
    binding: { capability: "social" as const, eventKind: asGameEventKind(kind)!, graph: "friends" as const },
  };
}

function makeService() {
  const store = createMemorySocialStore();
  const directory = createMemorySubjectDirectory();
  directory.register(tenantA, subjectOne);
  directory.register(tenantA, subjectTwo);
  directory.register(tenantB, subjectBeta);
  const grants = createMemoryGrantDirectory();
  grants.grant(socialGrant(tenantA, subjectOne));
  const service = new SocialService({
    store: store.store,
    clock: createFixedClock().clock,
    directory: directory.directory,
    grants: grants.grantsDirectory,
    policy: { maxGraphSize: 10, requireMutualConsent: false, presence: false },
    declaredGraphs: ["friends"],
  });
  return { store, directory, grants, service };
}

test("tenancy: cross-tenant follows are refused with a typed violation", () => {
  const { service } = makeService();
  const cross = service.submit({
    tenant: tenantA,
    kind: "follow",
    actor: subjectOne,
    target: subjectBeta,
    evidence: evidenceOf("social.follow.requested", String(subjectOne), String(subjectBeta), 1),
  });
  assert.ok(!cross.accepted);
  assert.equal(cross.code, "cross-tenant-access");
  // No edge was created.
  const view = service.graphView(tenantA, subjectOne, subjectOne);
  assert.ok(!("code" in view));
  assert.deepEqual(view.following, []);
});

test("tenancy: a tenant's grants never satisfy another tenant's request", () => {
  const { service } = makeService();
  // subjectOne has a grant under tenantA only; submitting under tenantB
  // is refused by least privilege before anything else.
  const foreign = service.submit({
    tenant: tenantB,
    kind: "follow",
    actor: subjectOne,
    target: subjectBeta,
    evidence: evidenceOf("social.follow.requested", String(subjectOne), String(subjectBeta), 1),
  });
  assert.ok(!foreign.accepted);
  assert.equal(foreign.code, "tenant-mismatch");
});

test("tenancy: write-permission-only grants cannot submit follows", () => {
  const { grants, service } = makeService();
  const readerOnly: ScopedCapabilityGrant = {
    tenant: tenantA,
    subject: subjectTwo,
    capability: "social",
    permissions: ["read"],
  };
  grants.grant(readerOnly);
  const refused = service.submit({
    tenant: tenantA,
    kind: "follow",
    actor: subjectTwo,
    target: subjectOne,
    evidence: evidenceOf("social.follow.requested", String(subjectTwo), String(subjectOne), 1),
  });
  assert.ok(!refused.accepted && refused.code === "permission-not-granted");
});

test("tenancy: subjects in two tenants keep fully isolated graphs", () => {
  const { service, grants, directory } = makeService();
  // A second, distinct subject under tenant B with its own grant.
  const tenantBReader = asSubjectId("player-beta-reader")!;
  directory.register(tenantB, tenantBReader);
  grants.grant(socialGrant(tenantB, tenantBReader));
  // Follow within tenant A.
  const followA = service.submit({
    tenant: tenantA,
    kind: "follow",
    actor: subjectOne,
    target: subjectTwo,
    evidence: evidenceOf("social.follow.requested", String(subjectOne), String(subjectTwo), 1),
  });
  assert.ok(followA.accepted);
  const viewA = service.graphView(tenantA, subjectOne, subjectOne);
  assert.ok(!("code" in viewA));
  assert.equal(viewA.following.length, 1);
  // A tenant B reader sees an empty graph for the same subject text and
  // a separate history; nothing leaks across the tenant boundary.
  const viewB = service.graphView(tenantB, subjectBeta, tenantBReader);
  assert.ok(!("code" in viewB));
  assert.deepEqual(viewB.following, []);
  assert.deepEqual(viewB.followers, []);
  assert.deepEqual(viewB.blocked, []);
  assert.equal(service.history(tenantB).length, 0);
  assert.equal(service.history(tenantA).length, 1);
});

test("tenancy: history queries are tenant-scoped", () => {
  const { service } = makeService();
  service.submit({
    tenant: tenantA,
    kind: "follow",
    actor: subjectOne,
    target: subjectTwo,
    evidence: evidenceOf("social.follow.requested", String(subjectOne), String(subjectTwo), 1),
  });
  assert.equal(service.history(tenantA).length, 1);
  assert.equal(service.history(tenantB).length, 0);
});
