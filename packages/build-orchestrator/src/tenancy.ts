/**
 * Tenancy vocabulary of the build orchestrator (R20: least-privilege
 * capability enforcement and TENANT ISOLATION are mandatory).
 *
 * Every mutable state cell this service owns — build records, idempotency
 * encounters, limitations, events — is scoped by tenant, and every command
 * and read names its tenant. A command from tenant A naming a build of
 * tenant B is a typed refusal, never a silent cross-tenant action. The
 * tenant id is a plain branded string: tenancy administration (issuing and
 * authenticating tenants) belongs to the platform identity authority, NOT
 * to this package — the orchestrator only enforces scoping.
 */

import type { Brand } from "@playliquid/build-contracts";

/** Nominal tenant identifier (opaque here; platform-identity owns administration). */
export type TenantId = Brand<string, "TenantId">;

/** Nominal cast: string -> TenantId (system boundary; see platform-identity). */
export function asTenantId(value: string): TenantId {
  return value as TenantId;
}

const TENANT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Type guard: a well-formed tenant id — 1..64 chars, lowercase slug
 * (`org`, `studio-x`, `tenant-1`). Total; never throws.
 */
export function isTenantId(value: unknown): value is TenantId {
  return typeof value === "string" && TENANT_ID_PATTERN.test(value);
}

/** The tenant-scoped idempotency scope key: one namespace per tenant (R20). */
export function tenantEncounterKey(tenant: TenantId, scope: string, requester: string, nonce: string): string {
  return `${tenant}|${scope}|${requester}|${nonce}`;
}
