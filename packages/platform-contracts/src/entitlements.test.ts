import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import {
  asEntitlementGrantId,
  asLedgerEntryId,
  grantIdempotencyKeyEquals,
  isEntitlementGrant,
  settleGrant,
  settleLedgerEntry,
  isRewardRuleBinding,
  issueRewards,
} from "./entitlements.ts";
import type {
  EntitlementGrant,
  GrantIdempotencyKey,
  LedgerEntry,
  RewardRuleBinding,
  RewardIssuanceRequest,
} from "./entitlements.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const grantId = asEntitlementGrantId("grant-001")!;
const kind = asGameEventKind("match.completed")!;
const outcome = asContentDigest("11".repeat(32))!;
const otherOutcome = asContentDigest("22".repeat(32))!;

function grant(overrides: Partial<EntitlementGrant> = {}): EntitlementGrant {
  const full: EntitlementGrant = {
    grantId,
    tenant,
    subject,
    entitlementKind: "arena-coin",
    amount: 100,
    causation: { sourceEventKind: kind, outcomeEvidence: outcome },
    decidedBy: "platform-authority",
    idempotency: { subject, sourceOutcome: outcome, entitlementKind: "arena-coin" },
  };
  return { ...full, ...overrides };
}

test("entitlements: guards validate grant shape and key coherence", () => {
  assert.ok(isEntitlementGrant(grant()));
  assert.equal(isEntitlementGrant({ ...grant(), decidedBy: "game-declared" }), false);
  assert.equal(isEntitlementGrant({ ...grant(), grantId: "" }), false);
  // The idempotency key must cohere with the grant's own fields.
  const incoherent = grant({
    idempotency: { subject, sourceOutcome: otherOutcome, entitlementKind: "arena-coin" },
  });
  assert.equal(isEntitlementGrant(incoherent), false);
  assert.equal(isEntitlementGrant(null), false);
});

test("entitlements: idempotency keys are structural triples", () => {
  const a: GrantIdempotencyKey = { subject, sourceOutcome: outcome, entitlementKind: "arena-coin" };
  assert.ok(grantIdempotencyKeyEquals(a, { subject, sourceOutcome: outcome, entitlementKind: "arena-coin" }));
  assert.equal(
    grantIdempotencyKeyEquals(a, { subject, sourceOutcome: outcome, entitlementKind: "arena-gem" }),
    false,
  );
  assert.equal(
    grantIdempotencyKeyEquals(a, { subject, sourceOutcome: otherOutcome, entitlementKind: "arena-coin" }),
    false,
  );
});

test("entitlements: a well-formed grant settles once (R10 happy path)", () => {
  const disposition = settleGrant(grant(), []);
  assert.deepEqual(disposition, { disposition: "issued", grantId });
});

test("entitlements: DOUBLE-GRANT IS REJECTED — the first receipt stands (R10 idempotency)", () => {
  const first = settleGrant(grant(), []);
  assert.equal(first.disposition, "issued");
  // Exact replay of the same grant (same idempotency key, same grant id).
  const replay = settleGrant(grant(), [grant()]);
  assert.deepEqual(replay, { disposition: "refused", code: "duplicate-grant" });
});

test("entitlements: same key under a different grant id is a collision, refused (E8)", () => {
  const sneaky = grant({ grantId: asEntitlementGrantId("grant-002")! });
  const disposition = settleGrant(sneaky, [grant()]);
  assert.deepEqual(disposition, { disposition: "refused", code: "idempotency-collision" });
  // Same for a different amount under the same key.
  const inflated = grant({ amount: 999_999 });
  assert.deepEqual(settleGrant(inflated, [grant()]), {
    disposition: "refused",
    code: "idempotency-collision",
  });
});

test("entitlements: non-authoritative and non-positive grants never settle (lock 41)", () => {
  assert.deepEqual(settleGrant({ ...grant(), decidedBy: "game-declared" }, []), {
    disposition: "refused",
    code: "non-authoritative-source",
  });
  assert.deepEqual(settleGrant({ ...grant(), amount: 0 }, []), {
    disposition: "refused",
    code: "non-positive-amount",
  });
  assert.deepEqual(settleGrant("junk", []), { disposition: "refused", code: "malformed-grant" });
});

test("entitlements: reward rules structurally require authoritative outcomes (lock 41, compile-time)", () => {
  const rule: RewardRuleBinding = {
    capability: "rewards",
    eventKind: kind,
    entitlementKind: "arena-coin",
    amount: 100,
    requiresAuthoritativeOutcome: true,
    minIntegrityConfidence: 0.75,
  };
  assert.ok(isRewardRuleBinding(rule));
  assert.equal(isRewardRuleBinding({ ...rule, requiresAuthoritativeOutcome: false }), false);
  // @ts-expect-error — requiresAuthoritativeOutcome is the literal type true
  const rigged: RewardRuleBinding = { ...rule, requiresAuthoritativeOutcome: false };
  assert.equal(rigged.requiresAuthoritativeOutcome, false);
  assert.equal(isRewardRuleBinding({ ...rule, amount: 0 }), false);
  assert.equal(isRewardRuleBinding({ ...rule, minIntegrityConfidence: 2 }), false);
});

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const full: LedgerEntry = {
    entryId: asLedgerEntryId("entry-001")!,
    tenant,
    subject,
    entitlementKind: "arena-coin",
    delta: -30,
    reason: "consume",
    balanceAfter: 70,
  };
  return { ...full, ...overrides };
}

test("entitlements: ledger fold refuses duplicates, zero deltas and overdrafts (E8)", () => {
  const journal: readonly LedgerEntry[] = [entry()];
  assert.deepEqual(settleLedgerEntry(entry({ delta: 30, reason: "grant" }), [], 0), {
    settled: true,
    balanceAfter: 30,
  });
  assert.deepEqual(settleLedgerEntry(entry(), journal, 100), {
    settled: false,
    code: "duplicate-entry",
  });
  assert.deepEqual(settleLedgerEntry(entry({ entryId: asLedgerEntryId("entry-002")!, delta: 0 }), [], 10), {
    settled: false,
    code: "zero-delta",
  });
  assert.deepEqual(settleLedgerEntry(entry({ entryId: asLedgerEntryId("entry-003")!, delta: 1.5 }), [], 10), {
    settled: false,
    code: "non-integer-delta",
  });
  assert.deepEqual(settleLedgerEntry(entry({ entryId: asLedgerEntryId("entry-004")! }), [], 10), {
    settled: false,
    code: "negative-balance",
  });
});

test("entitlements: issuance folds idempotency across the whole batch (R10)", () => {
  const request: RewardIssuanceRequest = {
    tenant,
    outcomeEvidence: outcome,
    grants: [grant(), grant(), grant({ grantId: asEntitlementGrantId("grant-x")! })],
  };
  const result = issueRewards(request);
  assert.equal(result.issued.length, 1);
  assert.equal(result.issued[0], grantId);
  assert.deepEqual(result.refused, [
    { grantId, code: "duplicate-grant" },
    { grantId: asEntitlementGrantId("grant-x")!, code: "idempotency-collision" },
  ]);

  const foreignOutcome: RewardIssuanceRequest = {
    tenant,
    outcomeEvidence: otherOutcome,
    grants: [grant()],
  };
  const refused = issueRewards(foreignOutcome);
  assert.deepEqual(refused.issued, []);
  assert.deepEqual(refused.refused, [{ grantId, code: "non-authoritative-source" }]);
});
