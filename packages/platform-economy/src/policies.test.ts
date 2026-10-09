/**
 * Policy admission tests: the pure oracle's rule order, total
 * validation, duplicate conflicts (never a silent overwrite) and the
 * reserved-namespace discipline (lock 18). Service-level registration
 * and policy-admission forgery (E8) are covered at the end.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adjudicatePolicyAdmission, declarationsOf, policyKey } from "./policies.ts";
import { EconomyService } from "./service.ts";
import {
  createFixedClock,
  createMappingValueResolver,
  createMemoryEconomyStore,
  createMemoryGrantDirectory,
  createUnwiredRewardIntegrityPort,
  economyAdminGrant,
  economySubmitGrant,
} from "./fakes.ts";
import { asContentDigest, asSubjectId, asTenantId, asTimestampMs } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const shapeDigest = asContentDigest("f".repeat(64))!;
const now = asTimestampMs(1_000)!;

function declaration(over: Record<string, unknown> = {}) {
  return {
    capability: "rewards" as const,
    eventKind: "match.won" as never,
    entitlementKind: "gold-coin",
    requiresAuthoritativeOutcome: true as const,
    minIntegrityConfidence: 0.5,
    valueShapeDigest: shapeDigest,
    ...over,
  };
}

test("policies: a well-formed declaration is admitted as a platform record", () => {
  const admission = adjudicatePolicyAdmission(tenant, declaration(), now, []);
  assert.ok(admission.ok);
  assert.equal(admission.registered.declaration.entitlementKind, "gold-coin");
  assert.equal(admission.registered.registeredAt, now);
  assert.equal(admission.registered.decidedBy, "platform-authority");
});

test("policies: total validation refuses structurally malformed declarations", () => {
  const cases: readonly unknown[] = [
    null,
    { ...declaration(), capability: "leaderboard" },
    { ...declaration(), entitlementKind: "" },
    { ...declaration(), requiresAuthoritativeOutcome: false },
    { ...declaration(), minIntegrityConfidence: 1.5 },
    { ...declaration(), minIntegrityConfidence: Number.NaN },
    { ...declaration(), valueShapeDigest: "not-a-digest" },
    { ...declaration(), eventKind: "" },
  ];
  for (const candidate of cases) {
    const admission = adjudicatePolicyAdmission(tenant, candidate, now, []);
    assert.ok(!admission.ok && admission.code === "malformed-policy", `expected malformed-policy for ${JSON.stringify(candidate)}`);
  }
});

test("policies: malformed event-kind text is refused distinctly", () => {
  const admission = adjudicatePolicyAdmission(tenant, declaration({ eventKind: "Not A Kind!" }), now, []);
  assert.ok(!admission.ok && admission.code === "invalid-event-kind");
});

test("policies: reserved platform event kinds are refused (lock 18)", () => {
  const admission = adjudicatePolicyAdmission(tenant, declaration({ eventKind: "platform.entitlement.granted" }), now, []);
  assert.ok(!admission.ok && admission.code === "reserved-platform-event-kind");
});

test("policies: duplicate registration is a typed conflict naming the existing payout (E8)", () => {
  const existing = [declaration()];
  const admission = adjudicatePolicyAdmission(tenant, declaration({ minIntegrityConfidence: 0.9 }), now, existing);
  assert.ok(!admission.ok && admission.code === "duplicate-policy");
  assert.match(admission.detail, /gold-coin/);
});

test("policies: the same payout kind under a different event is NOT a conflict", () => {
  const existing = [declaration()];
  const admission = adjudicatePolicyAdmission(tenant, declaration({ eventKind: "quest.completed" as never }), now, existing);
  assert.ok(admission.ok);
});

test("policies: declarationsOf extracts the bare validation inputs; policyKey is the tenant-scoped key", () => {
  const admission = adjudicatePolicyAdmission(tenant, declaration(), now, []);
  assert.ok(admission.ok);
  assert.deepEqual(declarationsOf([admission.registered]), [declaration()]);
  assert.equal(policyKey(tenant, "match.won" as never), "tenant-alpha|match.won");
});

// ---------------------------------------------------------------------------
// Service-level registration (E8: policy-admission forgery)
// ---------------------------------------------------------------------------

function makeService() {
  const grants = createMemoryGrantDirectory();
  grants.grant(economyAdminGrant(tenant, asSubjectId("admin-a")!));
  const service = new EconomyService({
    store: createMemoryEconomyStore().store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
    integrity: createUnwiredRewardIntegrityPort(),
    values: createMappingValueResolver({}, 10),
  });
  return { grants, service };
}

test("policies: the service registers an admitted policy once and refuses duplicates without overwrite (E8)", () => {
  const { service } = makeService();
  const admin = asSubjectId("admin-a")!;
  const first = service.registerPolicy(admin, tenant, declaration());
  assert.ok(first.ok);
  const duplicate = service.registerPolicy(admin, tenant, declaration({ minIntegrityConfidence: 0.99 }));
  assert.ok(!duplicate.ok && duplicate.code === "duplicate-policy");
  // The ORIGINAL registration stands — never a silent overwrite.
  const again = service.registerPolicy(admin, tenant, declaration());
  assert.ok(!again.ok && again.code === "duplicate-policy");
  assert.match(again.detail, /gold-coin/);
});

test("policies: forged registrations are refused and leave the registry empty", () => {
  const { service } = makeService();
  const admin = asSubjectId("admin-a")!;
  const reserved = service.registerPolicy(admin, tenant, declaration({ eventKind: "platform.entitlement.granted" }));
  assert.ok(!reserved.ok && reserved.code === "reserved-platform-event-kind");
  const malformed = service.registerPolicy(admin, tenant, declaration({ valueShapeDigest: "xyz" }));
  assert.ok(!malformed.ok && malformed.code === "malformed-policy");
  // A read query against the untouched registry shows a zero balance.
  const balance = service.balanceOf(admin, tenant, asSubjectId("player-one")!, "gold-coin");
  assert.ok("balance" in balance && balance.balance === 0 && balance.entries.length === 0);
});

test("policies: registering requires the administer permission (R20)", () => {
  const { grants, service } = makeService();
  const submitter = asSubjectId("game-service")!;
  grants.grant(economySubmitGrant(tenant, submitter));
  const refused = service.registerPolicy(submitter, tenant, declaration());
  assert.ok(!refused.ok && refused.code === "permission-not-granted");
});
