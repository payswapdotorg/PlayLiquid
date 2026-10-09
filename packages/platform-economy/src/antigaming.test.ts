/**
 * Anti-gaming + service pipeline tests (E8/E10): the full settleEvent
 * journey — idempotent replays with receipts and no second mutation,
 * same-outcome cross-occurrence grant collisions, hold-mode admission,
 * settlement of unvalidated events, unresolvable values, least-
 * privilege refusals, and ledger/journal invariants after refusals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EconomyService } from "./service.ts";
import {
  createFixedClock,
  createMappingValueResolver,
  createMemoryEconomyStore,
  createMemoryGrantDirectory,
  createStaticRewardIntegrityPort,
  createUnresolvingValueResolver,
  createUnwiredRewardIntegrityPort,
  economyAdminGrant,
  economySubmitGrant,
} from "./fakes.ts";
import { asContentDigest, asLedgerEntryId, asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { EconomySettlementRequest } from "./settlement.ts";

const tenant = asTenantId("tenant-alpha")!;
const admin = asSubjectId("admin-service")!;
const player = asSubjectId("player-one")!;
const playerTwo = asSubjectId("player-two")!;
const shapeDigest = asContentDigest("f".repeat(64))!;
const outcomeA = asContentDigest("a".repeat(64))!;
const valueA = { carrier: "opaque-digest" as const, payloadDigest: asContentDigest("1".repeat(64))! };
const valueB = { carrier: "opaque-digest" as const, payloadDigest: asContentDigest("2".repeat(64))! };

function makeService(over: { integrity?: EconomyServiceOptionsLike["integrity"]; values?: EconomyServiceOptionsLike["values"] } = {}) {
  const grants = createMemoryGrantDirectory();
  grants.grant(economyAdminGrant(tenant, admin));
  const service = new EconomyService({
    store: createMemoryEconomyStore().store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
    integrity: over.integrity ?? createUnwiredRewardIntegrityPort(),
    values: over.values ?? createMappingValueResolver({ [String(valueA.payloadDigest)]: 10, [String(valueB.payloadDigest)]: 4 }),
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
  return { grants, service };
}

type EconomyServiceOptionsLike = ConstructorParameters<typeof EconomyService>[0];

function request(over: Partial<EconomySettlementRequest> = {}): EconomySettlementRequest {
  return {
    tenant,
    subject: player,
    eventKind: "match.won" as never,
    sourceEventDigest: asContentDigest("d".repeat(64))!,
    value: valueA,
    outcomeEvidence: outcomeA,
    outcomeDecidedBy: "platform-authority" as const,
    integrityConfidence: 0.99,
    mode: "immediate" as const,
    ...over,
  };
}

test("antigaming: replayed occurrences return the recorded receipt, never a second mutation (E10)", () => {
  const { service } = makeService();
  const first = service.settleEvent(admin, request());
  assert.ok(first.accepted);
  const replay = service.settleEvent(admin, request());
  assert.ok(!replay.accepted && replay.code === "duplicate-settlement");
  assert.ok(replay.recorded !== undefined);
  assert.equal(replay.recorded.receiptId, first.receipt.receiptId);
  // Exactly ONE journal row and ONE settlement: no second mutation.
  assert.equal(service.ledgerOf(tenant).length, 1);
  assert.equal(service.settlementsOf(tenant).length, 1);
  const balance = service.balanceOf(admin, tenant, player, "gold-coin");
  assert.ok("balance" in balance && balance.balance === 10 && balance.entries.length === 1);
});

test("antigaming: the same occurrence with a DIFFERENT outcome is a collision (E8)", () => {
  const { service } = makeService();
  assert.ok(service.settleEvent(admin, request()).accepted);
  const collision = service.settleEvent(admin, request({ outcomeEvidence: asContentDigest("b".repeat(64))! }));
  assert.ok(!collision.accepted && collision.code === "idempotency-collision");
  const balance = service.balanceOf(admin, tenant, player, "gold-coin");
  assert.ok("balance" in balance && balance.balance === 10);
});

test("antigaming: one outcome re-granting the same kind is refused at the grant layer (E8)", () => {
  const { service } = makeService();
  assert.ok(service.settleEvent(admin, request()).accepted);
  // A DIFFERENT occurrence digest carrying the SAME authoritative outcome:
  // the grant idempotency key {subject, outcome, kind} collides.
  const regrant = service.settleEvent(admin, request({ sourceEventDigest: asContentDigest("c".repeat(64))! }));
  assert.ok(!regrant.accepted && regrant.code === "idempotency-collision");
  // The ledger still has exactly one grant row.
  assert.equal(service.ledgerOf(tenant).length, 1);
});

test("antigaming: settlements are subject-scoped — other subjects' balances never move", () => {
  const { service } = makeService();
  assert.ok(service.settleEvent(admin, request()).accepted);
  const other = service.balanceOf(admin, tenant, playerTwo, "gold-coin");
  assert.ok("balance" in other && other.balance === 0 && other.entries.length === 0);
  // Same occurrence digest for a DIFFERENT subject is a distinct settlement.
  const distinct = service.settleEvent(admin, request({ subject: playerTwo, value: valueB }));
  assert.ok(distinct.accepted);
  const mine = service.balanceOf(admin, tenant, player, "gold-coin");
  const theirs = service.balanceOf(admin, tenant, playerTwo, "gold-coin");
  assert.ok("balance" in mine && mine.balance === 10);
  assert.ok("balance" in theirs && theirs.balance === 4);
});

test("antigaming: settlement of unvalidated events is refused and mutates nothing", () => {
  const { service } = makeService();
  const undeclared = service.settleEvent(admin, request({ eventKind: "quest.abandoned" as never }));
  assert.ok(!undeclared.accepted && undeclared.code === "event-not-declared");
  const forged = service.settleEvent(admin, request({ outcomeDecidedBy: "game-declared" as never }));
  assert.ok(!forged.accepted && forged.code === "outcome-not-authoritative");
  assert.equal(service.ledgerOf(tenant).length, 0);
  assert.equal(service.settlementsOf(tenant).length, 0);
});

test("antigaming: unresolvable magnitudes are refused and mutate nothing", () => {
  const { service } = makeService({ values: createUnresolvingValueResolver() });
  const refused = service.settleEvent(admin, request());
  assert.ok(!refused.accepted && refused.code === "value-not-resolvable");
  assert.equal(service.ledgerOf(tenant).length, 0);
});

test("antigaming: the integrity port overrides self-declared confidence at the service level (R10/R11)", () => {
  const { service } = makeService({ integrity: createStaticRewardIntegrityPort(0.1) });
  const refused = service.settleEvent(admin, request());
  assert.ok(!refused.accepted && refused.code === "integrity-below-threshold");
  assert.equal(service.ledgerOf(tenant).length, 0);
});

test("antigaming: submit grants are required; readers cannot settle (R20)", () => {
  const { grants, service } = makeService();
  const submitter = asSubjectId("game-service")!;
  grants.grant(economySubmitGrant(tenant, submitter));
  assert.ok(service.settleEvent(submitter, request()).accepted);
  grants.revokeAll();
  grants.grant({ tenant, subject: admin, capability: "rewards", permissions: ["read"] });
  const refused = service.settleEvent(admin, request({ sourceEventDigest: asContentDigest("3".repeat(64))! }));
  assert.ok(!refused.accepted && refused.code === "permission-not-granted");
});

test("antigaming: hold-mode settlement credits the balance but records no settlement", () => {
  const { service } = makeService();
  const held = service.settleEvent(admin, request({
    mode: "hold",
    holdCauseDigest: asContentDigest("9".repeat(64))!,
  }));
  assert.ok(held.accepted);
  assert.equal(held.receipt.lifecycle, "held");
  assert.equal(held.receipt.settlementId, undefined);
  const balance = service.balanceOf(admin, tenant, player, "gold-coin");
  assert.ok("balance" in balance && balance.balance === 10);
  assert.equal(service.settlementsOf(tenant).length, 0);
  // The entitlement is inspectable in its held state.
  const view = service.entitlementView(admin, tenant, held.receipt.grantId);
  assert.ok(!("ok" in view) && view.lifecycle.state === "held");
});

test("antigaming: consumption cannot exceed the granted balance (E8)", () => {
  const { service } = makeService();
  assert.ok(service.settleEvent(admin, request()).accepted);
  const consumed = service.consumeBalance(admin, {
    tenant, subject: player, entitlementKind: "gold-coin",
    entryId: asLedgerEntryId("consume-1")!, quantity: 4,
  });
  assert.ok(consumed.ok && consumed.balanceAfter === 6);
  const over = service.consumeBalance(admin, {
    tenant, subject: player, entitlementKind: "gold-coin",
    entryId: asLedgerEntryId("consume-2")!, quantity: 7,
  });
  assert.ok(!over.ok && over.code === "negative-balance");
  const balance = service.balanceOf(admin, tenant, player, "gold-coin");
  assert.ok("balance" in balance && balance.balance === 6 && balance.entries.length === 2);
});

test("antigaming: replayed consumption entries are duplicates (E10)", () => {
  const { service } = makeService();
  assert.ok(service.settleEvent(admin, request()).accepted);
  const input = {
    tenant, subject: player, entitlementKind: "gold-coin",
    entryId: asLedgerEntryId("consume-1")!, quantity: 4,
  };
  assert.ok(service.consumeBalance(admin, input).ok);
  const replay = service.consumeBalance(admin, input);
  assert.ok(!replay.ok && replay.code === "duplicate-entry");
  assert.equal(service.ledgerOf(tenant).length, 2); // grant + one consume
});
