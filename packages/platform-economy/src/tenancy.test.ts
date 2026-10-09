/**
 * R20 tenant-isolation + least-privilege tests for the economy service:
 * cross-tenant settlement/registration/consumption, tenant-scoped
 * journals and read models, and cross-tenant grant probing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EconomyService } from "./service.ts";
import {
  createFixedClock,
  createMappingValueResolver,
  createMemoryEconomyStore,
  createMemoryGrantDirectory,
  createUnwiredRewardIntegrityPort,
  economyAdminGrant,
} from "./fakes.ts";
import { asContentDigest, asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { EconomySettlementRequest } from "./settlement.ts";

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const adminA = asSubjectId("admin-a")!;
const playerOne = asSubjectId("player-one")!;
const shapeDigest = asContentDigest("f".repeat(64))!;
const value = { carrier: "opaque-digest" as const, payloadDigest: asContentDigest("1".repeat(64))! };

function makeService() {
  const grants = createMemoryGrantDirectory();
  grants.grant(economyAdminGrant(tenantA, adminA));
  const service = new EconomyService({
    store: createMemoryEconomyStore().store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
    integrity: createUnwiredRewardIntegrityPort(),
    values: createMappingValueResolver({ [String(value.payloadDigest)]: 10 }),
  });
  const registered = service.registerPolicy(adminA, tenantA, {
    capability: "rewards",
    eventKind: "match.won" as never,
    entitlementKind: "gold-coin",
    requiresAuthoritativeOutcome: true,
    minIntegrityConfidence: 0.5,
    valueShapeDigest: shapeDigest,
  });
  assert.ok(registered.ok);
  return { grants, service };
}

function request(tenant: { toString(): string }, over: Record<string, unknown> = {}): EconomySettlementRequest {
  return {
    tenant: tenant as never,
    subject: playerOne,
    eventKind: "match.won" as never,
    sourceEventDigest: asContentDigest("d".repeat(64))!,
    value,
    outcomeEvidence: asContentDigest("a".repeat(64))!,
    outcomeDecidedBy: "platform-authority" as const,
    integrityConfidence: 0.99,
    mode: "immediate" as const,
    ...over,
  } as EconomySettlementRequest;
}

test("tenancy: a tenant-A admin cannot settle events scoped to tenant B", () => {
  const { service } = makeService();
  const cross = service.settleEvent(adminA, request(tenantB));
  assert.ok(!cross.accepted && cross.code === "tenant-mismatch");
  // Nothing was created for tenant B.
  assert.equal(service.ledgerOf(tenantB).length, 0);
  assert.equal(service.settlementsOf(tenantB).length, 0);
});

test("tenancy: a tenant-A admin cannot register policies in tenant B", () => {
  const { service } = makeService();
  const cross = service.registerPolicy(adminA, tenantB, {
    capability: "rewards",
    eventKind: "match.won" as never,
    entitlementKind: "gold-coin",
    requiresAuthoritativeOutcome: true,
    minIntegrityConfidence: 0.5,
    valueShapeDigest: shapeDigest,
  });
  assert.ok(!cross.ok && cross.code === "tenant-mismatch");
});

test("tenancy: cross-tenant holds, completions, revocations and consumption are refused", () => {
  const { service } = makeService();
  const held = service.settleEvent(adminA, request(tenantA, { mode: "hold", holdCauseDigest: asContentDigest("9".repeat(64))! }));
  assert.ok(held.accepted);
  const entitlement = held.receipt.grantId;
  // Privilege fires FIRST: the tenant-A actor holds no tenant-B grants.
  const crossHold = service.holdEntitlement(adminA, { tenant: tenantB, entitlement, against: "held", attempt: "h1", holdCauseDigest: asContentDigest("9".repeat(64))! });
  assert.ok(!crossHold.ok && crossHold.code === "tenant-mismatch");
  const crossComplete = service.completeSettlement(adminA, { tenant: tenantB, entitlement, against: "held", attempt: "c1" });
  assert.ok(!crossComplete.ok && crossComplete.code === "tenant-mismatch");
  const crossRevoke = service.revokeEntitlement(adminA, { tenant: tenantB, entitlement, against: "held", attempt: "r1", reason: "administrative", revocationCauseDigest: asContentDigest("5".repeat(64))! });
  assert.ok(!crossRevoke.ok && crossRevoke.code === "tenant-mismatch");
  const crossConsume = service.consumeBalance(adminA, { tenant: tenantB, subject: playerOne, entitlementKind: "gold-coin", entryId: "consume-x" as never, quantity: 1 });
  assert.ok(!crossConsume.ok && crossConsume.code === "tenant-mismatch");
  // The entitlement is untouched by the cross-tenant attempts.
  const view = service.entitlementView(adminA, tenantA, entitlement);
  assert.ok(!("ok" in view) && view.lifecycle.state === "held");
});

test("tenancy: a tenant-B grant never satisfies a tenant-A request", () => {
  const { grants, service } = makeService();
  const adminB = asSubjectId("admin-b")!;
  grants.grant(economyAdminGrant(tenantB, adminB));
  const cross = service.settleEvent(adminB, request(tenantA));
  assert.ok(!cross.accepted && cross.code === "tenant-mismatch");
  // The same admin can act in their own tenant.
  const home = service.registerPolicy(adminB, tenantB, {
    capability: "rewards",
    eventKind: "match.won" as never,
    entitlementKind: "gem-shard",
    requiresAuthoritativeOutcome: true,
    minIntegrityConfidence: 0.5,
    valueShapeDigest: shapeDigest,
  });
  assert.ok(home.ok);
  assert.ok(service.settleEvent(adminB, request(tenantB)).accepted);
});

test("tenancy: journals and settlement records are tenant-scoped", () => {
  const { grants, service } = makeService();
  const adminB = asSubjectId("admin-b")!;
  grants.grant(economyAdminGrant(tenantB, adminB));
  assert.ok(service.registerPolicy(adminB, tenantB, {
    capability: "rewards",
    eventKind: "match.won" as never,
    entitlementKind: "gem-shard",
    requiresAuthoritativeOutcome: true,
    minIntegrityConfidence: 0.5,
    valueShapeDigest: shapeDigest,
  }).ok);
  assert.ok(service.settleEvent(adminA, request(tenantA)).accepted);
  assert.ok(service.settleEvent(adminB, request(tenantB, { sourceEventDigest: asContentDigest("e".repeat(64))! })).accepted);
  assert.equal(service.ledgerOf(tenantA).length, 1);
  assert.equal(service.ledgerOf(tenantB).length, 1);
  assert.equal(service.settlementsOf(tenantA).length, 1);
  assert.equal(service.settlementsOf(tenantB).length, 1);
  // Tenant A's balance view never shows tenant B's rows.
  const mine = service.balanceOf(adminA, tenantA, playerOne, "gold-coin");
  assert.ok("balance" in mine && mine.balance === 10 && mine.entries.length === 1);
});

test("tenancy: the same subject text in two tenants is two disjoint ledger scopes", () => {
  const { grants, service } = makeService();
  const adminB = asSubjectId("admin-b")!;
  grants.grant(economyAdminGrant(tenantB, adminB));
  assert.ok(service.registerPolicy(adminB, tenantB, {
    capability: "rewards",
    eventKind: "match.won" as never,
    entitlementKind: "gold-coin",
    requiresAuthoritativeOutcome: true,
    minIntegrityConfidence: 0.5,
    valueShapeDigest: shapeDigest,
  }).ok);
  assert.ok(service.settleEvent(adminA, request(tenantA)).accepted);
  assert.ok(service.settleEvent(adminB, request(tenantB, { sourceEventDigest: asContentDigest("e".repeat(64))! })).accepted);
  const balanceA = service.balanceOf(adminA, tenantA, playerOne, "gold-coin");
  const balanceB = service.balanceOf(adminB, tenantB, playerOne, "gold-coin");
  assert.ok("balance" in balanceA && balanceA.balance === 10);
  assert.ok("balance" in balanceB && balanceB.balance === 10);
  assert.equal(balanceA.entries.length, 1);
  assert.equal(balanceB.entries.length, 1);
});
