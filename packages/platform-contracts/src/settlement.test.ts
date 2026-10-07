import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest, asTimestampMs } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import { asEntitlementGrantId } from "./entitlements.ts";
import { asTypedKernelValueReading, asOpaqueEconomyValue } from "./economy-values.ts";
import {
  asSettlementId,
  isSettlementEligibilityDeclaration,
  validateSettlement,
  isEntitlementSettlementRecord,
  admitSettlement,
} from "./settlement.ts";
import type {
  SettlementEligibilityDeclaration,
  SettlementValidationRequest,
  EntitlementSettlementRecord,
} from "./settlement.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const entitlement = asEntitlementGrantId("grant-001")!;
const kind = asGameEventKind("match.completed")!;
const sourceEventDigest = asContentDigest("ab".repeat(32))!;
const outcomeEvidence = asContentDigest("cd".repeat(32))!;
const declaredShapeDigest = asContentDigest("ef".repeat(32))!;
const otherShapeDigest = asContentDigest("12".repeat(32))!;
const recordedAt = asTimestampMs(5_000)!;

const kernelValue = asTypedKernelValueReading("int", declaredShapeDigest, sourceEventDigest)!;
const opaqueValue = asOpaqueEconomyValue(sourceEventDigest)!;

function declaration(
  overrides: Partial<SettlementEligibilityDeclaration> = {},
): SettlementEligibilityDeclaration {
  const full: SettlementEligibilityDeclaration = {
    capability: "rewards",
    eventKind: kind,
    entitlementKind: "arena-coin",
    requiresAuthoritativeOutcome: true,
    minIntegrityConfidence: 0.75,
    valueShapeDigest: declaredShapeDigest,
  };
  return { ...full, ...overrides };
}

function request(
  overrides: Partial<SettlementValidationRequest> = {},
): SettlementValidationRequest {
  const full: SettlementValidationRequest = {
    tenant,
    subject,
    eventKind: kind,
    sourceEventDigest,
    value: kernelValue,
    outcomeEvidence,
    outcomeDecidedBy: "platform-authority",
    integrityConfidence: 0.9,
  };
  return { ...full, ...overrides };
}

function settlement(
  overrides: Partial<EntitlementSettlementRecord> = {},
): EntitlementSettlementRecord {
  const full: EntitlementSettlementRecord = {
    settlementId: asSettlementId("settle-001")!,
    tenant,
    subject,
    entitlement,
    lifecycle: "settled",
    value: kernelValue,
    sourceEventKind: kind,
    sourceEventDigest,
    outcomeEvidence,
    ruleRef: { eventKind: kind, entitlementKind: "arena-coin" },
    decidedBy: "platform-authority",
    recordedAt,
  };
  return { ...full, ...overrides };
}

test("settlement: eligibility declarations validate (lock 18 + lock 41)", () => {
  assert.ok(isSettlementEligibilityDeclaration(declaration()));
  assert.equal(isSettlementEligibilityDeclaration({ ...declaration(), requiresAuthoritativeOutcome: false }), false);
  // @ts-expect-error — requiresAuthoritativeOutcome is the literal type true
  const rigged: SettlementEligibilityDeclaration = { ...declaration(), requiresAuthoritativeOutcome: false };
  assert.equal(rigged.requiresAuthoritativeOutcome, false);
  assert.equal(isSettlementEligibilityDeclaration({ ...declaration(), valueShapeDigest: "junk" as never }), false);
  assert.equal(isSettlementEligibilityDeclaration({ ...declaration(), minIntegrityConfidence: 1.5 }), false);
  assert.equal(isSettlementEligibilityDeclaration({ ...declaration(), capability: "leaderboard" as never }), false);
  assert.ok(asSettlementId("settle-0042"));
  assert.equal(asSettlementId("NOT A SETTLEMENT"), undefined);
});

test("settlement: a declared, authoritative, shape-pinned occurrence validates (happy path)", () => {
  const verdict = validateSettlement(request(), [declaration()]);
  assert.deepEqual(verdict, {
    ok: true,
    matched: { eventKind: kind, entitlementKind: "arena-coin" },
  });
  // Opaque values carry no shape claim and pass the shape check.
  const opaque = validateSettlement(request({ value: opaqueValue }), [declaration()]);
  assert.equal(opaque.ok, true);
});

test("settlement: undeclared events never settle (lock 18 negative path)", () => {
  const undeclared = validateSettlement(
    request({ eventKind: asGameEventKind("match.abandoned")! }),
    [declaration()],
  );
  assert.deepEqual(undeclared, { ok: false, code: "event-not-declared" });
  // No declarations at all: nothing settles.
  assert.deepEqual(validateSettlement(request(), []), { ok: false, code: "event-not-declared" });
});

test("settlement: client-asserted outcomes never settle (lock 41 negative path)", () => {
  const clientDecided = { ...request(), outcomeDecidedBy: "game-declared" } as unknown;
  assert.deepEqual(validateSettlement(clientDecided, [declaration()]), {
    ok: false,
    code: "outcome-not-authoritative",
  });
});

test("settlement: kernel readings must be pinned to the DECLARED shape", () => {
  const mismatched = asTypedKernelValueReading("int", otherShapeDigest, sourceEventDigest)!;
  assert.deepEqual(validateSettlement(request({ value: mismatched }), [declaration()]), {
    ok: false,
    code: "value-shape-mismatch",
  });
});

test("settlement: integrity confidence gates settlement (R11 negative path)", () => {
  assert.deepEqual(validateSettlement(request({ integrityConfidence: 0.5 }), [declaration()]), {
    ok: false,
    code: "integrity-below-threshold",
  });
  assert.deepEqual(validateSettlement(request(), [declaration({ minIntegrityConfidence: 0.95 })]), {
    ok: false,
    code: "integrity-below-threshold",
  });
});

test("settlement: malformed requests are refused with the precise code", () => {
  assert.deepEqual(validateSettlement("junk", [declaration()]), { ok: false, code: "malformed-request" });
  assert.deepEqual(validateSettlement({ ...request(), eventKind: "" }, [declaration()]), {
    ok: false,
    code: "malformed-request",
  });
  assert.deepEqual(validateSettlement({ ...request(), value: { carrier: "psychic" } }, [declaration()]), {
    ok: false,
    code: "malformed-request",
  });
  assert.deepEqual(validateSettlement({ ...request(), integrityConfidence: Number.NaN }, [declaration()]), {
    ok: false,
    code: "malformed-request",
  });
});

test("settlement: records validate and carry NO bare numeric amounts", () => {
  const record = settlement();
  assert.ok(isEntitlementSettlementRecord(record));
  // The value is a carrier (kernel reading: 4 digest/kind fields), never
  // a bare number.
  assert.deepEqual(Object.keys(record.value).sort(), ["carrier", "kind", "payloadDigest", "shapeDigest"]);
  for (const field of Object.values(record.value)) {
    assert.equal(typeof field === "number", false);
  }
  const opaqueRecord = settlement({ value: opaqueValue });
  assert.ok(isEntitlementSettlementRecord(opaqueRecord));
  assert.deepEqual(Object.keys(opaqueRecord.value).sort(), ["carrier", "payloadDigest"]);
  // Malformed records are refused.
  assert.equal(isEntitlementSettlementRecord({ ...record, lifecycle: "held" as never }), false);
  assert.equal(isEntitlementSettlementRecord({ ...record, decidedBy: "game-declared" }), false);
  assert.equal(isEntitlementSettlementRecord({ ...record, sourceEventDigest: "junk" as never }), false);
  assert.equal(isEntitlementSettlementRecord({ ...record, outcomeEvidence: "junk" as never }), false);
  assert.equal(isEntitlementSettlementRecord({ ...record, settlementId: "" }), false);
  assert.equal(isEntitlementSettlementRecord({ ...record, recordedAt: -1 as never }), false);
  assert.equal(isEntitlementSettlementRecord(null), false);
});

test("settlement: admission is append-only — duplicates and re-settlements refused (E8/E10)", () => {
  const record = settlement();
  assert.deepEqual(admitSettlement(record, []), { ok: true, settlementId: record.settlementId });
  // Same settlement id replayed: refused, first receipt stands.
  assert.deepEqual(admitSettlement(record, [record]), {
    ok: false,
    code: "duplicate-settlement-id",
  });
  // A DIFFERENT settlement id for the SAME entitlement: refused — one
  // settlement per entitlement.
  const sneak = settlement({ settlementId: asSettlementId("settle-002")! });
  assert.deepEqual(admitSettlement(sneak, [record]), {
    ok: false,
    code: "entitlement-already-settled",
  });
  // Non-authoritative and malformed records never admit.
  assert.deepEqual(admitSettlement({ ...record, decidedBy: "game-declared" }, []), {
    ok: false,
    code: "non-authoritative-source",
  });
  assert.deepEqual(admitSettlement("junk", []), { ok: false, code: "malformed-record" });
});

test("settlement: records are readonly data (E1 compile check)", () => {
  const record: EntitlementSettlementRecord = settlement();
  // @ts-expect-error — E1: contract fields are readonly
  record.lifecycle = "granted";
  assert.equal(record.settlementId, asSettlementId("settle-001")!);
});
