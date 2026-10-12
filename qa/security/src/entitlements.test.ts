/**
 * ENTITLEMENTS (PL-041 qa negative class, R10) — settlement without
 * entitlement, entitlement forgery, replayed settlements and declaration
 * mismatches against the REAL economy read seam:
 * - a settle-event action for an UNDECLARED event kind
 *   (`event-not-declared`, platform-economy's own code verbatim);
 * - an entitlement-lifecycle action for a FORGED id
 *   (`unknown-entitlement`, the economy door's own code verbatim);
 * - an entitlement held by ANOTHER subject
 *   (`entitlement-holder-mismatch`, R20);
 * - a settlement authorization in a tenant whose declarations live
 *   elsewhere (`event-not-declared` — declarations are tenant-scoped);
 * - a REPLAYED settlement refusal is idempotent (E10: one receipt).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import {
  RIG_ADMIN,
  RIG_CLEAN_SUBJECT,
  RIG_ECONOMY_OPERATOR,
  RIG_EVENT_KIND,
  RIG_FOREIGN_TENANT,
  RIG_OUTSIDER,
  RIG_PLAYER,
  RIG_SUSPENDED_SUBJECT,
  RIG_TENANT,
  assertRefusalLedgered,
  createSecurityRig,
  rightsAdminGrant,
} from "./index.ts";
import type { SecurityRig } from "./index.ts";

const rig: SecurityRig = await createSecurityRig();

function grantRewards(subject: string, permissions: readonly string[]): void {
  rig.platformGrants.grant({
    tenant: asTenantId(RIG_TENANT)!,
    subject: asSubjectId(subject)!,
    capability: "rewards",
    permissions: permissions as never,
  });
}

test("entitlements: settlement WITHOUT a declared event kind is refused event-not-declared (verbatim)", () => {
  grantRewards(RIG_PLAYER, ["read", "submit"]);
  const result = rig.authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: "match.rig-forged-event" as never,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "event-not-declared");
  assert.ok(result.evidence.includes("event:match.rig-forged-event"));
  assertRefusalLedgered(rig, RIG_TENANT, RIG_CLEAN_SUBJECT, "event-not-declared");
});

test("entitlements: a DECLARED event kind is authorized (the honest control)", () => {
  const result = rig.authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: RIG_EVENT_KIND as never,
  });
  assert.ok(result.authorized);
  assert.equal(result.action, "settle-event");
});

test("entitlements: a FORGED entitlement id is refused unknown-entitlement (verbatim)", () => {
  grantRewards(RIG_ECONOMY_OPERATOR, ["read", "administer"]);
  const forged = `entitlement-${"f".repeat(32)}`;
  const result = rig.authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_CLEAN_SUBJECT,
    entitlement: forged as never,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "unknown-entitlement");
  assert.ok(result.evidence.includes(`entitlement:${forged}`));
  assertRefusalLedgered(rig, RIG_TENANT, RIG_CLEAN_SUBJECT, "unknown-entitlement");
});

test("entitlements: the real entitlement id under a foreign tenant is unknown there (never visible)", () => {
  // the entitlement is recorded at home; the operator's grants are
  // domestic too — the cross-tenant probe is refused by the oracle's
  // distinct tenancy code, long before any entitlement read.
  const result = rig.authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_FOREIGN_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_CLEAN_SUBJECT,
    entitlement: rig.entitlementId,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "tenant-mismatch");
});

test("entitlements: an entitlement held by ANOTHER subject is refused entitlement-holder-mismatch (R20)", () => {
  const result = rig.authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_OUTSIDER,
    entitlement: rig.entitlementId,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "entitlement-holder-mismatch");
  assert.ok(result.evidence.includes(`holder:${RIG_CLEAN_SUBJECT}`));
  assertRefusalLedgered(rig, RIG_TENANT, RIG_OUTSIDER, "entitlement-holder-mismatch");
});

test("entitlements: a suspended subject cannot move entitlements at all (R10 × R11)", () => {
  const result = rig.authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_SUSPENDED_SUBJECT,
    entitlement: rig.entitlementId,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "suspended-by-integrity");
});

test("entitlements: a REPLAYED settlement refusal yields ONE idempotent receipt (E10)", () => {
  const request = {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: "match.rig-replay" as never,
  } as const;
  const first = rig.authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, request);
  const second = rig.authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, request);
  const third = rig.authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, request);
  assert.ok(!first.authorized && !second.authorized && !third.authorized);
  assert.equal(first.code, "event-not-declared");
  assert.equal(second.code, "event-not-declared");
  assert.equal(third.code, "event-not-declared");
  assert.equal(second.detail, first.detail);

  const ledger = rig.authority.ledger(rig.auditor, RIG_TENANT);
  assert.ok(ledger.ok);
  const receipts = ledger.records.filter(
    (record) => record.subject === RIG_CLEAN_SUBJECT && record.code === "event-not-declared" && record.detail.includes("replay"),
  );
  assert.equal(receipts.length, 1);
});

test("entitlements: a declaration registered at home never satisfies a foreign-tenant settlement (declaration mismatch)", () => {
  // give the operator a FOREIGN-tenant platform grant so the privilege
  // gate passes — the DECLARATION must still be the refusing wall.
  rig.platformGrants.grant({
    tenant: asTenantId(RIG_FOREIGN_TENANT)!,
    subject: asSubjectId(RIG_ECONOMY_OPERATOR)!,
    capability: "rewards",
    permissions: ["read", "submit"] as never,
  });
  const result = rig.authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_FOREIGN_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: RIG_EVENT_KIND as never,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "event-not-declared");
  assert.ok(result.evidence.includes(`tenant:${RIG_FOREIGN_TENANT}`));
  // the receipt landed under the FOREIGN tenant.
  const ledger = rig.authority.ledger(rig.auditor, RIG_FOREIGN_TENANT);
  assert.ok(!ledger.ok || ledger.records.every((record) => record.tenant === RIG_FOREIGN_TENANT));
});

test("entitlements: a non-granted actor cannot even reach the declaration gate (least privilege first)", () => {
  const result = rig.authority.authorizeSettlement(RIG_OUTSIDER, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: RIG_EVENT_KIND as never,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "capability-not-granted");
  assertRefusalLedgered(rig, RIG_TENANT, RIG_CLEAN_SUBJECT, "capability-not-granted");
});

test("entitlements: an admin grant never substitutes for the rewards capability (seam separation)", () => {
  // the rig ADMIN holds the rights-admin role, NOT a rewards grant.
  const result = rig.authority.authorizeSettlement(RIG_ADMIN, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: RIG_EVENT_KIND as never,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "capability-not-granted");
});

void rightsAdminGrant;
