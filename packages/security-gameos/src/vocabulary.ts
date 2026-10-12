/**
 * THE FROZEN RIGHTS VOCABULARY (PL-041, R20/E8) — every typed refusal
 * code the security authority can emit, plus its own role seam.
 *
 * DELEGATED CODES SURFACE VERBATIM, NEVER RE-IMPLEMENTED:
 * - the platform arm (platform capabilities) refuses with the
 *   platform-contracts least-privilege oracle's own codes
 *   (`tenant-mismatch` / `capability-not-granted` /
 *   `permission-not-granted`) — the oracle is CALLED, never mirrored;
 * - the runtime arm (broker-mediated avatar actions) refuses with
 *   runtime-contracts' own `ActionDenialReason` codes because the pure
 *   `resolveActionRequest` boundary evaluator adjudicates that arm;
 * - the admission gates compose package-registry's
 *   `RecordContentFailureCode` and package-system's
 *   `ReleaseGateFailureCode` vocabularies;
 * - the settlement authorization surfaces platform-economy's own
 *   settlement/door codes (`event-not-declared`, `unknown-entitlement`).
 *
 * LOCAL codes are this authority's own frozen vocabulary (kebab-case):
 * tenancy refusals that fire STRUCTURALLY before any permission check
 * could pass (R20), the R5 restriction semantics, the R11 suspension, and
 * the door-level idempotency/append-only codes (E10).
 *
 * Purity: types + frozen arrays only.
 */

import type { ActionDenialReason } from "@playliquid/runtime-contracts";
import type { PrivilegeCheck } from "@playliquid/platform-contracts";
import type { RecordContentFailureCode } from "@playliquid/package-registry";
import type { ReleaseGateFailureCode } from "@playliquid/package-system";

/** The platform-contracts least-privilege oracle's refusal codes (verbatim). */
export type PrivilegeRefusalCode = Extract<PrivilegeCheck, { ok: false }>["code"];

// ---------------------------------------------------------------------------
// The rights lattice request vocabulary
// ---------------------------------------------------------------------------

/** A tenant-scoped runtime session view (the broker's evaluation context + tenancy). */
export interface RuntimeSessionView {
  readonly tenant: string;
  readonly sessionId: string;
  readonly epoch: number;
  readonly tick: number;
}

/** The capability being adjudicated — always as part of (tenant, subject, capability). */
export type RightsCapability =
  | {
      readonly kind: "platform";
      readonly capability: string;
      readonly permission: string;
    }
  | {
      readonly kind: "avatar";
      readonly capability: string;
      readonly host: string;
    }
  | {
      readonly kind: "runtime";
      readonly capability: string;
      readonly actorClass: string;
      readonly session: RuntimeSessionView;
      /** The grant the subject claims (privilege-escalation attempts cite others' grants). */
      readonly claimedGrantId?: string;
      /** The intent kind the subject wants to exercise under the capability. */
      readonly intentKind?: string;
    }
  | {
      readonly kind: "elevated-review";
      readonly caseId: string;
    };

/** One adjudication request: THE right is (tenant, subject, capability). */
export interface RightsRequest {
  readonly tenant: string;
  readonly subject: string;
  readonly capability: RightsCapability;
}

// ---------------------------------------------------------------------------
// Frozen refusal vocabularies
// ---------------------------------------------------------------------------

/**
 * Refusal codes of the adjudication door (`decide`). The platform and
 * runtime arms carry the delegated vocabularies verbatim; the rest are
 * this authority's own frozen tenancy/R5/R11 codes.
 */
export type LatticeRefusalCode =
  | "invalid-request"
  | "cross-tenant-request"
  | "unknown-host"
  | "session-unbound"
  | "restricted-by-host"
  | "body-lacks-capability"
  | "suspended-by-integrity"
  | "no-elevated-right"
  | PrivilegeRefusalCode
  | ActionDenialReason;

/** All local (non-delegated) adjudication codes (frozen). */
export const LATTICE_LOCAL_REFUSAL_CODES: readonly string[] = Object.freeze([
  "invalid-request",
  "cross-tenant-request",
  "unknown-host",
  "session-unbound",
  "restricted-by-host",
  "body-lacks-capability",
  "suspended-by-integrity",
  "no-elevated-right",
]);

/** Refusal codes of the package admission gate (PL-011 composition, fail-closed). */
export type AdmissionRefusalCode =
  | "invalid-request"
  | "not-authorized"
  | "missing-package"
  | "digest-mismatch"
  | "artifact-missing"
  | "artifact-size-mismatch"
  | "artifact-media-type-mismatch"
  | RecordContentFailureCode
  | ReleaseGateFailureCode;

/**
 * Refusal codes of the settlement-action authorization (R10 composition).
 * `event-not-declared` is platform-economy's frozen settlement code and
 * `unknown-entitlement` its entitlement door's code — surfaced verbatim;
 * the rest are this authority's own.
 */
export type SettlementAuthorizationCode =
  | "invalid-request"
  | "event-not-declared"
  | "unknown-entitlement"
  | "entitlement-holder-mismatch"
  | "suspended-by-integrity"
  | PrivilegeRefusalCode;

/** Refusal codes of the authority's own admin/ingestion doors. */
export type RightsDoorRefusalCode =
  | "invalid-request"
  | "not-authorized"
  | "cross-tenant-request"
  | "tenant-mismatch"
  | "duplicate-entry"
  | "session-bound-elsewhere"
  | "tampered-definition"
  | "invalid-restriction"
  | "no-recorded-verdict"
  | "unknown-case"
  | "case-not-ingested"
  | "snapshot-not-found"
  | "malformed-document";

// ---------------------------------------------------------------------------
// The rights authority's own role seam (R20)
// ---------------------------------------------------------------------------

/** Roles the authority itself recognizes (its own frozen vocabulary). */
export type RightsAuthorityRole = "rights-admin" | "rights-auditor";

/** All valid {@link RightsAuthorityRole} values (frozen). */
export const RIGHTS_AUTHORITY_ROLES: readonly RightsAuthorityRole[] = Object.freeze([
  "rights-admin",
  "rights-auditor",
]);

/** Returns true when `value` is a valid {@link RightsAuthorityRole}. */
export function isRightsAuthorityRole(value: unknown): value is RightsAuthorityRole {
  return typeof value === "string" && (RIGHTS_AUTHORITY_ROLES as readonly string[]).includes(value);
}

/**
 * One authority grant: tenant + subject + role. Grants are additive and
 * tenant-scoped; absence means no role (default deny).
 */
export interface RightsAuthorityGrant {
  readonly tenant: string;
  readonly subject: string;
  readonly role: RightsAuthorityRole;
}

/** Result of the role oracle: allowed, or a typed refusal code. */
export type RoleCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "not-authorized" | "cross-tenant-request" };

/**
 * THE role oracle (pure, default deny). A subject holds a role only via
 * a grant matching tenant AND subject AND role; grants for OTHER tenants
 * are reported distinctly (`cross-tenant-request`) so cross-tenant
 * authority probing is auditable (R20/E8) — mirroring the
 * platform-contracts oracle's semantics for this authority's own seam.
 */
export function checkRightsRole(
  grants: readonly RightsAuthorityGrant[],
  tenant: string,
  subject: string,
  role: RightsAuthorityRole,
): RoleCheck {
  let sawRoleForOtherTenant = false;
  for (const grant of grants) {
    if (grant.subject !== subject || grant.role !== role) continue;
    if (grant.tenant !== tenant) {
      sawRoleForOtherTenant = true;
      continue;
    }
    return { ok: true };
  }
  return sawRoleForOtherTenant
    ? { ok: false, code: "cross-tenant-request" }
    : { ok: false, code: "not-authorized" };
}
