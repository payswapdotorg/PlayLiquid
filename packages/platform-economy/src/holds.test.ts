/**
 * Lifecycle door tests: holds (double-hold refusals, E8), settlement
 * completion (terminal, never re-applied, E9/E10), revocation (clawback
 * applied or typed refusal) and the stale/illegal/duplicate command
 * vocabulary surfaced verbatim from the contracts state machine.
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
const holdCause = asContentDigest("9".repeat(64))!;
const revokeCause = asContentDigest("5".repeat(64))!;

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
  return { grants, service };
}

function holdRequest(digest: string): EconomySettlementRequest {
  return {
    tenant,
    subject: player,
    eventKind: "match.won" as never,
    sourceEventDigest: asContentDigest(digest)!,
    value,
    outcomeEvidence: asContentDigest(digest)!,
    outcomeDecidedBy: "platform-authority" as const,
    integrityConfidence: 0.99,
    mode: "hold",
    holdCauseDigest: holdCause,
  };
}

function grantedHold(service: EconomyService, digest: string): string {
  const held = service.settleEvent(admin, holdRequest(digest));
  assert.ok(held.accepted);
  return held.receipt.grantId;
}

test("holds: a granted entitlement can be held once, then completes terminally (E9)", () => {
  const { service } = makeService();
  const entitlement = grantedHold(service, "d".repeat(64));
  const completed = service.completeSettlement(admin, { tenant, entitlement: entitlement as never, against: "held", attempt: "a1" });
  assert.ok(completed.ok);
  // The completed settlement NEVER re-applies: new attempts are stale.
  const stale = service.completeSettlement(admin, { tenant, entitlement: entitlement as never, against: "held", attempt: "a2" });
  assert.ok(!stale.ok && stale.code === "stale-command");
  const illegal = service.completeSettlement(admin, { tenant, entitlement: entitlement as never, against: "settled", attempt: "a3" });
  assert.ok(!illegal.ok && illegal.code === "illegal-transition");
  assert.equal(service.settlementsOf(tenant).length, 1);
});

test("holds: double holds are refused with typed codes (E8)", () => {
  const { service } = makeService();
  const entitlement = grantedHold(service, "d".repeat(64));
  // The admission already held it; an explicit hold of a HELD entitlement:
  const sameAttempt = service.holdEntitlement(admin, { tenant, entitlement: entitlement as never, against: "granted", attempt: `hold-led-${String(entitlement).slice(4)}`, holdCauseDigest: holdCause });
  assert.ok(!sameAttempt.ok && sameAttempt.code === "duplicate-command");
  const freshAttempt = service.holdEntitlement(admin, { tenant, entitlement: entitlement as never, against: "granted", attempt: "hold-2", holdCauseDigest: holdCause });
  assert.ok(!freshAttempt.ok && freshAttempt.code === "stale-command");
  const againstHeld = service.holdEntitlement(admin, { tenant, entitlement: entitlement as never, against: "held", attempt: "hold-3", holdCauseDigest: holdCause });
  assert.ok(!againstHeld.ok && againstHeld.code === "illegal-transition");
  // A settle-hold from "granted" against an entitlement ALREADY settled:
  const settledEntitlement = (() => {
    const immediate = service.settleEvent(admin, { ...holdRequest("c".repeat(64)), mode: "immediate", holdCauseDigest: undefined });
    assert.ok(immediate.accepted);
    return immediate.receipt.grantId;
  })();
  const heldAgain = service.holdEntitlement(admin, { tenant, entitlement: settledEntitlement as never, against: "granted", attempt: "hold-4", holdCauseDigest: holdCause });
  assert.ok(!heldAgain.ok && heldAgain.code === "stale-command");
});

test("holds: malformed and unknown hold commands are refused", () => {
  const { service } = makeService();
  const malformed = service.holdEntitlement(admin, { tenant, entitlement: "" as never, against: "held", attempt: "x", holdCauseDigest: holdCause });
  assert.ok(!malformed.ok && malformed.code === "malformed-command");
  const unknown = service.holdEntitlement(admin, { tenant, entitlement: "ent-nope" as never, against: "granted", attempt: "x", holdCauseDigest: holdCause });
  assert.ok(!unknown.ok && unknown.code === "unknown-entitlement");
  const badCause = service.holdEntitlement(admin, { tenant, entitlement: "ent-nope" as never, against: "granted", attempt: "x", holdCauseDigest: "not-a-digest" as never });
  assert.ok(!badCause.ok && badCause.code === "malformed-command");
});

test("holds: revocation is terminal and claws back the granted amount", () => {
  const { service } = makeService();
  const entitlement = grantedHold(service, "d".repeat(64));
  const revoked = service.revokeEntitlement(admin, {
    tenant, entitlement: entitlement as never, against: "held", attempt: "r1",
    reason: "integrity-enforcement", revocationCauseDigest: revokeCause,
  });
  assert.ok(revoked.ok && revoked.state === "revoked");
  assert.ok(revoked.clawback.applied && revoked.clawback.balanceAfter === 0);
  const balance = service.balanceOf(admin, tenant, player, "gold-coin");
  assert.ok("balance" in balance && balance.balance === 0);
  // Revoked is terminal: nothing transitions out of it.
  const settleAfter = service.completeSettlement(admin, { tenant, entitlement: entitlement as never, against: "held", attempt: "a9" });
  assert.ok(!settleAfter.ok && settleAfter.code === "stale-command");
});

test("holds: revoking a settled entitlement is refused (settled is terminal, E10)", () => {
  const { service } = makeService();
  const immediate = service.settleEvent(admin, { ...holdRequest("c".repeat(64)), mode: "immediate", holdCauseDigest: undefined });
  assert.ok(immediate.accepted);
  const refused = service.revokeEntitlement(admin, {
    tenant, entitlement: immediate.receipt.grantId as never, against: "settled", attempt: "r1",
    reason: "administrative", revocationCauseDigest: revokeCause,
  });
  assert.ok(!refused.ok && refused.code === "illegal-transition");
});

test("holds: clawback over a consumed balance is refused with a typed code, never clamped", () => {
  const { service } = makeService();
  const entitlement = grantedHold(service, "d".repeat(64));
  const consumed = service.consumeBalance(admin, {
    tenant, subject: player, entitlementKind: "gold-coin",
    entryId: "consume-1" as never, quantity: 6,
  });
  assert.ok(consumed.ok && consumed.balanceAfter === 4);
  const revoked = service.revokeEntitlement(admin, {
    tenant, entitlement: entitlement as never, against: "held", attempt: "r1",
    reason: "policy-violation", revocationCauseDigest: revokeCause,
  });
  assert.ok(revoked.ok);
  assert.ok(!revoked.clawback.applied && revoked.clawback.code === "negative-balance");
  // The partial balance stands — the correction is host policy (adjust door).
  const balance = service.balanceOf(admin, tenant, player, "gold-coin");
  assert.ok("balance" in balance && balance.balance === 4);
});

test("holds: lifecycle administration requires the administer permission (R20)", () => {
  const { grants, service } = makeService();
  const submitter = asSubjectId("game-service")!;
  grants.grant({ tenant, subject: submitter, capability: "rewards", permissions: ["read", "submit"] });
  const entitlement = grantedHold(service, "d".repeat(64));
  const refused = service.holdEntitlement(submitter, { tenant, entitlement: entitlement as never, against: "granted", attempt: "h1", holdCauseDigest: holdCause });
  assert.ok(!refused.ok && refused.code === "permission-not-granted");
});
