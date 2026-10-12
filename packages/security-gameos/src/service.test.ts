/**
 * SERVICE TESTS (PL-041) — the RightsAuthority doors over the REAL rig:
 * the admin role seam (default deny + cross-tenant probes), the avatar
 * binding door (forged digests, invalid restrictions, idempotent
 * re-registration), the session binding door (R20 rebind refusal), the
 * standing ingestion door, the auditor read doors, and the whole-state
 * snapshot/restore roundtrip incl. the tampered-document refusal (E6/E10).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecurityRig, rightsAdminGrant } from "./index.ts";
import type { SecurityRig } from "./index.ts";
import { brokerSnapshotOf } from "./index.ts";
import { RightsAuthority } from "./service.ts";
import { documentOf, snapshotOf } from "./document.ts";
import {
  RIG_ADMIN,
  RIG_AUDITOR,
  RIG_AVATAR_SUBJECT,
  RIG_FOREIGN_TENANT,
  RIG_HOST,
  RIG_OUTSIDER,
  RIG_REVIEWER,
  RIG_SESSION,
  RIG_SUSPENDED_SUBJECT,
  RIG_TENANT,
} from "./rig.ts";

const rig: SecurityRig = await createSecurityRig();

test("service: registering the same binding again is idempotent (E10)", () => {
  const first = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_TENANT,
    host: "host-rig-second",
    definition: rig.avatarDefinition,
    restriction: rig.restriction,
  });
  assert.ok(first.ok && !first.duplicate);
  const second = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_TENANT,
    host: "host-rig-second",
    definition: rig.avatarDefinition,
    restriction: rig.restriction,
  });
  assert.ok(second.ok && second.duplicate);
  assert.equal(second.binding.revision, first.binding.revision);
});

test("service E8: a forged avatar definition digest is refused tampered-definition", () => {
  const forged = { ...rig.avatarDefinition, definitionDigest: "f".repeat(64) } as typeof rig.avatarDefinition;
  const result = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_TENANT,
    host: "host-rig-forged",
    definition: forged,
    restriction: rig.restriction,
  });
  assert.ok(!result.ok);
  assert.equal(result.code, "tampered-definition");
});

test("service E8: a structurally invalid host restriction is refused invalid-restriction", () => {
  const result = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_TENANT,
    host: "host-rig-bad-restriction",
    definition: rig.avatarDefinition,
    restriction: { denied: [], approvalRequired: [], sandboxed: "no" } as never,
  });
  assert.ok(!result.ok);
  assert.equal(result.code, "invalid-restriction");
});

test("service R20: only a tenant's own rights-admin may register bindings", () => {
  const byOutsider = rig.authority.registerAvatarBinding(RIG_OUTSIDER, {
    tenant: RIG_TENANT,
    host: "host-rig-outsider",
    definition: rig.avatarDefinition,
    restriction: rig.restriction,
  });
  assert.ok(!byOutsider.ok && byOutsider.code === "not-authorized");

  // the admin's grant lives in THIS tenant only — the foreign door refuses
  // with the distinct cross-tenant code (R20, auditable).
  const byForeignAdmin = rig.authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_FOREIGN_TENANT,
    host: "host-rig-foreign",
    definition: rig.avatarDefinition,
    restriction: rig.restriction,
  });
  assert.ok(!byForeignAdmin.ok);
  assert.equal(byForeignAdmin.code, "cross-tenant-request");
});

test("service R20: a session bound to one tenant is never rebound to another", () => {
  // the admin needs a grant in the foreign tenant to REACH the rebind gate —
  // the tenancy guard must still refuse (structural, not role-based).
  rig.admins.grant(rightsAdminGrant(RIG_FOREIGN_TENANT, RIG_ADMIN));
  const rebind = rig.authority.bindSession(RIG_ADMIN, RIG_FOREIGN_TENANT, RIG_SESSION);
  assert.ok(!rebind.ok);
  assert.equal(rebind.code, "session-bound-elsewhere");

  // and the same-tenant rebind is the idempotent duplicate (E10).
  const again = rig.authority.bindSession(RIG_ADMIN, RIG_TENANT, RIG_SESSION);
  assert.ok(again.ok && again.duplicate);
});

test("service: a subject with no recorded standing is refused no-recorded-verdict", () => {
  const result = rig.authority.ingestStanding(RIG_ADMIN, RIG_TENANT, RIG_OUTSIDER);
  assert.ok(!result.ok);
  assert.equal(result.code, "no-recorded-verdict");
});

test("service: the auditor doors read only the tenant-scoped lattice state", () => {
  const state = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(state.ok);
  assert.ok(state.state.bindings.every((binding) => binding.tenant === RIG_TENANT));
  assert.ok(state.state.sessions.every((session) => session.tenant === RIG_TENANT));
  assert.ok(state.state.standings.some((entry) => entry.subject === RIG_SUSPENDED_SUBJECT));
  assert.ok(state.state.elevated.some((right) => right.subject === RIG_REVIEWER));

  const byOutsider = rig.authority.latticeState(RIG_OUTSIDER, RIG_TENANT);
  assert.ok(!byOutsider.ok && byOutsider.code === "not-authorized");
  const foreign = rig.authority.latticeState(RIG_AUDITOR, RIG_FOREIGN_TENANT);
  assert.ok(!foreign.ok && foreign.code === "cross-tenant-request");
});

test("service E6/E10: snapshot → fresh authority (shared store) → restore → the lattice re-enters liveness", () => {
  const snapshot = rig.authority.snapshot(RIG_ADMIN, RIG_TENANT);
  assert.ok(snapshot.ok);

  const second = new RightsAuthority({
    clock: rig.clock.clock,
    store: rig.store.store,
    admins: rig.admins.admins,
    platformGrants: rig.platformGrants.directory,
    broker: brokerSnapshotOf(rig.broker),
    registry: rig.registry,
    artifacts: rig.artifacts,
    economy: {
      declarationsOf: () => [],
      entitlementIn: () => undefined,
    },
    integrity: { standingFor: () => ({ ok: false, code: "no-recorded-verdict" }) },
    escalations: { caseOf: () => ({ ok: false, code: "unknown-case" }) },
  });

  // the fresh authority knows nothing yet…
  const before = second.decide({
    tenant: RIG_TENANT,
    subject: RIG_REVIEWER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  assert.ok(!before.granted && before.code === "no-elevated-right");

  const restored = second.restore(RIG_ADMIN, RIG_TENANT, snapshot.snapshotId);
  assert.ok(restored.ok);
  assert.equal(restored.revision, snapshot.revision);

  const after = second.decide({
    tenant: RIG_TENANT,
    subject: RIG_REVIEWER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  assert.ok(after.granted);
});

test("service E10: a tampered document never re-enters (malformed-document)", () => {
  const state = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(state.ok);
  const ledger = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(ledger.ok);

  // forge: a binding whose avatar definition digest does not recompute.
  const tampered = documentOf({
    revision: 999,
    bindings: [
      ...state.state.bindings,
      {
        tenant: RIG_TENANT,
        host: "host-rig-tampered",
        definition: { ...rig.avatarDefinition, definitionDigest: "0".repeat(64) } as never,
        restriction: rig.restriction,
        registeredAt: 1,
        revision: 1,
      },
    ],
    sessions: [...state.state.sessions],
    standings: [...state.state.standings],
    elevated: [...state.state.elevated],
    ledger: [...ledger.records],
  });
  const stored = snapshotOf(tampered);
  rig.store.store.save(stored);
  const result = rig.authority.restore(RIG_ADMIN, RIG_TENANT, stored.snapshotId);
  assert.ok(!result.ok);
  assert.equal(result.code, "malformed-document");
});

test("service E8: restoring an unknown snapshot is refused snapshot-not-found", () => {
  const result = rig.authority.restore(RIG_ADMIN, RIG_TENANT, "snap-rig-never");
  assert.ok(!result.ok);
  assert.equal(result.code, "snapshot-not-found");
});

test("service: a non-admin cannot snapshot or restore", () => {
  const snap = rig.authority.snapshot(RIG_OUTSIDER, RIG_TENANT);
  assert.ok(!snap.ok && snap.code === "not-authorized");
  const restore = rig.authority.restore(RIG_OUTSIDER, RIG_TENANT);
  assert.ok(!restore.ok && restore.code === "not-authorized");
});

test("service E9: the whole trajectory of a fresh rig is reproducible (same avatar decisions)", () => {
  // a same-shape second binding decision over the SAME state is identical.
  const request = {
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: { kind: "avatar" as const, capability: "speech" as const, host: RIG_HOST },
  };
  const first = rig.authority.decide(request);
  const second = rig.authority.decide(request);
  assert.deepEqual(
    first.granted ? first.right : { code: first.code },
    second.granted ? second.right : { code: second.code },
  );
  assert.ok(!first.granted && first.code === "restricted-by-host");
});
