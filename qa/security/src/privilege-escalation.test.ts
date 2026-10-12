/**
 * PRIVILEGE ESCALATION (PL-041 qa negative class) — subjects requesting
 * rights OUTSIDE their grants, and hosts attempting to grant above the
 * lattice's own level:
 * - an ungranted platform subject (`capability-not-granted` verbatim);
 * - a grant without the asked permission (`permission-not-granted`);
 * - a host restriction can only ever REMOVE (R5): the undeclared
 *   capability is refused `body-lacks-capability` under the MOST
 *   permissive restriction — a host structurally cannot add rights;
 * - the restriction binds EVERY subject, admin included
 *   (`restricted-by-host`);
 * - an elevated review right cannot be self-minted by the requester
 *   (`no-elevated-right`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import {
  RIG_ADMIN,
  RIG_AUDITOR,
  RIG_AVATAR_SUBJECT,
  RIG_HOST,
  RIG_OUTSIDER,
  RIG_PLAYER,
  RIG_REVIEWER,
  RIG_TENANT,
  assertRefusalLedgered,
  createSecurityRig,
  decideOf,
} from "./index.ts";
import type { SecurityRig } from "./index.ts";

const rig: SecurityRig = await createSecurityRig();

test("escalation: a subject with NO platform grant is refused capability-not-granted (verbatim)", () => {
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "platform", capability: "rewards", permission: "submit" },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "capability-not-granted");
  assertRefusalLedgered(rig, RIG_TENANT, RIG_OUTSIDER, "capability-not-granted");
});

test("escalation: a permission the grant does not list is refused permission-not-granted (verbatim)", () => {
  // grant a NARROW grant (read only), then ask for submit — the
  // platform-contracts oracle's own middle code.
  rig.platformGrants.grant({
    tenant: asTenantId(RIG_TENANT)!,
    subject: asSubjectId(RIG_PLAYER)!,
    capability: "rewards",
    permissions: ["read"],
  });
  const granted = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_PLAYER,
    capability: { kind: "platform", capability: "rewards", permission: "submit" },
  });
  assert.ok(!granted.granted);
  assert.equal(granted.code, "permission-not-granted");
  assertRefusalLedgered(rig, RIG_TENANT, RIG_PLAYER, "permission-not-granted");
});

test("escalation R5 NEGATIVE: a host's most permissive restriction still cannot add an undeclared capability", () => {
  // re-register the SAME host with deny-nothing — the R5 structural
  // negative: `gaze` is a valid AvatarCapabilityId the body never
  // declares, so even the empty restriction cannot grant it.
  const rebinding = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_TENANT,
    host: RIG_HOST,
    definition: rig.avatarDefinition,
    restriction: { denied: [], approvalRequired: [], sandboxed: false },
  });
  assert.ok(rebinding.ok);
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: { kind: "avatar", capability: "gaze", host: RIG_HOST },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "body-lacks-capability");
  assert.ok(result.detail.includes("cannot add it (R5)"));
  assertRefusalLedgered(rig, RIG_TENANT, RIG_AVATAR_SUBJECT, "body-lacks-capability");
});

test("escalation: the host restriction binds the ADMIN too (no subject is above the lattice)", () => {
  // a fresh host under the speech-denying restriction — the admin is
  // subject to exactly the same R5 fold as every other subject.
  const registered = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_TENANT,
    host: "host-rig-admin-bound",
    definition: rig.avatarDefinition,
    restriction: rig.restriction,
  });
  assert.ok(registered.ok);
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_ADMIN,
    capability: { kind: "avatar", capability: "speech", host: "host-rig-admin-bound" },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "restricted-by-host");
  assertRefusalLedgered(rig, RIG_TENANT, RIG_ADMIN, "restricted-by-host");
});

test("escalation: a reviewer seat cannot be self-assumed (no-elevated-right)", () => {
  // the outsider asks for the arena case's review right directly.
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "no-elevated-right");
  assertRefusalLedgered(rig, RIG_TENANT, RIG_OUTSIDER, "no-elevated-right");
});

test("escalation: only the minted reviewer holds the elevated right (the auditor does not)", () => {
  const result = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_AUDITOR,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  assert.ok(!result.granted);
  assert.equal(result.code, "no-elevated-right");
  const reviewer = decideOf(rig, {
    tenant: RIG_TENANT,
    subject: RIG_REVIEWER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  assert.ok(reviewer.granted);
});
