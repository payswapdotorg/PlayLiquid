/**
 * TENANCY GUARD (R20) — the tenant scoping seam for the Blender adapter.
 *
 * The adapter serves exactly ONE tenant: the tenant bound at construction.
 * A dispatch carrying a tenant claim (the `tenant` key on the dispatch
 * payload root, promoted to the adapter's typed tenancy header) that does
 * not match the bound tenant is a typed error — the cross-tenant negative
 * path is exercised in the E8 battery. Vocabulary comes from
 * @playliquid/platform-contracts (TenantId), the platform-economy /
 * lab-simulation precedent. Pure: no IO, no clock.
 *
 * Implements: PL-025 R20 discipline (least-privilege tenant isolation).
 */

import { asTenantId } from "@playliquid/platform-contracts";
import type { TenantId } from "@playliquid/platform-contracts";

export type BlenderTenancyRejectionCode =
  | "blender-tenancy/tenant-not-a-string"
  | "blender-tenancy/tenant-invalid"
  | "blender-tenancy/tenant-mismatch";

export interface BlenderTenancyRejection {
  readonly code: BlenderTenancyRejectionCode;
  readonly message: string;
}

export type BlenderTenancyCheck =
  | { readonly outcome: "ok"; readonly tenant: TenantId }
  | { readonly outcome: "rejected"; readonly rejection: BlenderTenancyRejection };

function rejected(code: BlenderTenancyRejectionCode, message: string): BlenderTenancyCheck {
  return { outcome: "rejected", rejection: Object.freeze({ code, message }) };
}

/**
 * Total validator for an untrusted tenant claim. Accepts the platform
 * TenantId grammar only; anything else is a typed rejection.
 */
export function validateBlenderTenantClaim(input: unknown): BlenderTenancyCheck {
  if (typeof input !== "string") {
    return rejected("blender-tenancy/tenant-not-a-string", "tenant claim must be a string");
  }
  const tenant = asTenantId(input);
  if (tenant === undefined) {
    return rejected("blender-tenancy/tenant-invalid", "tenant claim is not a valid TenantId");
  }
  return { outcome: "ok", tenant };
}

/**
 * The bound-tenant check: the adapter's single tenant vs the dispatch's
 * claimed tenant. Mismatch is a typed rejection (R20 isolation discipline).
 */
export function checkBlenderTenancy(
  bound: TenantId,
  claimed: unknown,
): BlenderTenancyCheck {
  const claim = validateBlenderTenantClaim(claimed);
  if (claim.outcome === "rejected") {
    return claim;
  }
  if (claim.tenant !== bound) {
    return rejected(
      "blender-tenancy/tenant-mismatch",
      `this adapter instance serves tenant ${String(bound)}; the dispatch claims ${String(claim.tenant)}`,
    );
  }
  return claim;
}
