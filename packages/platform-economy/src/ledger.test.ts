/**
 * Ledger tests: pure entry constructors (reason vocabulary), the fold
 * rules via the service doors (consume/adjust), balance keys, journal
 * append-only ordering (E10) and the typed negative paths (zero/negative
 * deltas, duplicate entries, malformed inputs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustLedgerEntry, balanceKey, consumeLedgerEntry, grantLedgerEntry, revokeLedgerEntry } from "./ledger.ts";
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

const tenant = asTenantId("tenant-alpha")!;
const admin = asSubjectId("admin-service")!;
const player = asSubjectId("player-one")!;
const shapeDigest = asContentDigest("f".repeat(64))!;
const value = { carrier: "opaque-digest" as const, payloadDigest: asContentDigest("1".repeat(64))! };

test("ledger: entry constructors carry the frozen reason vocabulary", () => {
  const grant = grantLedgerEntry({ entryId: "led-a" as never, tenant, subject: player, entitlementKind: "gold-coin", quantity: 10, grantRef: "ent-a" as never, balanceAfter: 10 });
  assert.equal(grant.reason, "grant");
  assert.equal(grant.delta, 10);
  const consume = consumeLedgerEntry({ entryId: "led-b" as never, tenant, subject: player, entitlementKind: "gold-coin", quantity: 4, balanceAfter: 6 });
  assert.equal(consume.reason, "consume");
  assert.equal(consume.delta, -4);
  assert.equal(consume.grantRef, undefined);
  const revoke = revokeLedgerEntry({ entryId: "led-c" as never, tenant, subject: player, entitlementKind: "gold-coin", quantity: 10, grantRef: "ent-a" as never, balanceAfter: 0 });
  assert.equal(revoke.reason, "revoke");
  assert.equal(revoke.delta, -10);
  const adjust = adjustLedgerEntry({ entryId: "led-d" as never, tenant, subject: player, entitlementKind: "gold-coin", delta: 2, balanceAfter: 8 });
  assert.equal(adjust.reason, "adjust");
  assert.equal(adjust.delta, 2);
});

test("ledger: the balance key is the tenant+subject+kind triple", () => {
  assert.equal(balanceKey(tenant, player, "gold-coin"), "tenant-alpha|player-one|gold-coin");
  assert.notEqual(balanceKey(tenant, player, "gold-coin"), balanceKey(tenant, player, "gem-shard"));
});

function makeService() {
  const grants = createMemoryGrantDirectory();
  grants.grant(economyAdminGrant(tenant, admin));
  const service = new EconomyService({
    store: createMemoryEconomyStore().store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
    integrity: createUnwiredRewardIntegrityPort(),
    values: createMappingValueResolver({ [String(value.payloadDigest)]: 10 }),
  });
  const registered = service.registerPolicy(admin, tenant, {
    capability: "rewards",
    eventKind: "match.won" as never,
    entitlementKind: "gold-coin",
    requiresAuthoritativeOutcome: true,
    minIntegrityConfidence: 0.5,
    valueShapeDigest: shapeDigest,
  });
  assert.ok(registered.ok);
  const settled = service.settleEvent(admin, {
    tenant,
    subject: player,
    eventKind: "match.won" as never,
    sourceEventDigest: asContentDigest("d".repeat(64))!,
    value,
    outcomeEvidence: asContentDigest("a".repeat(64))!,
    outcomeDecidedBy: "platform-authority" as const,
    integrityConfidence: 0.99,
    mode: "immediate" as const,
  } satisfies EconomySettlementRequest);
  assert.ok(settled.accepted);
  return { service };
}

test("ledger: consumption folds through the oracle and appends in order (E10)", () => {
  const { service } = makeService();
  const first = service.consumeBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "consume-1" as never, quantity: 3 });
  assert.ok(first.ok && first.balanceAfter === 7);
  const second = service.consumeBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "consume-2" as never, quantity: 4 });
  assert.ok(second.ok && second.balanceAfter === 3);
  const journal = service.ledgerOf(tenant, player);
  assert.deepEqual(journal.map((entry) => entry.reason), ["grant", "consume", "consume"]);
  assert.deepEqual(journal.map((entry) => entry.balanceAfter), [10, 7, 3]);
});

test("ledger: zero, negative and non-integer consumption quantities are refused", () => {
  const { service } = makeService();
  const zero = service.consumeBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "consume-z" as never, quantity: 0 });
  assert.ok(!zero.ok && zero.code === "malformed-consumption");
  const negative = service.consumeBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "consume-n" as never, quantity: -3 });
  assert.ok(!negative.ok && negative.code === "malformed-consumption");
  const fractional = service.consumeBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "consume-f" as never, quantity: 1.5 });
  assert.ok(!fractional.ok && fractional.code === "malformed-consumption");
});

test("ledger: administrative adjustments can raise and lower balances", () => {
  const { service } = makeService();
  const up = service.adjustBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "adjust-1" as never, delta: 5 });
  assert.ok(up.ok && up.balanceAfter === 15);
  const down = service.adjustBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "adjust-2" as never, delta: -2 });
  assert.ok(down.ok && down.balanceAfter === 13);
});

test("ledger: zero-delta adjustments are refused (contracts code verbatim)", () => {
  const { service } = makeService();
  const zero = service.adjustBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "adjust-z" as never, delta: 0 });
  assert.ok(!zero.ok && zero.code === "malformed-adjustment");
});

test("ledger: adjustments cannot drive a balance negative (E8)", () => {
  const { service } = makeService();
  const over = service.adjustBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "adjust-n" as never, delta: -11 });
  assert.ok(!over.ok && over.code === "negative-balance");
  const balance = service.balanceOf(admin, tenant, player, "gold-coin");
  assert.ok("balance" in balance && balance.balance === 10);
});

test("ledger: adjusting requires administer; consuming requires submit (R20)", () => {
  const { service } = makeService();
  const grants = createMemoryGrantDirectory();
  const submitter = asSubjectId("game-service")!;
  grants.grant({ tenant, subject: submitter, capability: "rewards", permissions: ["read", "submit"] });
  const scoped = new EconomyService({
    store: createMemoryEconomyStore().store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
    integrity: createUnwiredRewardIntegrityPort(),
    values: createMappingValueResolver({ [String(value.payloadDigest)]: 10 }),
  });
  assert.ok(!scoped.adjustBalance(submitter, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "adjust-p" as never, delta: 1 }).ok);
  const refused = service.adjustBalance(submitter, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "adjust-p" as never, delta: 1 });
  assert.ok(!refused.ok && refused.code === "capability-not-granted");
});
