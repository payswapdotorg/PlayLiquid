/**
 * TENANT ISOLATION AND LEAST-PRIVILEGE CONTRACTS (R20, architecture
 * "Security": least privilege, sandboxing and tenant isolation are
 * mandatory).
 *
 * Two enforcement layers:
 *
 * 1. TYPE layer — {@link NamedTenantId} tags a {@link TenantId} with its
 *    literal tenant name, so a record scoped to tenant `alpha` is not
 *    assignable where tenant `beta` data is required (cross-tenant type
 *    rejection, proven by `@ts-expect-error` tests). The tag is a
 *    compile-time phantom, house `as*`-cast pattern: values remain plain
 *    branded strings at runtime.
 * 2. RUNTIME layer — {@link checkTenantIsolation} and
 *    {@link checkLeastPrivilege} are pure oracles over caller-supplied
 *    records, for data that arrives untyped (JSON, network) and for
 *    defense in depth. They NEVER mutate; service implementations
 *    (PL-015..018) own the actual enforcement state.
 *
 * Mutable state owner: the platform tenancy service (later Work Order)
 * owns grant tables. Everything here is pure.
 */

import { isPlatformCapabilityId } from "@playliquid/game-contracts";
import type { PlatformCapabilityId } from "@playliquid/game-contracts";
import type { SubjectId, TenantId } from "./primitives.ts";

// ---------------------------------------------------------------------------
// Phantom tenant tags (compile-time isolation)
// ---------------------------------------------------------------------------

declare const tenantTag: unique symbol;

/** A {@link TenantId} tagged with its tenant's literal name (phantom, compile-time only). */
export type NamedTenantId<Name extends string> = TenantId & { readonly [tenantTag]: Name };

/** Any record whose data belongs to exactly one tenant (R20). */
export interface TenantScoped {
  readonly tenant: TenantId;
}

/**
 * A record scoped to one NOMINALLY known tenant: the phantom tag makes
 * tenant-alpha data unassignable where tenant-beta data is required
 * (cross-tenant type rejection). `TenantScopedFor<Name>` is assignable
 * to `TenantScoped`, never across distinct names.
 */
export interface TenantScopedFor<Name extends string> {
  readonly tenant: NamedTenantId<Name>;
}

/**
 * Nominal cast: view a {@link TenantId} as tagged with tenant `Name`.
 * House boundary-cast pattern — no runtime effect. Meaningful only when
 * the caller derives `Name` from an authoritative tenant registry.
 */
export function asNamedTenantId<Name extends string>(id: TenantId): NamedTenantId<Name> {
  return id as NamedTenantId<Name>;
}

// ---------------------------------------------------------------------------
// Tenant scope declarations and isolation boundaries
// ---------------------------------------------------------------------------

/**
 * How a game declares its tenancy scope. `single-tenant` games must pin
 * exactly one tenant id; `platform-shared` games run on shared platform
 * infrastructure with per-record tenant scoping.
 */
export interface TenantScopeDeclaration {
  readonly mode: "single-tenant" | "platform-shared";
  readonly tenant?: TenantId;
}

/** Returns true when `value` is a structurally valid {@link TenantScopeDeclaration}. */
export function isTenantScopeDeclaration(value: unknown): value is TenantScopeDeclaration {
  if (typeof value !== "object" || value === null) return false;
  const scope = value as Record<string, unknown>;
  if (scope.mode !== "single-tenant" && scope.mode !== "platform-shared") return false;
  if (scope.tenant !== undefined && (typeof scope.tenant !== "string" || scope.tenant.length === 0)) {
    return false;
  }
  return scope.mode !== "single-tenant" || typeof scope.tenant === "string";
}

/**
 * Descriptor of one tenant's isolation boundary (architecture "Security").
 * `granted` lists the platform capabilities this tenant may use — always a
 * subset of the frozen capability vocabulary (R7), without duplicates.
 */
export interface IsolationBoundaryDescriptor {
  readonly tenant: TenantId;
  readonly granted: readonly PlatformCapabilityId[];
  readonly dataBoundary: "tenant-scoped";
}

/** Returns true when `value` is a structurally valid {@link IsolationBoundaryDescriptor}. */
export function isIsolationBoundaryDescriptor(value: unknown): value is IsolationBoundaryDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Record<string, unknown>;
  if (typeof descriptor.tenant !== "string" || descriptor.tenant.length === 0) return false;
  if (descriptor.dataBoundary !== "tenant-scoped") return false;
  if (!Array.isArray(descriptor.granted)) return false;
  const seen = new Set<string>();
  for (const capability of descriptor.granted) {
    if (!isPlatformCapabilityId(capability)) return false;
    if (seen.has(capability)) return false;
    seen.add(capability);
  }
  return true;
}

/** Result of an isolation check: allowed, or a typed cross-tenant violation. */
export type TenantIsolationCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly violation: "cross-tenant-access";
      readonly requestTenant: TenantId;
      readonly resourceTenant: TenantId;
    };

/**
 * THE isolation oracle (pure). Accepts ANY tenant-scoped record — phantom
 * tagged (`TenantScoped<Name>`, assignable since `NamedTenantId` extends
 * `TenantId`) or plain runtime data. A request scoped to tenant A may
 * never touch a resource scoped to tenant B. Cross-tenant access is a
 * typed violation record, never a silent fallback (E8 negative coverage).
 */
export function checkTenantIsolation(
  request: { readonly tenant: TenantId },
  resource: { readonly tenant: TenantId },
): TenantIsolationCheck {
  if (request.tenant === resource.tenant) return { ok: true };
  return {
    ok: false,
    violation: "cross-tenant-access",
    requestTenant: request.tenant,
    resourceTenant: resource.tenant,
  };
}

// ---------------------------------------------------------------------------
// Least privilege (R20)
// ---------------------------------------------------------------------------

/** Coarse permission classes a grant may carry per capability. */
export type CapabilityPermission = "read" | "submit" | "administer";

/** All valid {@link CapabilityPermission} values. */
export const CAPABILITY_PERMISSIONS: readonly CapabilityPermission[] = Object.freeze([
  "read",
  "submit",
  "administer",
]);

/** Returns true when `value` is a valid {@link CapabilityPermission}. */
export function isCapabilityPermission(value: unknown): value is CapabilityPermission {
  return typeof value === "string" && (CAPABILITY_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * A least-privilege grant: one subject, one tenant, one capability, a
 * minimal permission set. Grants are ADDITIVE — absence of a grant means
 * no access (default deny).
 */
export interface ScopedCapabilityGrant {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly capability: PlatformCapabilityId;
  readonly permissions: readonly CapabilityPermission[];
}

/** Returns true when `value` is a structurally valid {@link ScopedCapabilityGrant}. */
export function isScopedCapabilityGrant(value: unknown): value is ScopedCapabilityGrant {
  if (typeof value !== "object" || value === null) return false;
  const grant = value as Record<string, unknown>;
  if (typeof grant.tenant !== "string" || grant.tenant.length === 0) return false;
  if (typeof grant.subject !== "string" || grant.subject.length === 0) return false;
  if (!isPlatformCapabilityId(grant.capability)) return false;
  if (!Array.isArray(grant.permissions) || grant.permissions.length === 0) return false;
  if (!grant.permissions.every((permission) => isCapabilityPermission(permission))) return false;
  return new Set(grant.permissions).size === grant.permissions.length;
}

/** A subject's request to exercise one permission of one capability. */
export interface CapabilityUseRequest {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly capability: PlatformCapabilityId;
  readonly permission: CapabilityPermission;
}

/** Result of a least-privilege check: allowed, or a typed refusal code. */
export type PrivilegeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "tenant-mismatch" | "capability-not-granted" | "permission-not-granted" };

/**
 * THE least-privilege oracle (pure, default deny). A request passes only
 * when some grant matches tenant AND subject AND capability, and the
 * requested permission is within that grant's permission set. Matching
 * grants for OTHER tenants never satisfy a request (tenant-mismatch is
 * reported distinctly so cross-tenant probing is auditable, R20/E8).
 */
export function checkLeastPrivilege(
  request: CapabilityUseRequest,
  grants: readonly ScopedCapabilityGrant[],
): PrivilegeCheck {
  let sawCapabilityForOtherTenant = false;
  for (const grant of grants) {
    if (grant.subject !== request.subject || grant.capability !== request.capability) continue;
    if (grant.tenant !== request.tenant) {
      sawCapabilityForOtherTenant = true;
      continue;
    }
    if (grant.permissions.includes(request.permission)) return { ok: true };
    return { ok: false, code: "permission-not-granted" };
  }
  if (sawCapabilityForOtherTenant) return { ok: false, code: "tenant-mismatch" };
  return { ok: false, code: "capability-not-granted" };
}
