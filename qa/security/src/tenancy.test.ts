/**
 * TENANCY (PL-041 qa negative class, R20) — cross-tenant select, read
 * and write refusals, plus tenant-confusion via CRAFTED IDS: subjects,
 * hosts, sessions and cases whose ids EMBED the other tenant's name.
 * Every cross-tenant move fires STRUCTURALLY (a typed refusal before
 * any grant check could pass), and the domestic ledger never leaks a
 * foreign tenant's records.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import {
  RIG_ADMIN,
  RIG_AUDITOR,
  RIG_AVATAR_SUBJECT,
  RIG_FOREIGN_TENANT,
  RIG_HOST,
  RIG_OUTSIDER,
  RIG_SESSION,
  RIG_SUSPENDED_SUBJECT,
  RIG_TENANT,
  createSecurityRig,
  decideOf,
  rightsAdminGrant,
  rightsAuditorGrant,
} from "./index.ts";
import type { SecurityRig } from "./index.ts";

const rig: SecurityRig = await createSecurityRig();
const FOREIGN_AUDITOR = "oper-rig-foreign-audit";

// a domestic grant so cross-tenant probes hit the TENANT code, not the
// least-privilege one (the probe must be structurally tenancy-refused).
rig.platformGrants.grant({
  tenant: asTenantId(RIG_TENANT)!,
  subject: asSubjectId(RIG_AVATAR_SUBJECT)!,
  capability: "rewards",
  permissions: ["read"],
});
rig.platformGrants.grant({
  tenant: asTenantId(RIG_TENANT)!,
  subject: asSubjectId(RIG_SUSPENDED_SUBJECT)!,
  capability: "rewards",
  permissions: ["read"],
});

test("tenancy: a cross-tenant platform SELECT is refused tenant-mismatch (verbatim)", () => {
  const result = decideOf(rig, {
    tenant: RIG_FOREIGN_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: { kind: "platform", capability: "rewards", permission: "read" },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "tenant-mismatch");
  // the receipt is ledgered under the FOREIGN tenant (never leaked home) —
  // verified through a foreign-tenant-only auditor seat.
  rig.admins.grant(rightsAuditorGrant(RIG_FOREIGN_TENANT, FOREIGN_AUDITOR));
  const foreignView = rig.authority.ledger(FOREIGN_AUDITOR, RIG_FOREIGN_TENANT);
  assert.ok(foreignView.ok);
  assert.ok(foreignView.records.some((record) => record.code === "tenant-mismatch"));
  const domestic = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(domestic.ok);
  assert.ok(!domestic.records.some((record) => record.tenant === RIG_FOREIGN_TENANT));
});

test("tenancy: a cross-tenant avatar WRITE (host bound at home) is refused cross-tenant-request", () => {
  const result = decideOf(rig, {
    tenant: RIG_FOREIGN_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "avatar", capability: "movement", host: RIG_HOST },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "cross-tenant-request");
  assert.ok(result.detail.includes("bound to another tenant"));
});

test("tenancy: a cross-tenant runtime session is refused cross-tenant-request (before any grant check)", () => {
  const result = decideOf(rig, {
    tenant: RIG_FOREIGN_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "avatar-agent",
      session: { tenant: RIG_FOREIGN_TENANT, sessionId: RIG_SESSION, epoch: 1, tick: 5 },
    },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "cross-tenant-request");
});

test("tenancy: a cross-tenant ledger READ is refused cross-tenant-request (no record leaks)", () => {
  // a domestic refusal first, so the domestic view demonstrably holds data.
  decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "platform", capability: "rewards", permission: "administer" },
  });
  const domestic = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(domestic.ok && domestic.records.length > 0);
  const foreign = rig.authority.ledger(RIG_AUDITOR, RIG_FOREIGN_TENANT);
  assert.ok(!foreign.ok);
  assert.equal(foreign.code, "cross-tenant-request");
});

test("tenancy: a cross-tenant lattice-state READ is refused cross-tenant-request", () => {
  const foreign = rig.authority.latticeState(RIG_AUDITOR, RIG_FOREIGN_TENANT);
  assert.ok(!foreign.ok);
  assert.equal(foreign.code, "cross-tenant-request");
});

test("tenancy: a cross-tenant admin WRITE is refused with the distinct cross-tenant code", () => {
  const binding = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_FOREIGN_TENANT,
    host: "host-rig-foreign-write",
    definition: rig.avatarDefinition,
    restriction: rig.restriction,
  });
  assert.ok(!binding.ok);
  assert.equal(binding.code, "cross-tenant-request");

  const admission = rig.authority.admitPackage(RIG_ADMIN, RIG_FOREIGN_TENANT, {
    tenant: RIG_FOREIGN_TENANT,
    kind: "assets",
    id: "asset.rig-kit",
    version: "1.0.0",
    contentDigest: rig.packages.good.identity.contentDigest,
  });
  assert.ok(!admission.admitted);
  assert.equal(admission.code, "not-authorized");
  assert.ok(admission.detail.includes("cross-tenant-request"));
});

test("tenancy: a session bound at home is never rebound to a foreign tenant (session-bound-elsewhere)", () => {
  rig.admins.grant(rightsAdminGrant(RIG_FOREIGN_TENANT, RIG_ADMIN));
  const rebind = rig.authority.bindSession(RIG_ADMIN, RIG_FOREIGN_TENANT, RIG_SESSION);
  assert.ok(!rebind.ok);
  assert.equal(rebind.code, "session-bound-elsewhere");
});

test("tenancy confusion: a subject id embedding the foreign tenant's name grants NOTHING here", () => {
  // the confused id is simply an ungranted subject — the platform arm
  // refuses least-privilege, and the runtime arm finds no covering grant.
  const confused = `${RIG_AVATAR_SUBJECT}@${RIG_FOREIGN_TENANT}`;
  const platform = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: confused,
    capability: { kind: "platform", capability: "rewards", permission: "read" },
  });
  assert.ok(!platform.granted);
  assert.equal(platform.code, "capability-not-granted");

  const runtime = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: confused,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "avatar-agent",
      session: { tenant: RIG_TENANT, sessionId: RIG_SESSION, epoch: 1, tick: 5 },
    },
  });
  assert.ok(!runtime.granted);
  assert.equal(runtime.code, "grant-not-found");
});

test("tenancy confusion: a host id embedding the foreign tenant's name is just unknown at home", () => {
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: { kind: "avatar", capability: "movement", host: `${RIG_HOST}@${RIG_FOREIGN_TENANT}` },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "unknown-host");
});

test("tenancy confusion: a session id embedding the foreign tenant's name is unbound", () => {
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "avatar-agent",
      session: { tenant: RIG_TENANT, sessionId: `${RIG_SESSION}@${RIG_FOREIGN_TENANT}`, epoch: 1, tick: 1 },
    },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "session-unbound");
});

test("tenancy confusion: the suspended subject's standing never crosses tenants", () => {
  // the suspension exists at home only — the SAME subject id under the
  // foreign tenant is refused for TENANCY (never adjudicated further).
  const foreign = decideOf(rig, {
    tenant: RIG_FOREIGN_TENANT,
    subject: RIG_SUSPENDED_SUBJECT,
    capability: { kind: "platform", capability: "rewards", permission: "read" },
  });
  assert.ok(!foreign.granted);
  assert.equal(foreign.code, "tenant-mismatch");
  // …while at home the very same subject IS suspended (R11).
  const domestic = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_SUSPENDED_SUBJECT,
    capability: { kind: "platform", capability: "rewards", permission: "read" },
  });
  assert.ok(!domestic.granted);
  assert.equal(domestic.code, "suspended-by-integrity");
});
