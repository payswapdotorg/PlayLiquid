/**
 * ENTITLEMENT TESTS (PL-041 composing PL-017, R10) — the settlement-action
 * authorization gates over the REAL economy read seam: the declared
 * settle-event right, the undeclared-event refusal (verbatim), the
 * least-privilege actor gates, the entitlement-lifecycle rights (holder
 * match, unknown ids), the R10 × R11 suspension, and the idempotent
 * replayed refusal (E10 — the ledger records the FIRST receipt only).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeSettlementAction, createSecurityRig } from "./index.ts";
import type { SecurityRig, SettlementGateInputs } from "./index.ts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import { RIG_ADMIN, RIG_AUDITOR, RIG_CLEAN_SUBJECT, RIG_ECONOMY_OPERATOR } from "./rig.ts";
import { RIG_EVENT_KIND, RIG_OUTSIDER, RIG_PLAYER, RIG_SUSPENDED_SUBJECT, RIG_TENANT } from "./rig.ts";

const rig: SecurityRig = await createSecurityRig();

function grantPlatform(subject: string, permissions: ScopedCapabilityGrant["permissions"]): void {
  const grant = {
    tenant: asTenantId(RIG_TENANT)!,
    subject: asSubjectId(subject)!,
    capability: "rewards",
    permissions,
  } satisfies ScopedCapabilityGrant;
  rig.platformGrants.grant(grant);
}

test("entitlement: a declared settle-event action is authorized (R10)", () => {
  grantPlatform(RIG_PLAYER, ["read", "submit"]);
  const result = rig.authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: RIG_EVENT_KIND as never,
  });
  assert.ok(result.authorized);
  assert.equal(result.action, "settle-event");
  assert.ok(result.basis.includes(`event:${RIG_EVENT_KIND}`));
});

test("entitlement: an undeclared event kind is refused event-not-declared (verbatim)", () => {
  const result = rig.authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: "match.rig-undeclared" as never,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "event-not-declared");
  assert.ok(result.evidence.includes(`event:match.rig-undeclared`));
});

test("entitlement: an actor without the rewards capability is refused capability-not-granted (R20)", () => {
  const result = rig.authority.authorizeSettlement(RIG_OUTSIDER, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: RIG_EVENT_KIND as never,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "capability-not-granted");
});

test("entitlement: a grant without the settlement permission is refused permission-not-granted", () => {
  const reader = "oper-rig-econ-reader";
  grantPlatform(reader, ["read"]);
  const result = rig.authority.authorizeSettlement(reader, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: RIG_EVENT_KIND as never,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "permission-not-granted");
});

test("entitlement: the recorded entitlement's lifecycle action is authorized for its holder (R10)", () => {
  grantPlatform(RIG_ECONOMY_OPERATOR, ["read", "administer"]);
  const result = rig.authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_CLEAN_SUBJECT,
    entitlement: rig.entitlementId,
  });
  assert.ok(result.authorized);
  assert.equal(result.action, "entitlement-lifecycle");
  assert.ok(result.basis.includes(`holder:${RIG_CLEAN_SUBJECT}`));
});

test("entitlement: an entitlement not recorded in the tenant is refused unknown-entitlement (verbatim)", () => {
  const result = rig.authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_CLEAN_SUBJECT,
    entitlement: "entitlement-rig-unknown" as never,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "unknown-entitlement");
  assert.ok(result.evidence.includes(`tenant:${RIG_TENANT}`));
});

test("entitlement: an entitlement held by ANOTHER subject is refused entitlement-holder-mismatch (R20)", () => {
  const result = rig.authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_OUTSIDER,
    entitlement: rig.entitlementId,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "entitlement-holder-mismatch");
  assert.ok(result.evidence.includes(`holder:${RIG_CLEAN_SUBJECT}`));
});

test("entitlement: a suspended subject cannot settle at all (R10 × R11)", () => {
  const result = rig.authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_SUSPENDED_SUBJECT,
    entitlement: rig.entitlementId,
  });
  assert.ok(!result.authorized);
  assert.equal(result.code, "suspended-by-integrity");
  assert.ok(result.evidence.some((item) => item.startsWith("verdict:")));
});

test("entitlement E10: a replayed settlement refusal is idempotent (the first receipt stands)", () => {
  const request = {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: "match.rig-replayed" as never,
  } as const;
  const first = rig.authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, request);
  const second = rig.authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, request);
  assert.ok(!first.authorized && !second.authorized);
  assert.equal(first.code, "event-not-declared");
  assert.equal(second.code, first.code);
  assert.equal(second.detail, first.detail);
  // the ledger recorded the refusal ONCE — the replay grew nothing (E10).
  const ledger = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(ledger.ok);
  const replays = ledger.records.filter(
    (record) => record.subject === RIG_CLEAN_SUBJECT && record.code === "event-not-declared" && record.detail.includes("replayed"),
  );
  assert.equal(replays.length, 1);
});

test("entitlement: the pure gate folds hand-built inputs deterministically (E9)", () => {
  const inputs: SettlementGateInputs = {
    platformGrants: [
      {
        tenant: asTenantId(RIG_TENANT)!,
        subject: asSubjectId(RIG_PLAYER)!,
        capability: "rewards",
        permissions: ["submit"],
      },
    ],
    declarations: [],
    entitlement: undefined,
    suspension: undefined,
  };
  const first = authorizeSettlementAction(RIG_PLAYER, RIG_TENANT, { kind: "settle-event", subject: RIG_CLEAN_SUBJECT, eventKind: "match.x" as never }, inputs);
  const second = authorizeSettlementAction(RIG_PLAYER, RIG_TENANT, { kind: "settle-event", subject: RIG_CLEAN_SUBJECT, eventKind: "match.x" as never }, inputs);
  assert.deepEqual(first, second);
  assert.ok(!first.authorized && first.code === "event-not-declared");
});

test("entitlement: only the rights-auditor role reads the ledger of these refusals", () => {
  const byAuditor = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(byAuditor.ok);
  assert.ok(byAuditor.records.some((record) => record.code === "entitlement-holder-mismatch"));
  const byAdmin = rig.authority.ledger(RIG_ADMIN, RIG_TENANT);
  assert.ok(!byAdmin.ok && byAdmin.code === "not-authorized");
});
