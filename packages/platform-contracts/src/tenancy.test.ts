import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId } from "./primitives.ts";
import {
  asNamedTenantId,
  isTenantScopeDeclaration,
  isIsolationBoundaryDescriptor,
  checkTenantIsolation,
  isCapabilityPermission,
  isScopedCapabilityGrant,
  checkLeastPrivilege,
} from "./tenancy.ts";
import type {
  TenantScoped,
  TenantScopedFor,
  IsolationBoundaryDescriptor,
  ScopedCapabilityGrant,
  CapabilityUseRequest,
} from "./tenancy.ts";

const tenantAlpha = asTenantId("tenant-alpha")!;
const tenantBeta = asTenantId("tenant-beta")!;
const subjectOne = asSubjectId("subject-one")!;

test("tenancy: scope declarations are well-formed or refused", () => {
  assert.ok(isTenantScopeDeclaration({ mode: "single-tenant", tenant: tenantAlpha }));
  assert.ok(isTenantScopeDeclaration({ mode: "platform-shared" }));
  assert.equal(isTenantScopeDeclaration({ mode: "single-tenant" }), false);
  assert.equal(isTenantScopeDeclaration({ mode: "omni-tenant" }), false);
  assert.equal(isTenantScopeDeclaration(null), false);
});

test("tenancy: isolation boundaries grant known capabilities without duplicates", () => {
  assert.ok(
    isIsolationBoundaryDescriptor({
      tenant: tenantAlpha,
      granted: ["leaderboard", "replay"],
      dataBoundary: "tenant-scoped",
    }),
  );
  assert.equal(
    isIsolationBoundaryDescriptor({
      tenant: tenantAlpha,
      granted: ["leaderboard", "leaderboard"],
      dataBoundary: "tenant-scoped",
    }),
    false,
  );
  assert.equal(
    isIsolationBoundaryDescriptor({
      tenant: tenantAlpha,
      granted: ["cloud-save"],
      dataBoundary: "tenant-scoped",
    }),
    false,
  );
  assert.equal(
    isIsolationBoundaryDescriptor({ tenant: tenantAlpha, granted: [], dataBoundary: "shared" }),
    false,
  );
});

test("tenancy: cross-tenant access is a typed violation, never a fallback (R20)", () => {
  const request: TenantScoped = { tenant: tenantAlpha };
  const ownResource: TenantScoped = { tenant: tenantAlpha };
  const foreignResource: TenantScoped = { tenant: tenantBeta };
  assert.deepEqual(checkTenantIsolation(request, ownResource), { ok: true });
  const violation = checkTenantIsolation(request, foreignResource);
  assert.equal(violation.ok, false);
  if (!violation.ok) {
    assert.equal(violation.violation, "cross-tenant-access");
    assert.equal(violation.requestTenant, tenantAlpha);
    assert.equal(violation.resourceTenant, tenantBeta);
  }
});

test("tenancy: a tenant-alpha record is not a tenant-beta record (cross-tenant type rejection, compile-time)", () => {
  const alphaScoped: TenantScopedFor<"tenant-alpha"> = {
    tenant: asNamedTenantId<"tenant-alpha">(tenantAlpha),
  };
  // @ts-expect-error — TenantScopedFor<"tenant-alpha"> is not TenantScopedFor<"tenant-beta">
  const betaScoped: TenantScopedFor<"tenant-beta"> = alphaScoped;
  // The phantom tag is compile-time only; runtime values stay plain ids.
  assert.equal(betaScoped.tenant, tenantAlpha);
  // A nominally-scoped record is still a plain TenantScoped record.
  const asScoped: TenantScoped = alphaScoped;
  assert.equal(asScoped.tenant, tenantAlpha);
});

test("tenancy: least privilege is default deny (R20)", () => {
  const grants: readonly ScopedCapabilityGrant[] = [
    {
      tenant: tenantAlpha,
      subject: subjectOne,
      capability: "leaderboard",
      permissions: ["read"],
    },
  ];
  const read: CapabilityUseRequest = {
    tenant: tenantAlpha,
    subject: subjectOne,
    capability: "leaderboard",
    permission: "read",
  };
  assert.deepEqual(checkLeastPrivilege(read, grants), { ok: true });

  const administer: CapabilityUseRequest = { ...read, permission: "administer" };
  assert.deepEqual(checkLeastPrivilege(administer, grants), {
    ok: false,
    code: "permission-not-granted",
  });

  const unknown: CapabilityUseRequest = { ...read, capability: "integrity" };
  assert.deepEqual(checkLeastPrivilege(unknown, grants), {
    ok: false,
    code: "capability-not-granted",
  });

  assert.deepEqual(checkLeastPrivilege(read, []), { ok: false, code: "capability-not-granted" });
});

test("tenancy: grants held in another tenant never satisfy a request (auditable mismatch)", () => {
  const foreignGrant: ScopedCapabilityGrant = {
    tenant: tenantBeta,
    subject: subjectOne,
    capability: "leaderboard",
    permissions: ["read"],
  };
  const request: CapabilityUseRequest = {
    tenant: tenantAlpha,
    subject: subjectOne,
    capability: "leaderboard",
    permission: "read",
  };
  assert.deepEqual(checkLeastPrivilege(request, [foreignGrant]), {
    ok: false,
    code: "tenant-mismatch",
  });
});

test("tenancy: permission and grant guards refuse junk", () => {
  assert.ok(isCapabilityPermission("read"));
  assert.equal(isCapabilityPermission("root"), false);
  assert.ok(isScopedCapabilityGrant({
    tenant: tenantAlpha,
    subject: subjectOne,
    capability: "social",
    permissions: ["read", "submit"],
  }));
  assert.equal(
    isScopedCapabilityGrant({ tenant: tenantAlpha, subject: subjectOne, capability: "social", permissions: [] }),
    false,
  );
  assert.equal(
    isScopedCapabilityGrant({ tenant: tenantAlpha, subject: subjectOne, capability: "social", permissions: ["read", "read"] }),
    false,
  );
});

test("tenancy: boundary descriptors are readonly data (E1 compile check)", () => {
  const descriptor: IsolationBoundaryDescriptor = {
    tenant: tenantAlpha,
    granted: ["analytics"],
    dataBoundary: "tenant-scoped",
  };
  // @ts-expect-error — E1: contract fields are readonly
  descriptor.dataBoundary = "shared";
  // readonly is a compile-time guarantee; runtime deep-freezing is the
  // owning service's job (this package is pure data).
  assert.equal(descriptor.tenant, tenantAlpha);
});
