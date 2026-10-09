/**
 * Settlement oracle tests: the pure admission pipeline's rule order —
 * request shape, idempotency encounters (replay vs collision, E10/E8),
 * the contracts validation codes surfacing verbatim (unvalidated
 * events, non-authoritative outcomes, shape mismatches, integrity
 * thresholds), the integrity-port override (R10/R11), magnitude
 * resolution and grant admission collisions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adjudicateEconomySettlement, settlementKeyOf } from "./settlement.ts";
import type { SettlementFacts } from "./settlement.ts";
import { mintGrantId } from "./records.ts";
import { asContentDigest, asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { EconomySettlementRequest } from "./settlement.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const eventDigest = asContentDigest("d".repeat(64))!;
const outcome = asContentDigest("a".repeat(64))!;
const shapeDigest = asContentDigest("f".repeat(64))!;
const foreignShape = asContentDigest("e".repeat(64))!;
const value = { carrier: "opaque-digest" as const, payloadDigest: asContentDigest("1".repeat(64))! };

function declarations() {
  return [
    {
      capability: "rewards" as const,
      eventKind: "match.won" as never,
      entitlementKind: "gold-coin",
      requiresAuthoritativeOutcome: true as const,
      minIntegrityConfidence: 0.5,
      valueShapeDigest: shapeDigest,
    },
  ];
}

function request(over: Partial<EconomySettlementRequest> = {}): EconomySettlementRequest {
  return {
    tenant,
    subject,
    eventKind: "match.won" as never,
    sourceEventDigest: eventDigest,
    value,
    outcomeEvidence: outcome,
    outcomeDecidedBy: "platform-authority" as const,
    integrityConfidence: 0.99,
    mode: "immediate" as const,
    ...over,
  };
}

function facts(over: Partial<SettlementFacts> = {}): SettlementFacts {
  return {
    declarations: declarations(),
    keySeen: false,
    recordedOutcomeEvidence: undefined,
    priorGrants: [],
    integrityReading: undefined,
    resolvedQuantity: 10,
    ...over,
  };
}

test("settlement: a well-formed declared occurrence is accepted with a full plan", () => {
  const admission = adjudicateEconomySettlement(request(), facts());
  assert.ok(admission.accepted);
  assert.equal(admission.plan.quantity, 10);
  assert.equal(admission.plan.entitlementKind, "gold-coin");
  assert.equal(admission.plan.effectiveConfidence, 0.99);
  assert.equal(admission.plan.mode, "immediate");
  assert.match(admission.plan.grantId, /^ent-[0-9a-f]{24}$/);
  assert.match(admission.plan.settlementId, /^stl-[0-9a-f]{24}$/);
  assert.match(admission.plan.entryId, /^led-[0-9a-f]{24}$/);
});

test("settlement: structurally malformed requests are refused", () => {
  const cases: readonly unknown[] = [
    null,
    request({ tenant: "" as never }),
    request({ subject: "" as never }),
    request({ sourceEventDigest: "nope" as never }),
    request({ outcomeEvidence: "nope" as never }),
    request({ value: { carrier: "weird" } as never }),
    request({ integrityConfidence: 1.5 }),
    request({ integrityConfidence: Number.NaN }),
    request({ mode: "later" as never }),
    request({ mode: "hold" }), // hold without a cause digest
    request({ holdCauseDigest: asContentDigest("9".repeat(64))! }), // immediate WITH a cause digest
  ];
  for (const candidate of cases) {
    const admission = adjudicateEconomySettlement(candidate, facts());
    assert.ok(!admission.accepted && admission.code === "malformed-request", `expected malformed-request for ${JSON.stringify(candidate)}`);
  }
});

test("settlement: a recorded key with the same outcome is a replay (E10); a different one is a collision (E8)", () => {
  const replay = adjudicateEconomySettlement(request(), facts({ keySeen: true, recordedOutcomeEvidence: outcome }));
  assert.ok(!replay.accepted && replay.code === "duplicate-settlement");
  const collision = adjudicateEconomySettlement(
    request(),
    facts({ keySeen: true, recordedOutcomeEvidence: asContentDigest("b".repeat(64))! }),
  );
  assert.ok(!collision.accepted && collision.code === "idempotency-collision");
});

test("settlement: settlement of unvalidated events is refused (event-not-declared)", () => {
  const admission = adjudicateEconomySettlement(request({ eventKind: "quest.abandoned" as never }), facts());
  assert.ok(!admission.accepted && admission.code === "event-not-declared");
  // No declarations at all: same typed refusal.
  const empty = adjudicateEconomySettlement(request(), facts({ declarations: [] }));
  assert.ok(!empty.accepted && empty.code === "event-not-declared");
});

test("settlement: client-forged outcome deciders never settle (lock 41 / E8)", () => {
  const forged = request({ outcomeDecidedBy: "game-declared" as never });
  const admission = adjudicateEconomySettlement(forged, facts());
  assert.ok(!admission.accepted && admission.code === "outcome-not-authoritative");
});

test("settlement: a kernel reading pinned to the wrong shape is refused (value-shape-mismatch)", () => {
  const reading = {
    carrier: "kernel-reading" as const,
    kind: "int" as const,
    shapeDigest: foreignShape,
    payloadDigest: asContentDigest("2".repeat(64))!,
  };
  const admission = adjudicateEconomySettlement(request({ value: reading }), facts());
  assert.ok(!admission.accepted && admission.code === "value-shape-mismatch");
  // Pinned to the DECLARED shape: accepted.
  const pinned = { ...reading, shapeDigest };
  const accepted = adjudicateEconomySettlement(request({ value: pinned }), facts());
  assert.ok(accepted.accepted);
});

test("settlement: integrity confidence below the declaration minimum is refused", () => {
  const admission = adjudicateEconomySettlement(request({ integrityConfidence: 0.2 }), facts());
  assert.ok(!admission.accepted && admission.code === "integrity-below-threshold");
});

test("settlement: a port reading OVERRIDES the self-declared confidence (R10/R11)", () => {
  // The request claims 0.99; the integrity seam reads 0.1: the platform's
  // evidence outranks the game's self-declaration.
  const refused = adjudicateEconomySettlement(request(), facts({ integrityReading: { confidence: 0.1 } }));
  assert.ok(!refused.accepted && refused.code === "integrity-below-threshold");
  // The override also RAISES weak self-declarations when evidence is strong.
  const lifted = adjudicateEconomySettlement(
    request({ integrityConfidence: 0.3 }),
    facts({ integrityReading: { confidence: 0.9, evidenceDigest: asContentDigest("7".repeat(64))! } }),
  );
  assert.ok(lifted.accepted && lifted.plan.effectiveConfidence === 0.9);
  assert.equal(lifted.plan.integrityEvidenceDigest, asContentDigest("7".repeat(64))!);
});

test("settlement: unresolvable and invalid magnitudes are typed refusals", () => {
  const unresolvable = adjudicateEconomySettlement(request(), facts({ resolvedQuantity: undefined }));
  assert.ok(!unresolvable.accepted && unresolvable.code === "value-not-resolvable");
  const zero = adjudicateEconomySettlement(request(), facts({ resolvedQuantity: 0 }));
  assert.ok(!zero.accepted && zero.code === "invalid-quantity");
  const negative = adjudicateEconomySettlement(request(), facts({ resolvedQuantity: -5 }));
  assert.ok(!negative.accepted && negative.code === "invalid-quantity");
});

test("settlement: one outcome re-granting the same kind to the same subject is a grant-key refusal (E8)", () => {
  // Same outcome evidence, DIFFERENT event occurrence digest — the
  // settlement key differs but the contracts grant idempotency key
  // {subject, sourceOutcome, entitlementKind} collides.
  const regrantRequest = request({ sourceEventDigest: asContentDigest("c".repeat(64))! });
  const priorGrant = {
    grantId: "ent-prior" as never,
    tenant,
    subject,
    entitlementKind: "gold-coin",
    amount: 10,
    causation: { sourceEventKind: "match.won" as never, outcomeEvidence: outcome },
    decidedBy: "platform-authority" as const,
    idempotency: { subject, sourceOutcome: outcome, entitlementKind: "gold-coin" },
  };
  const admission = adjudicateEconomySettlement(regrantRequest, facts({ priorGrants: [priorGrant] }));
  assert.ok(!admission.accepted && admission.code === "idempotency-collision");
  // An exact replay of the SAME grant (the minted id + amount) is a duplicate-grant.
  const sameGrant = { ...priorGrant, grantId: mintGrantId(settlementKeyOf(regrantRequest)) };
  const duplicate = adjudicateEconomySettlement(regrantRequest, facts({ priorGrants: [sameGrant] }));
  assert.ok(!duplicate.accepted && duplicate.code === "duplicate-grant");
});

test("settlement: the idempotency key is the occurrence quadruple", () => {
  assert.equal(
    settlementKeyOf(request()),
    `tenant-alpha|player-one|match.won|${"d".repeat(64)}`,
  );
  const other = request({ sourceEventDigest: asContentDigest("c".repeat(64))! });
  assert.notEqual(settlementKeyOf(request()), settlementKeyOf(other));
});

test("settlement: minted ids are deterministic and replay-stable (E9)", () => {
  const first = adjudicateEconomySettlement(request(), facts());
  const second = adjudicateEconomySettlement(request(), facts());
  assert.ok(first.accepted && second.accepted);
  assert.equal(first.plan.grantId, second.plan.grantId);
  assert.equal(first.plan.settlementId, second.plan.settlementId);
  assert.equal(first.plan.entryId, second.plan.entryId);
});
