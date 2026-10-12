/**
 * TENANCY + ENTITLEMENT NEGATIVE TESTS (PL-037; R20/R10, E8).
 *
 * R20: cross-tenant access is a TYPED refusal on every platform service
 * the game consumes — identity-registered subjects hold grants ONLY in the
 * game's tenant, so any other-tenant request is refused with the
 * least-privilege oracle's own codes, and NOTHING is created or mutated
 * on either side (no partial effects).
 *
 * Entitlements (R10): rewards settle ONLY through the platform economy —
 * a below-threshold integrity confidence refuses settlement, and a
 * consumption beyond the balance is a typed `negative-balance` refusal
 * that leaves the ledger untouched.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mintLedgerEntryId } from "../../../packages/platform-economy/src/index.ts";
import { asContentDigest, asTimestampMs } from "../../../packages/platform-contracts/src/index.ts";
import { runCanonicalPlaythrough } from "./playthrough.ts";
import { createPlatformRig } from "./platform-services.ts";
import { settlementRequestOf, socialCommandOf, scoreRecordOf, achievementEvidencesOf, integrityRequestOf, completedEventOf, CANONICAL_FOLLOW } from "./outcomes.ts";
import { LUMEN_BOARD, LUMEN_SETTLEMENT } from "./platform-policy.ts";
import { OTHER_TENANT, OPERATOR, PLAYER_ONE, TENANT, REPLAY_ID } from "./ids.ts";

const run = await runCanonicalPlaythrough();
const completed = completedEventOf([...run.events]);
if (completed === undefined) throw new Error("the canonical run did not complete");
const document = run.composition.document;

/** A fresh rig (no recorded verdicts, no settled rewards). */
const rig = createPlatformRig(document);

// ---------------------------------------------------------------------------
// R20: cross-tenant access is a typed refusal on every consumed service
// ---------------------------------------------------------------------------

test("tenancy (R20): a cross-tenant leaderboard submission is refused and nothing is created", () => {
  const record = scoreRecordOf({ subject: PLAYER_ONE, completed, recordedAt: 1_300 });
  const cross = rig.leaderboard.submitScore(PLAYER_ONE, {
    record: { ...record, tenant: OTHER_TENANT },
    integrityConfidence: 1,
  });
  assert.equal(cross.accepted, false);
  if (!cross.accepted) assert.equal(cross.code, "tenant-mismatch");
  // The foreign tenant has no boards; the game tenant's board is untouched.
  const foreign = rig.leaderboard.query(PLAYER_ONE, { tenant: OTHER_TENANT, leaderboard: LUMEN_BOARD.leaderboard, window: { offset: 0, limit: 10 } });
  assert.ok("code" in foreign && foreign.code === "board-not-registered");
  const home = rig.leaderboard.query(PLAYER_ONE, { tenant: TENANT, leaderboard: LUMEN_BOARD.leaderboard, window: { offset: 0, limit: 10 } });
  assert.ok(!("code" in home), "the home-tenant board still reads");
  if (!("code" in home)) assert.equal(home.totalEntries, 0, "no entry leaked into the home board");
});

test("tenancy (R20): a cross-tenant leaderboard query is a typed refusal (no data leaks)", () => {
  const cross = rig.leaderboard.query(PLAYER_ONE, { tenant: OTHER_TENANT, leaderboard: LUMEN_BOARD.leaderboard, window: { offset: 0, limit: 10 } });
  // The registry view is structurally tenant-scoped: the foreign tenant
  // resolves no board at all (its own typed refusal — never the home data).
  assert.ok("code" in cross, "the cross-tenant query is a typed refusal");
  if ("code" in cross) assert.equal(cross.code, "board-not-registered");
});

test("tenancy (R20): cross-tenant settlement, consumption and balance reads are refused", () => {
  const settle = rig.economy.settleEvent(
    PLAYER_ONE,
    { ...settlementRequestOf({ subject: PLAYER_ONE, completed, outcomeEvidence: asContentDigest("a".repeat(64))!, integrityConfidence: 1 }), tenant: OTHER_TENANT },
  );
  assert.equal(settle.accepted, false);
  if (!settle.accepted) assert.equal(settle.code, "tenant-mismatch");

  const consume = rig.economy.consumeBalance(PLAYER_ONE, {
    tenant: OTHER_TENANT,
    subject: PLAYER_ONE,
    entitlementKind: LUMEN_SETTLEMENT.entitlementKind,
    entryId: mintLedgerEntryId("cross-1"),
    quantity: 1,
  });
  assert.equal(consume.ok, false);
  if (!consume.ok) assert.equal(consume.code, "tenant-mismatch");

  const balance = rig.economy.balanceOf(PLAYER_ONE, OTHER_TENANT, PLAYER_ONE, LUMEN_SETTLEMENT.entitlementKind);
  assert.ok("code" in balance, "the read is a typed refusal");
  if ("code" in balance) assert.equal(balance.code, "tenant-mismatch");
  assert.equal(rig.economy.ledgerOf(OTHER_TENANT).length, 0, "the foreign tenant's ledger stays empty");
});

test("tenancy (R20): a cross-tenant social command is refused", () => {
  const cross = rig.social.submit({ ...socialCommandOf({ actor: CANONICAL_FOLLOW.actor, target: CANONICAL_FOLLOW.target, tick: 3 }), tenant: OTHER_TENANT });
  assert.equal(cross.accepted, false);
  if (!cross.accepted) assert.equal(cross.code, "tenant-mismatch");
  assert.equal(rig.social.history(OTHER_TENANT).length, 0, "no relation change in the foreign tenant");
  assert.equal(rig.social.history(TENANT).length, 0, "no relation change in the home tenant either");
});

test("tenancy (R20): cross-tenant achievement evidence is refused", () => {
  const evidence = achievementEvidencesOf({ subject: PLAYER_ONE, events: [completed], observedAt: 1_500 })[0]!;
  const cross = rig.achievements.applyEvidence(PLAYER_ONE, { ...evidence, tenant: OTHER_TENANT });
  assert.equal(cross.accepted, false);
  if (!cross.accepted) assert.equal(cross.code, "tenant-mismatch");
  assert.equal(rig.achievements.awardsOf(OTHER_TENANT).length, 0, "no award in the foreign tenant");
  assert.equal(rig.achievements.awardsOf(TENANT).length, 0, "no award in the home tenant (no partial effects)");
});

test("tenancy (R20): a cross-tenant integrity evaluation is refused", () => {
  const request = integrityRequestOf({
    subject: PLAYER_ONE,
    replayId: REPLAY_ID,
    stream: run.sealed.stream,
    reexecution: { observedAgainst: run.sealed.stream.streamDigest, verdict: run.verdict, observedAt: asTimestampMs(1_500)! },
    declaredAt: 800,
    capturedAt: 1_200,
    document,
  });
  const cross = rig.integrity.submitEvaluation(OPERATOR, { ...request, tenant: OTHER_TENANT });
  assert.equal(cross.accepted, false);
  if (!cross.accepted) assert.equal(cross.code, "tenant-mismatch");
});

// ---------------------------------------------------------------------------
// R10: entitlement refusals (typed, no partial effects)
// ---------------------------------------------------------------------------

test("entitlements (R10): a below-threshold integrity confidence refuses settlement", () => {
  // This fresh rig has NO recorded verdict for the subject, so the
  // request-carried confidence stands — and 0.1 is below the declared
  // minimum of 0.5 (LUMEN_SETTLEMENT).
  const refusal = rig.economy.settleEvent(
    PLAYER_ONE,
    settlementRequestOf({ subject: PLAYER_ONE, completed, outcomeEvidence: asContentDigest("b".repeat(64))!, integrityConfidence: 0.1 }),
  );
  assert.equal(refusal.accepted, false);
  if (!refusal.accepted) assert.equal(refusal.code, "integrity-below-threshold");
  const view = rig.economy.balanceOf(PLAYER_ONE, TENANT, PLAYER_ONE, LUMEN_SETTLEMENT.entitlementKind);
  assert.ok(!("code" in view), "the balance read works for the home tenant");
  if (!("code" in view)) assert.equal(view.balance, 0, "nothing was granted by the refused settlement");
});

test("entitlements (R10): consumption beyond the balance is a typed refusal with no partial effects", async () => {
  // A fresh settling rig: the completed run settles ONE score-shard of 10.
  const settling = createPlatformRig(document);
  const settled = settling.economy.settleEvent(
    PLAYER_ONE,
    settlementRequestOf({ subject: PLAYER_ONE, completed, outcomeEvidence: asContentDigest("c".repeat(64))!, integrityConfidence: 1 }),
  );
  assert.equal(settled.accepted, true, "the honest settlement is accepted");

  const over = settling.economy.consumeBalance(PLAYER_ONE, {
    tenant: TENANT,
    subject: PLAYER_ONE,
    entitlementKind: LUMEN_SETTLEMENT.entitlementKind,
    entryId: mintLedgerEntryId("over-1"),
    quantity: 11,
  });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.code, "negative-balance");
  const after = settling.economy.balanceOf(PLAYER_ONE, TENANT, PLAYER_ONE, LUMEN_SETTLEMENT.entitlementKind);
  if ("code" in after) throw new Error(`balance read refused: ${after.code}`);
  assert.equal(after.balance, 10, "the balance is untouched by the refused consumption");
  assert.equal(after.entries.length, 1, "only the grant row exists in the journal");

  const within = settling.economy.consumeBalance(PLAYER_ONE, {
    tenant: TENANT,
    subject: PLAYER_ONE,
    entitlementKind: LUMEN_SETTLEMENT.entitlementKind,
    entryId: mintLedgerEntryId("within-1"),
    quantity: 3,
  });
  assert.equal(within.ok, true, "a within-balance consumption succeeds");
  if (within.ok) assert.equal(within.balanceAfter, 7);
});

test("entitlements (R10): a duplicate settlement is idempotent, not double (E10)", () => {
  const settling = createPlatformRig(document);
  const request = settlementRequestOf({ subject: PLAYER_ONE, completed, outcomeEvidence: asContentDigest("d".repeat(64))!, integrityConfidence: 1 });
  const first = settling.economy.settleEvent(PLAYER_ONE, request);
  assert.equal(first.accepted, true);
  const second = settling.economy.settleEvent(PLAYER_ONE, request);
  assert.equal(second.accepted, false, "the same occurrence never settles twice");
  if (!second.accepted) assert.equal(second.code, "duplicate-settlement");
  const view = settling.economy.balanceOf(PLAYER_ONE, TENANT, PLAYER_ONE, LUMEN_SETTLEMENT.entitlementKind);
  if ("code" in view) throw new Error("balance read refused");
  assert.equal(view.balance, 10, "exactly one grant stands");
});
