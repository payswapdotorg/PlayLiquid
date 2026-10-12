/**
 * TENANCY GUARD (R20) — the tenant scoping seam for the Godot engine
 * adapter.
 *
 * The adapter serves exactly ONE tenant: the tenant bound at construction.
 * A dispatch carrying a tenant claim (the `tenant` key on the dispatch
 * payload root, promoted to the adapter's typed tenancy header) that does
 * not match the bound tenant is a typed error — the cross-tenant negative
 * path is exercised in the E8 battery. Vocabulary comes from
 * @playliquid/platform-contracts (TenantId), the platform-economy /
 * lab-simulation / tool-blender / engine-playcanvas / engine-unreal
 * precedent. Pure: no IO, no clock.
 *
 * Implements: PL-024 R20 discipline (least-privilege tenant isolation).
 */

import { asTenantId } from "@playliquid/platform-contracts";
import type { TenantId } from "@playliquid/platform-contracts";

export type GodotTenancyRejectionCode =
  | "godot-tenancy/tenant-not-a-string"
  | "godot-tenancy/tenant-invalid"
  | "godot-tenancy/tenant-mismatch";

export interface GodotTenancyRejection {
  readonly code: GodotTenancyRejectionCode;
  readonly message: string;
}

export type GodotTenancyCheck =
  | { readonly outcome: "ok"; readonly tenant: TenantId }
  | { readonly outcome: "rejected"; readonly rejection: GodotTenancyRejection };

function rejected(code: GodotTenancyRejectionCode, message: string): GodotTenancyCheck {
  return { outcome: "rejected", rejection: Object.freeze({ code, message }) };
}

/**
 * Total validator for an untrusted tenant claim. Accepts the platform
 * TenantId grammar only; anything else is a typed rejection.
 */
export function validateGodotTenantClaim(input: unknown): GodotTenancyCheck {
  if (typeof input !== "string") {
    return rejected("godot-tenancy/tenant-not-a-string", "tenant claim must be a string");
  }
  const tenant = asTenantId(input);
  if (tenant === undefined) {
    return rejected("godot-tenancy/tenant-invalid", "tenant claim is not a valid TenantId");
  }
  return { outcome: "ok", tenant };
}

/**
 * The bound-tenant check: the adapter's single tenant vs the dispatch's
 * claimed tenant. Mismatch is a typed rejection (R20 isolation discipline).
 */
export function checkGodotTenancy(
  bound: TenantId,
  claimed: unknown,
): GodotTenancyCheck {
  const claim = validateGodotTenantClaim(claimed);
  if (claim.outcome === "rejected") {
    return claim;
  }
  if (claim.tenant !== bound) {
    return rejected(
      "godot-tenancy/tenant-mismatch",
      `this adapter instance serves tenant ${String(bound)}; the dispatch claims ${String(claim.tenant)}`,
    );
  }
  return claim;
}
