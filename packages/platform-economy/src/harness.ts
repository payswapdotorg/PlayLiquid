/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full economy journey over the in-memory fakes: register a
 * reward policy -> settle a declared event immediately (grant + credit
 * + settlement record) -> replay returns the recorded receipt (E10) ->
 * hold-mode settlement -> double hold refused (E8) -> complete the held
 * settlement (E9: a completed settlement never re-applies) -> revoke a
 * held entitlement with clawback -> consume / over-consume refusals ->
 * cross-tenant refusal (R20) -> unvalidated event refusal -> integrity
 * port override refusal (R10/R11) -> snapshot byte-determinism (E9).
 * Prints deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no clock, no randomness,
 * no network.
 */

import { EconomyService } from "./service.ts";
import {
  createFixedClock,
  createMappingValueResolver,
  createMemoryEconomyStore,
  createMemoryGrantDirectory,
  createStaticRewardIntegrityPort,
  createUnwiredRewardIntegrityPort,
  economyAdminGrant,
} from "./fakes.ts";
import {
  asContentDigest,
  asSubjectId,
  asTenantId,
  asLedgerEntryId,
} from "@playliquid/platform-contracts";
import type { EconomySettlementRequest } from "./settlement.ts";

const tenant = asTenantId("tenant-harness")!;
const admin = asSubjectId("admin-service")!;
const player = asSubjectId("player-one")!;
const outcomeA = asContentDigest("a".repeat(64))!;
const outcomeB = asContentDigest("b".repeat(64))!;
const outcomeC = asContentDigest("c".repeat(64))!;
const valueA = { carrier: "opaque-digest" as const, payloadDigest: asContentDigest("1".repeat(64))! };
const valueB = { carrier: "opaque-digest" as const, payloadDigest: asContentDigest("2".repeat(64))! };
const shapeDigest = asContentDigest("f".repeat(64))!;

const grants = createMemoryGrantDirectory();
grants.grant(economyAdminGrant(tenant, admin));
const store = createMemoryEconomyStore();
const service = new EconomyService({
  store: store.store,
  clock: createFixedClock().clock,
  grants: grants.grantsDirectory,
  integrity: createUnwiredRewardIntegrityPort(),
  values: createMappingValueResolver({ [String(valueA.payloadDigest)]: 10, [String(valueB.payloadDigest)]: 25 }),
});

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

function declaration(eventKind: string, entitlementKind: string, minIntegrityConfidence: number) {
  return {
    capability: "rewards" as const,
    eventKind: eventKind as never,
    entitlementKind,
    requiresAuthoritativeOutcome: true as const,
    minIntegrityConfidence,
    valueShapeDigest: shapeDigest,
  };
}

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

// 1. Register a reward policy.
const registered = service.registerPolicy(admin, tenant, declaration("match.won", "gold-coin", 0.5));
record("register-policy", "ok", registered.ok ? "ok" : `refused:${registered.code}`);

// 2. Immediate settlement: grant + credit + settlement record.
const settled = service.settleEvent(admin, request());
record("settle-immediate", "settled:10", settled.accepted ? `${settled.receipt.lifecycle}:${settled.receipt.quantity}` : `refused:${settled.code}`);

// 3. Replay returns the recorded receipt (E10), no second mutation.
const replay = service.settleEvent(admin, request());
record(
  "replay",
  "refused:duplicate-settlement+receipt",
  replay.accepted ? "accepted" : `refused:${replay.code}${replay.recorded !== undefined ? "+receipt" : ""}`,
);
const balanceAfterReplay = service.balanceOf(admin, tenant, player, "gold-coin");
record("balance-after-replay", "10", "balance" in balanceAfterReplay ? String(balanceAfterReplay.balance) : `refused:${balanceAfterReplay.code}`);

// 4. Hold-mode settlement: credited but pending.
const held = service.settleEvent(admin, request({
  sourceEventDigest: asContentDigest("e".repeat(64))!,
  outcomeEvidence: outcomeB,
  value: valueB,
  mode: "hold",
  holdCauseDigest: asContentDigest("9".repeat(64))!,
}));
record("settle-hold", "held:25", held.accepted ? `${held.receipt.lifecycle}:${held.receipt.quantity}` : `refused:${held.code}`);

// 5. Double hold refused (E8).
const grantId = held.accepted ? held.receipt.grantId : ("ent-none" as never);
const doubleHold = service.holdEntitlement(admin, {
  tenant, entitlement: grantId, against: "held", attempt: "hold-2",
  holdCauseDigest: asContentDigest("8".repeat(64))!,
});
record("double-hold", "refused:illegal-transition", doubleHold.ok ? "ok" : `refused:${doubleHold.code}`);

// 6. Complete the held settlement (E9 terminal).
const completed = service.completeSettlement(admin, { tenant, entitlement: grantId, against: "held", attempt: "attempt-1" });
record("complete-settlement", "ok", completed.ok ? "ok" : `refused:${completed.code}`);

// 7. A completed settlement never re-applies (E9).
const recomplete = service.completeSettlement(admin, { tenant, entitlement: grantId, against: "held", attempt: "attempt-2" });
record("recomplete", "refused:stale-command", recomplete.ok ? "ok" : `refused:${recomplete.code}`);
record("settlements", "2", String(service.settlementsOf(tenant).length));

// 8. Revoke a held entitlement with clawback.
const pending = service.settleEvent(admin, request({
  sourceEventDigest: asContentDigest("7".repeat(64))!,
  outcomeEvidence: outcomeC,
  mode: "hold",
  holdCauseDigest: asContentDigest("6".repeat(64))!,
}));
const pendingGrant = pending.accepted ? pending.receipt.grantId : ("ent-none" as never);
const revoked = service.revokeEntitlement(admin, {
  tenant, entitlement: pendingGrant, against: "held", attempt: "revoke-1",
  reason: "policy-violation", revocationCauseDigest: asContentDigest("5".repeat(64))!,
});
record(
  "revoke",
  "revoked+clawback",
  revoked.ok ? `${revoked.state}${revoked.clawback.applied ? "+clawback" : `+refused:${revoked.clawback.code}`}` : `refused:${revoked.code}`,
);

// 9. Consume; over-consume refused (E8 negative balance).
const consumed = service.consumeBalance(admin, {
  tenant, subject: player, entitlementKind: "gold-coin",
  entryId: asLedgerEntryId("consume-harness-1")!, quantity: 5,
});
record("consume", "30", consumed.ok ? String(consumed.balanceAfter) : `refused:${consumed.code}`);
const overConsume = service.consumeBalance(admin, {
  tenant, subject: player, entitlementKind: "gold-coin",
  entryId: asLedgerEntryId("consume-harness-2")!, quantity: 99,
});
record("over-consume", "refused:negative-balance", overConsume.ok ? "ok" : `refused:${overConsume.code}`);

// 10. Cross-tenant settlement refused (R20).
const foreign = asTenantId("tenant-foreign")!;
const crossTenant = service.settleEvent(admin, request({ tenant: foreign }));
record("cross-tenant", "refused:tenant-mismatch", crossTenant.accepted ? "accepted" : `refused:${crossTenant.code}`);

// 11. Unvalidated (undeclared) event refused.
const undeclared = service.settleEvent(admin, request({ eventKind: "quest.abandoned" as never }));
record("undeclared-event", "refused:event-not-declared", undeclared.accepted ? "accepted" : `refused:${undeclared.code}`);

// 12. Integrity port reading overrides the self-declared confidence (R10/R11).
const strict = new EconomyService({
  store: createMemoryEconomyStore().store,
  clock: createFixedClock().clock,
  grants: grants.grantsDirectory,
  integrity: createStaticRewardIntegrityPort(0.2),
  values: createMappingValueResolver({ [String(valueA.payloadDigest)]: 10 }),
});
strict.registerPolicy(admin, tenant, declaration("match.won", "gold-coin", 0.5));
const overridden = strict.settleEvent(admin, request());
record("integrity-override", "refused:integrity-below-threshold", overridden.accepted ? "accepted" : `refused:${overridden.code}`);

// 13. Snapshot byte-determinism (E9): the same command sequence twice, same digest.
const first = service.snapshot();
const again = new EconomyService({
  store: createMemoryEconomyStore().store,
  clock: createFixedClock().clock,
  grants: grants.grantsDirectory,
  integrity: createUnwiredRewardIntegrityPort(),
  values: createMappingValueResolver({ [String(valueA.payloadDigest)]: 10, [String(valueB.payloadDigest)]: 25 }),
});
again.registerPolicy(admin, tenant, declaration("match.won", "gold-coin", 0.5));
again.settleEvent(admin, request());
again.settleEvent(admin, request());
again.settleEvent(admin, request({
  sourceEventDigest: asContentDigest("e".repeat(64))!, outcomeEvidence: outcomeB, value: valueB,
  mode: "hold", holdCauseDigest: asContentDigest("9".repeat(64))!,
}));
again.completeSettlement(admin, { tenant, entitlement: grantId, against: "held", attempt: "attempt-1" });
const replayedPending = again.settleEvent(admin, request({
  sourceEventDigest: asContentDigest("7".repeat(64))!, outcomeEvidence: outcomeC,
  mode: "hold", holdCauseDigest: asContentDigest("6".repeat(64))!,
}));
again.revokeEntitlement(admin, {
  tenant, entitlement: replayedPending.accepted ? replayedPending.receipt.grantId : ("ent-none" as never),
  against: "held", attempt: "revoke-1",
  reason: "policy-violation", revocationCauseDigest: asContentDigest("5".repeat(64))!,
});
again.consumeBalance(admin, {
  tenant, subject: player, entitlementKind: "gold-coin",
  entryId: asLedgerEntryId("consume-harness-1")!, quantity: 5,
});
const second = again.snapshot();
record(
  "snapshot-determinism",
  first.ok ? first.snapshotId : "no-snapshot",
  second.ok ? String(second.snapshotId) : `refused:${second.code}`,
);

const failures = steps.filter((item) => item.expected !== item.actual);
console.log(JSON.stringify({ harness: "platform-economy", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
