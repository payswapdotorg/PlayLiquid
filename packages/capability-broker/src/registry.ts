/**
 * THE AUTHORITATIVE GRANT TABLE (broker-owned state, E1: one owner).
 *
 * Authority in the capability protocol lives in GRANTS
 * (runtime-contracts capability.ts): an {@link CapabilityGrant} is the only
 * carrier of action authority, and grants are issued only by host game
 * policy or the platform ({@link GrantIssuer}). This module is the pure
 * state machine for the table the broker owns:
 *
 * - admission ({@link admitGrant}): duplicate ids, malformed grants,
 *   unknown capabilities, host-denied capabilities (R5/R20) and
 *   approval-required capabilities without the host approval marker are
 *   all refused with typed reasons;
 * - revocation ({@link revokeGrant}): removal by id, idempotent query of
 *   whether the grant existed;
 * - expiry ({@link sweepExpiredGrants}): garbage collection of grants that
 *   are void AT the sweep tick. The contract rule is "grant is void at
 *   ticks strictly greater than `expiresAfterTick`", so a sweep at tick T
 *   removes exactly the grants with `expiresAfterTick < T`; evaluation
 *   keeps denying them the same way before any sweep happens (defense in
 *   depth — the sweep is bookkeeping, never the enforcement).
 *
 * Pure functions over immutable state: every operation returns the next
 * state; nothing is mutated in place, there is no IO, no clock, no
 * randomness. Idempotency: admission of the same (id-distinct) grant twice
 * is refused as `duplicate-grant-id`; revocation is idempotent.
 */

import type { CapabilityGrant, CapabilityGrantId, CapabilityId } from "@playliquid/runtime-contracts";
import type { Tick } from "@playliquid/runtime-contracts";
import type { BrokerPolicy } from "./policy.ts";

/** Immutable broker-owned grant table state. */
export interface GrantRegistryState {
  readonly grants: readonly CapabilityGrant[];
}

/** The empty table. */
export const EMPTY_GRANT_REGISTRY: GrantRegistryState = Object.freeze({ grants: [] });

/** Typed refusal at the grant admission gate. */
export type GrantAdmissionCode =
  | "duplicate-grant-id"
  | "invalid-grant"
  | "unknown-capability"
  | "capability-denied"
  | "approval-required";

/** Result of one admission attempt. Failures are total: state unchanged. */
export type GrantAdmissionResult =
  | { readonly ok: true; readonly registry: GrantRegistryState; readonly grant: CapabilityGrant }
  | { readonly ok: false; readonly code: GrantAdmissionCode; readonly detail: string };

/** A grant admission request; `approvedByHost` is the host approval marker. */
export interface GrantAdmissionRequest {
  readonly grant: CapabilityGrant;
  /**
   * Explicit host approval. MUST be true when the capability is
   * approval-required (R5 `HostRestriction.approvalRequired`); it is read
   * only for that check — it never overrides a denial.
   */
  readonly approvedByHost?: boolean;
}

/**
 * Pure grant admission. Checks, in order: duplicate id, structural
 * validity (epoch >= 1, safe integer constraints with max >= 1 and
 * windowTicks >= 1 for rate windows, non-negative expiry), capability
 * known to the policy, capability not denied by host restriction, host
 * approval present when required. On success returns the next table.
 */
export function admitGrant(
  state: GrantRegistryState,
  policy: BrokerPolicy,
  request: GrantAdmissionRequest,
): GrantAdmissionResult {
  const grant = request.grant;
  if (state.grants.some((existing) => existing.grantId === grant.grantId)) {
    return refused("duplicate-grant-id", `grant ${String(grant.grantId)} already exists`);
  }
  const structural = checkGrantStructure(grant);
  if (structural !== undefined) {
    return refused("invalid-grant", structural);
  }
  const capabilityKey = String(grant.capability);
  const coverage = policy.capabilityIntentKinds[capabilityKey];
  if (coverage === undefined) {
    return refused("unknown-capability", `capability ${capabilityKey} is not declared by the broker policy`);
  }
  if (policy.restrictions.denied.some((denied) => String(denied) === capabilityKey)) {
    return refused("capability-denied", `capability ${capabilityKey} is denied by host restriction (R5/R20)`);
  }
  if (
    policy.restrictions.approvalRequired.some((required) => String(required) === capabilityKey) &&
    request.approvedByHost !== true
  ) {
    return refused(
      "approval-required",
      `capability ${capabilityKey} requires an explicit host approval marker`,
    );
  }
  return { ok: true, registry: { grants: [...state.grants, grant] }, grant };
}

/** Pure revocation. Idempotent: removing an absent grant reports `false`. */
export function revokeGrant(
  state: GrantRegistryState,
  grantId: CapabilityGrantId,
): { readonly registry: GrantRegistryState; readonly existed: boolean } {
  const next = state.grants.filter((grant) => grant.grantId !== grantId);
  return { registry: { grants: next }, existed: next.length !== state.grants.length };
}

/**
 * Pure expiry sweep at tick `at`. Removes exactly the grants that are void
 * at `at` (contract: void at ticks strictly greater than
 * `expiresAfterTick`, i.e. `expiresAfterTick < at`). Returns the swept ids
 * in table order for auditability.
 */
export function sweepExpiredGrants(
  state: GrantRegistryState,
  at: Tick,
): { readonly registry: GrantRegistryState; readonly swept: readonly CapabilityGrantId[] } {
  const kept: CapabilityGrant[] = [];
  const swept: CapabilityGrantId[] = [];
  for (const grant of state.grants) {
    if (grant.expiresAfterTick !== undefined && Number(at) > Number(grant.expiresAfterTick)) {
      swept.push(grant.grantId);
    } else {
      kept.push(grant);
    }
  }
  return { registry: { grants: kept }, swept };
}

/** Read model: the grant with this id, if any. */
export function findGrant(state: GrantRegistryState, grantId: CapabilityGrantId): CapabilityGrant | undefined {
  return state.grants.find((grant) => grant.grantId === grantId);
}

/** Read model: all live grants for one actor within one session scope. */
export function grantsForActor(
  state: GrantRegistryState,
  actor: { readonly actorId: CapabilityGrant["holder"]["actorId"]; readonly actorClass: CapabilityGrant["holder"]["actorClass"] },
  sessionId: CapabilityGrant["scope"]["sessionId"],
): readonly CapabilityGrant[] {
  return state.grants.filter(
    (grant) =>
      grant.holder.actorId === actor.actorId &&
      grant.holder.actorClass === actor.actorClass &&
      grant.scope.sessionId === sessionId,
  );
}

/** Read model: capabilities with at least one live grant for the actor. */
export function grantedCapabilities(
  state: GrantRegistryState,
  actor: { readonly actorId: CapabilityGrant["holder"]["actorId"]; readonly actorClass: CapabilityGrant["holder"]["actorClass"] },
  sessionId: CapabilityGrant["scope"]["sessionId"],
): readonly CapabilityId[] {
  const seen = new Set<string>();
  for (const grant of grantsForActor(state, actor, sessionId)) {
    seen.add(String(grant.capability));
  }
  return [...seen].map((id) => id as CapabilityId);
}

function checkGrantStructure(grant: CapabilityGrant): string | undefined {
  const epoch = Number(grant.epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    return "grant epoch must be a safe integer >= 1";
  }
  if (grant.expiresAfterTick !== undefined) {
    const expiry = Number(grant.expiresAfterTick);
    if (!Number.isSafeInteger(expiry) || expiry < 0) {
      return "expiresAfterTick must be a safe integer >= 0";
    }
  }
  for (const constraint of grant.constraints) {
    if (!Number.isSafeInteger(constraint.max) || constraint.max < 1) {
      return `constraint ${JSON.stringify(constraint.kind)} max must be a safe integer >= 1`;
    }
    if (
      constraint.kind === "rate-per-ticks" &&
      (!Number.isSafeInteger(constraint.windowTicks) || constraint.windowTicks < 1)
    ) {
      return "rate-per-ticks windowTicks must be a safe integer >= 1";
    }
  }
  return undefined;
}

function refused(code: GrantAdmissionCode, detail: string): GrantAdmissionResult {
  return { ok: false, code, detail };
}
