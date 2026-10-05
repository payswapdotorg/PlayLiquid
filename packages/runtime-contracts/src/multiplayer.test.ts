/**
 * Multiplayer authority tests (R9, lock rule 19, requirement E8): untrusted
 * client claims can never occupy an authoritative slot — at the type level
 * (misuse must fail to compile) and at the value level (the sanitizer is
 * lossy; protected outcomes require committed evidence chains).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeClaim,
  validateProtectedOutcome,
  type AuthoritativeEvidence,
  type AuthoritativeMatchOutcome,
  type ClaimEvidence,
  type ClientSubmittedClaim,
} from "./multiplayer.ts";
import {
  asActorId,
  asDigest,
  type ActorRef,
  asClaimId,
  asEventId,
  asOutcomeId,
  asSessionEpoch,
  asSessionId,
  asTick,
} from "./primitives.ts";

const sessionId = asSessionId("s-mp");
const actor: ActorRef = { actorClass: "player", actorId: asActorId("player-1") };

const claim: ClientSubmittedClaim<{ score: number }> = {
  claimId: asClaimId("claim-1"),
  sessionId,
  actor,
  clientAsserted: { clientClaimedScore: 9999, clientClaimedOutcome: "victory" },
  payload: { score: 9999, untrusted: "untrusted-client-input" },
};

test("E8 type-level: a client claim is NOT an authoritative outcome", () => {
  // @ts-expect-error TS2741: ClientSubmittedClaim cannot fill AuthoritativeMatchOutcome
  const outcome: AuthoritativeMatchOutcome = claim;
  void outcome;
  assert.ok(true, "compiler rejected the coercion (lock rule 19)");
});

test("E8 type-level: client-asserted evidence is NOT authoritative evidence", () => {
  const evidence: ClaimEvidence = {
    kind: "client-asserted",
    artifacts: [asDigest("a".repeat(64))],
    untrusted: { untrusted: "untrusted-client-input" },
  };
  // @ts-expect-error TS2322: ClaimEvidence cannot fill AuthoritativeEvidence
  const authoritative: AuthoritativeEvidence = evidence;
  void authoritative;
  assert.ok(true, "compiler rejected the coercion");
});

test("E8 type-level: claims cannot be constructed without the untrusted marker", () => {
  const unmarked: ClientSubmittedClaim<{ score: number }> = {
    claimId: asClaimId("claim-2"),
    sessionId,
    actor,
    clientAsserted: {},
    // @ts-expect-error TS2322: payload lacks the mandatory untrusted marker
    payload: { score: 1 },
  };
  void unmarked;
  assert.ok(true, "construction without acknowledging untrustedness fails");
});

test("E8 value-level: sanitizeClaim demotes, never promotes", () => {
  const record = sanitizeClaim(claim);
  assert.equal(record.trust, "untrusted-advisory");
  assert.equal(record.advisory.clientClaimedScore, 9999, "advisory data survives as hints only");
  assert.equal(record.claimId, claim.claimId);
  // @ts-expect-error TS2341/TS2769: a sanitized record cannot be laundered into an outcome
  const laundered: AuthoritativeMatchOutcome = { ...record, decidedBy: "x" };
  void laundered;
});

const evidence: AuthoritativeEvidence = {
  kind: "committed-events",
  eventIds: [asEventId("evt-1"), asEventId("evt-2")],
  marker: "authoritative-runtime-decided",
};

const outcome = (over: Partial<AuthoritativeMatchOutcome> = {}): AuthoritativeMatchOutcome => ({
  outcomeId: asOutcomeId("out-1"),
  sessionId,
  epoch: asSessionEpoch(1),
  decidedBy: "authoritative-runtime-decided",
  decidedAtTick: asTick(42),
  evidence,
  standings: [{ actor, rank: 1, score: 100, grants: ["score"] }],
  ...over,
});

test("a well-formed authoritative outcome validates", () => {
  const result = validateProtectedOutcome(outcome());
  assert.deepEqual(result, { ok: true, outcomeId: asOutcomeId("out-1") });
});

test("protected outcomes require a non-empty committed evidence chain", () => {
  const empty = outcome({
    evidence: { kind: "committed-events", eventIds: [], marker: "authoritative-runtime-decided" },
  });
  const result = validateProtectedOutcome(empty);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "empty-evidence-chain");
  }
});

test("wire data forging the authority marker is rejected (E8)", () => {
  // Simulate untyped wire data reaching a validator (the realistic attack):
  const forged = {
    ...outcome(),
    decidedBy: "client-decided",
  } as unknown as AuthoritativeMatchOutcome;
  const result = validateProtectedOutcome(forged);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "not-authoritative");
  }
});

test("standings must use 1-based integer ranks", () => {
  const zero = outcome({ standings: [{ actor, rank: 0, score: 5, grants: [] }] });
  const result = validateProtectedOutcome(zero);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "bad-standing-rank");
  }
});

test("claims remain usable as UNTRUSTED inputs (advisory flows)", () => {
  const record = sanitizeClaim(claim);
  assert.equal(record.payload.score, 9999);
  assert.deepEqual(Object.keys(record.advisory).sort(), [
    "clientClaimedOutcome",
    "clientClaimedScore",
  ]);
});
