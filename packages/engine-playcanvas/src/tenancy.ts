/**
 * TENANCY GUARD (R20) — the tenant scoping seam for the PlayCanvas engine
 * adapter.
 *
 * The adapter serves exactly ONE tenant: the tenant bound at construction.
 * A dispatch carrying a tenant claim (the `tenant` key on the dispatch
 * payload root, promoted to the adapter's typed tenancy header) that does
 * not match the bound tenant is a typed error — the cross-tenant negative
 * path is exercised in the E8 battery. Vocabulary comes from
 * @playliquid/platform-contracts (TenantId), the platform-economy /
 * lab-simulation / tool-blender precedent. Pure: no IO, no clock.
 *
 * Implements: PL-021 R20 discipline (least-privilege tenant isolation).
 */

import { asTenantId } from "@playliquid/platform-contracts";
import type { TenantId } from "@playliquid/platform-contracts";

export type PlayCanvasTenancyRejectionCode =
  | "playcanvas-tenancy/tenant-not-a-string"
  | "playcanvas-tenancy/tenant-invalid"
  | "playcanvas-tenancy/tenant-mismatch";

export interface PlayCanvasTenancyRejection {
  readonly code: PlayCanvasTenancyRejectionCode;
  readonly message: string;
}

export type PlayCanvasTenancyCheck =
  | { readonly outcome: "ok"; readonly tenant: TenantId }
  | { readonly outcome: "rejected"; readonly rejection: PlayCanvasTenancyRejection };

function rejected(code: PlayCanvasTenancyRejectionCode, message: string): PlayCanvasTenancyCheck {
  return { outcome: "rejected", rejection: Object.freeze({ code, message }) };
}

/**
 * Total validator for an untrusted tenant claim. Accepts the platform
 * TenantId grammar only; anything else is a typed rejection.
 */
export function validatePlayCanvasTenantClaim(input: unknown): PlayCanvasTenancyCheck {
  if (typeof input !== "string") {
    return rejected("playcanvas-tenancy/tenant-not-a-string", "tenant claim must be a string");
  }
  const tenant = asTenantId(input);
  if (tenant === undefined) {
    return rejected("playcanvas-tenancy/tenant-invalid", "tenant claim is not a valid TenantId");
  }
  return { outcome: "ok", tenant };
}

/**
 * The bound-tenant check: the adapter's single tenant vs the dispatch's
 * claimed tenant. Mismatch is a typed rejection (R20 isolation discipline).
 */
export function checkPlayCanvasTenancy(
  bound: TenantId,
  claimed: unknown,
): PlayCanvasTenancyCheck {
  const claim = validatePlayCanvasTenantClaim(claimed);
  if (claim.outcome === "rejected") {
    return claim;
  }
  if (claim.tenant !== bound) {
    return rejected(
      "playcanvas-tenancy/tenant-mismatch",
      `this adapter instance serves tenant ${String(bound)}; the dispatch claims ${String(claim.tenant)}`,
    );
  }
  return claim;
}
