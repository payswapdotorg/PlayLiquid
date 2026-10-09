/**
 * Service journey tests: end-to-end golden paths (declare -> settle ->
 * consume), hold-then-complete and hold-then-revoke flows, snapshot /
 * restore round-trips (E6 port contract, E10 receipts surviving), and
 * E9 byte-determinism of snapshots over the same command sequence.
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

const tenant = asTenantId("tenant-alpha")!;
const admin = asSubjectId("admin-service")!;
const player = asSubjectId("player-one")!;
const shapeDigest = asContentDigest("f".repeat(64))!;
const value = { carrier: "opaque-digest" as const, payloadDigest: asContentDigest("1".repeat(64))! };

function declaration(entitlementKind = "gold-coin") {
  return {
    capability: "rewards" as const,
    eventKind: "match.won" as never,
    entitlementKind,
    requiresAuthoritativeOutcome: true as const,
    minIntegrityConfidence: 0.5,
    valueShapeDigest: shapeDigest,
  };
}

function request(over: Partial<EconomySettlementRequest> = {}): EconomySettlementRequest {
  return {
    tenant,
    subject: player,
    eventKind: "match.won" as never,
    sourceEventDigest: asContentDigest("d".repeat(64))!,
    value,
    outcomeEvidence: asContentDigest("a".repeat(64))!,
    outcomeDecidedBy: "platform-authority" as const,
    integrityConfidence: 0.99,
    mode: "immediate" as const,
    ...over,
  };
}

function makeService(store = createMemoryEconomyStore()) {
  const grants = createMemoryGrantDirectory();
  grants.grant(economyAdminGrant(tenant, admin));
  const service = new EconomyService({
    store: store.store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
    integrity: createUnwiredRewardIntegrityPort(),
    values: createMappingValueResolver({ [String(value.payloadDigest)]: 10 }),
  });
  assert.ok(service.registerPolicy(admin, tenant, declaration()).ok);
  return { grants, service, store };
}

test("service: the golden path — declare, settle, consume (R10 end to end)", () => {
  const { service } = makeService();
  const settled = service.settleEvent(admin, request());
  assert.ok(settled.accepted);
  assert.equal(settled.receipt.quantity, 10);
  assert.equal(settled.receipt.balanceAfter, 10);
  assert.equal(settled.receipt.lifecycle, "settled");
  assert.ok(settled.receipt.settlementId !== undefined);
  const consumed = service.consumeBalance(admin, {
    tenant, subject: player, entitlementKind: "gold-coin",
    entryId: "consume-1" as never, quantity: 7,
  });
  assert.ok(consumed.ok && consumed.balanceAfter === 3);
  // The settlement record is the append-only audit artifact.
  const records = service.settlementsOf(tenant);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.entitlement, settled.receipt.grantId);
  assert.equal(records[0]!.lifecycle, "settled");
  assert.equal(records[0]!.decidedBy, "platform-authority");
  assert.equal(records[0]!.ruleRef.entitlementKind, "gold-coin");
});

test("service: hold-then-complete finalizes with the deterministic settlement id", () => {
  const { service } = makeService();
  const held = service.settleEvent(admin, request({ mode: "hold", holdCauseDigest: asContentDigest("9".repeat(64))! }));
  assert.ok(held.accepted && held.receipt.lifecycle === "held");
  const completed = service.completeSettlement(admin, {
    tenant, entitlement: held.receipt.grantId, against: "held", attempt: "a1",
  });
  assert.ok(completed.ok);
  // The settlement id the completion minted matches the immediate-mode rule.
  assert.equal(completed.settlementId, held.receipt.grantId.replace(/^ent-/, "stl-") as never);
  const view = service.entitlementView(admin, tenant, held.receipt.grantId);
  assert.ok(!("ok" in view) && view.lifecycle.state === "settled");
  assert.equal(view.lifecycle.history.length, 2); // granted->held, held->settled
});

test("service: snapshot and restore round-trip state and receipts (E6/E10)", () => {
  const { store, service } = makeService();
  assert.ok(service.settleEvent(admin, request()).accepted);
  const snapshot = service.snapshot();
  assert.ok(snapshot.ok);
  const grants = createMemoryGrantDirectory();
  grants.grant(economyAdminGrant(tenant, admin));
  const adopted = new EconomyService({
    store: store.store,
    clock: createFixedClock(9_999).clock,
    grants: grants.grantsDirectory,
    integrity: createUnwiredRewardIntegrityPort(),
    values: createMappingValueResolver({ [String(value.payloadDigest)]: 10 }),
  });
  const restored = adopted.restore(snapshot.snapshotId);
  assert.ok(restored.ok);
  // A replayed occurrence still returns the recorded receipt (E10).
  const replay = adopted.settleEvent(admin, request());
  assert.ok(!replay.accepted && replay.code === "duplicate-settlement" && replay.recorded !== undefined);
  const balance = adopted.balanceOf(admin, tenant, player, "gold-coin");
  assert.ok("balance" in balance && balance.balance === 10);
  assert.equal(adopted.settlementsOf(tenant).length, 1);
});

test("service: restore refuses unknown and malformed snapshots", () => {
  const { service } = makeService();
  const noSnapshot = service.restore();
  assert.ok(!noSnapshot.ok && noSnapshot.code === "unknown-snapshot");
  // A bare service with no admitted state has nothing to snapshot.
  const bare = new EconomyService({
    store: createMemoryEconomyStore().store,
    clock: createFixedClock().clock,
    grants: createMemoryGrantDirectory().grantsDirectory,
    integrity: createUnwiredRewardIntegrityPort(),
    values: createMappingValueResolver({}, 10),
  });
  const empty = bare.snapshot();
  assert.ok(!empty.ok && empty.code === "empty-state");
});

test("service: the same command sequence yields byte-identical snapshots (E9)", () => {
  function journey(): { readonly service: EconomyService; readonly store: ReturnType<typeof createMemoryEconomyStore>; readonly snapshot: ReturnType<EconomyService["snapshot"]> } {
    const built = makeService();
    built.service.settleEvent(admin, request());
    built.service.settleEvent(admin, request({ sourceEventDigest: asContentDigest("e".repeat(64))!, mode: "hold", holdCauseDigest: asContentDigest("9".repeat(64))! }));
    built.service.consumeBalance(admin, { tenant, subject: player, entitlementKind: "gold-coin", entryId: "consume-1" as never, quantity: 4 });
    return { service: built.service, store: built.store, snapshot: built.service.snapshot() };
  }
  const first = journey();
  const second = journey();
  assert.ok(first.snapshot.ok && second.snapshot.ok);
  assert.equal(String(first.snapshot.snapshotId), String(second.snapshot.snapshotId));
  // Restoring from the SAME store and re-snapshotting is also byte-stable.
  const grants = createMemoryGrantDirectory();
  grants.grant(economyAdminGrant(tenant, admin));
  const resumed = new EconomyService({
    store: first.store.store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
    integrity: createUnwiredRewardIntegrityPort(),
    values: createMappingValueResolver({ [String(value.payloadDigest)]: 10 }),
  });
  const restored = resumed.restore(first.snapshot.snapshotId);
  assert.ok(restored.ok);
  const resnap = resumed.snapshot();
  assert.ok(resnap.ok && String(resnap.snapshotId) === String(first.snapshot.snapshotId));
});

test("service: settle refusals leave revision and journals untouched", () => {
  const { service } = makeService();
  assert.ok(service.settleEvent(admin, request()).accepted);
  const before = service.ledgerOf(tenant).length;
  const refused = service.settleEvent(admin, request({ eventKind: "quest.abandoned" as never }));
  assert.ok(!refused.accepted);
  assert.equal(service.ledgerOf(tenant).length, before);
  assert.equal(service.settlementsOf(tenant).length, 1);
});
