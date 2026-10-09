/**
 * R20 tenant-isolation tests for the identity service. Isolation is
 * enforced by construction (all state is (tenant, subject)-keyed) AND
 * by the bound platform-contracts oracle (`checkTenantIsolation`):
 * a subject that exists under another tenant is a typed violation, and
 * identical alias text in different tenants is perfectly isolated.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLeastPrivilege, checkTenantIsolation } from "@playliquid/platform-contracts";
import type { ScopedCapabilityGrant, SubjectId, TenantId } from "@playliquid/platform-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { IdentityService } from "./service.ts";
import { createFixedClock, createMemoryIdentityStore } from "./fakes.ts";

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const subjectOne = asSubjectId("player-one")!;

function makeService() {
  const store = createMemoryIdentityStore();
  const service = new IdentityService({ store: store.store, clock: createFixedClock().clock });
  return { service };
}

test("tenancy: the contracts isolation oracle refuses cross-tenant access with a typed violation", () => {
  const decision = checkTenantIsolation({ tenant: tenantA }, { tenant: tenantB });
  assert.ok(!decision.ok);
  assert.equal(decision.violation, "cross-tenant-access");
  assert.equal(decision.requestTenant, tenantA);
  assert.equal(decision.resourceTenant, tenantB);
  assert.deepEqual(checkTenantIsolation({ tenant: tenantA }, { tenant: tenantA }), { ok: true });
});

test("tenancy: one subject belongs to exactly one tenant; other tenants get a typed violation", () => {
  const { service } = makeService();
  service.admit({ kind: "register", tenant: tenantA, subject: subjectOne, displayName: "P" });
  // Reading from tenant B: the subject exists, but under tenant A.
  const crossRead = service.identityOf(tenantB, subjectOne);
  assert.ok(!crossRead.found);
  assert.equal(crossRead.code, "cross-tenant-access");
  // Mutating from tenant B: refused BEFORE any tenant-B state change.
  const crossWrite = service.admit({ kind: "assign-alias", tenant: tenantB, subject: subjectOne, alias: "stolen" });
  assert.ok(!crossWrite.accepted && crossWrite.code === "cross-tenant-access");
  // The same subject through tenant A still works.
  const homeWrite = service.admit({ kind: "assign-alias", tenant: tenantA, subject: subjectOne, alias: "home" });
  assert.deepEqual(homeWrite, { accepted: true });
});

test("tenancy: identical alias text in different tenants is isolated (R20)", () => {
  const { service } = makeService();
  const betaSubject = asSubjectId("player-beta")!;
  service.admit({ kind: "register", tenant: tenantA, subject: subjectOne, displayName: "A", alias: "shared" });
  const sameAlias = service.admit({
    kind: "register",
    tenant: tenantB,
    subject: betaSubject,
    displayName: "B",
    alias: "shared",
  });
  assert.deepEqual(sameAlias, { accepted: true });
  const inA = service.resolveAlias(tenantA, "shared");
  const inB = service.resolveAlias(tenantB, "shared");
  assert.ok(inA.found && inB.found);
  assert.equal(inA.subject, subjectOne);
  assert.equal(inB.subject, betaSubject);
});

test("tenancy: unknown subjects in one tenant do not leak existence from another", () => {
  const { service } = makeService();
  service.admit({ kind: "register", tenant: tenantA, subject: subjectOne, displayName: "P" });
  const stranger = service.identityOf(tenantB, asSubjectId("not-registered")!);
  assert.ok(!stranger.found && stranger.code === "unknown-subject");
  const subjectsB = service.subjectsOfTenant(tenantB);
  assert.deepEqual(subjectsB, []);
  assert.equal(service.subjectsOfTenant(tenantA).length, 1);
});

test("tenancy: retire cannot be driven through a foreign tenant", () => {
  const { service } = makeService();
  service.admit({ kind: "register", tenant: tenantA, subject: subjectOne, displayName: "P" });
  const crossRetire = service.admit({ kind: "retire", tenant: tenantB, subject: subjectOne });
  assert.ok(!crossRetire.accepted && crossRetire.code === "cross-tenant-access");
  const lookup = service.identityOf(tenantA, subjectOne);
  assert.ok(lookup.found && lookup.identity.status === "active");
});

test("tenancy: grants scoped to other tenants never satisfy a request (least-privilege oracle, R20)", () => {
  // Identity itself is platform-internal (not a game-declared capability),
  // so its R20 enforcement is tenant isolation; this test pins the oracle
  // semantics the OTHER PL-015 services bind for least privilege.
  const grants: readonly ScopedCapabilityGrant[] = [
    {
      tenant: tenantA as TenantId,
      subject: asSubjectId("admin-a")! as SubjectId,
      capability: "leaderboard",
      permissions: ["read"],
    },
  ];
  const request = {
    tenant: tenantB,
    subject: asSubjectId("admin-a")!,
    capability: "leaderboard" as const,
    permission: "read" as const,
  };
  // The same subject's grant lives under tenant A only: tenant B is refused.
  const decision = checkLeastPrivilege(request, grants);
  assert.ok(!decision.ok);
  assert.equal(decision.code, "tenant-mismatch");
  const homeDecision = checkLeastPrivilege(
    { ...request, tenant: tenantA, permission: "submit" },
    grants,
  );
  assert.ok(!homeDecision.ok && homeDecision.code === "permission-not-granted");
});
