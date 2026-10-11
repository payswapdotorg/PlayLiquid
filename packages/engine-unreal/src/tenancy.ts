/**
 * TENANCY GUARD (R20) — the tenant scoping seam for the Unreal engine
 * adapter.
 *
 * The adapter serves exactly ONE tenant: the tenant bound at construction.
 * A dispatch carrying a tenant claim (the `tenant` key on the dispatch
 * payload root, promoted to the adapter's typed tenancy header) that does
 * not match the bound tenant is a typed error — the cross-tenant negative
 * path is exercised in the E8 battery. Vocabulary comes from
 * @playliquid/platform-contracts (TenantId), the platform-economy /
 * lab-simulation / tool-blender / engine-playcanvas precedent. Pure: no
 * IO, no clock.
 *
 * Implements: PL-022 R20 discipline (least-privilege tenant isolation).
 */

import { asTenantId } from "@playliquid/platform-contracts";
import type { TenantId } from "@playliquid/platform-contracts";

export type UnrealTenancyRejectionCode =
  | "unreal-tenancy/tenant-not-a-string"
  | "unreal-tenancy/tenant-invalid"
  | "unreal-tenancy/tenant-mismatch";

export interface UnrealTenancyRejection {
  readonly code: UnrealTenancyRejectionCode;
  readonly message: string;
}

export type UnrealTenancyCheck =
  | { readonly outcome: "ok"; readonly tenant: TenantId }
  | { readonly outcome: "rejected"; readonly rejection: UnrealTenancyRejection };

function rejected(code: UnrealTenancyRejectionCode, message: string): UnrealTenancyCheck {
  return { outcome: "rejected", rejection: Object.freeze({ code, message }) };
}

/**
 * Total validator for an untrusted tenant claim. Accepts the platform
 * TenantId grammar only; anything else is a typed rejection.
 */
export function validateUnrealTenantClaim(input: unknown): UnrealTenancyCheck {
  if (typeof input !== "string") {
    return rejected("unreal-tenancy/tenant-not-a-string", "tenant claim must be a string");
  }
  const tenant = asTenantId(input);
  if (tenant === undefined) {
    return rejected("unreal-tenancy/tenant-invalid", "tenant claim is not a valid TenantId");
  }
  return { outcome: "ok", tenant };
}

/**
 * The bound-tenant check: the adapter's single tenant vs the dispatch's
 * claimed tenant. Mismatch is a typed rejection (R20 isolation discipline).
 */
export function checkUnrealTenancy(
  bound: TenantId,
  claimed: unknown,
): UnrealTenancyCheck {
  const claim = validateUnrealTenantClaim(claimed);
  if (claim.outcome === "rejected") {
    return claim;
  }
  if (claim.tenant !== bound) {
    return rejected(
      "unreal-tenancy/tenant-mismatch",
      `this adapter instance serves tenant ${String(bound)}; the dispatch claims ${String(claim.tenant)}`,
    );
  }
  return claim;
}
