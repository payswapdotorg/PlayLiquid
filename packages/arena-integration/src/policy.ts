/**
 * ARENA AUTHORIZATION POLICY PORT — the Lab's usage rules for WHAT MAY BE
 * REQUESTED from the external Arena (work order optional scope item).
 *
 * This is a pure PORT, not an implementation: the Lab side (arena runtime,
 * PL-031) supplies the real policy; this package ships only deterministic
 * fakes for tests and the harness. The port deliberately reuses the frozen
 * deny-reason vocabulary from `authorization.ts` so policy verdicts are
 * machine-checkable and audit-trackable without free-form text.
 *
 * What the policy is NOT:
 * - it is NOT the runtime Capability Broker (packages/capability-broker,
 *   PL-026 owns avatar/agent action permissions — one authority per
 *   concern, E1);
 * - it is NOT the response validator (`validate.ts` owns response-side
 *   admission);
 * - it does NOT see live state: `decide` folds only the request candidate.
 *
 * Purity: no IO, no clock, no randomness; decisions are deterministic
 * functions of the candidate.
 */

import { asArenaPolicyId } from "./authorization.ts";
import type { ArenaArtifactClass, ArenaPolicyDenyReason, ArenaPolicyId } from "./authorization.ts";
import { requestKindArtifactClass } from "./request.ts";
import type { ArenaRequestEnvelope, ArenaRequestKind } from "./request.ts";
import type { ArenaEndpointRef } from "./primitives.ts";

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/** The typed verdict of one policy evaluation. */
export type ArenaPolicyDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: ArenaPolicyDenyReason };

/**
 * The pure authorization-policy port. Implementations must be
 * deterministic: the same candidate always yields the same decision.
 * `policyId` identifies the rule set for audit records
 * ({@link "./authorization.ts".ArenaAuthorizationDecisionRecord}).
 */
export type ArenaAuthorizationPolicy = Readonly<{
  readonly policyId: ArenaPolicyId;
  decide(candidate: ArenaRequestEnvelope): ArenaPolicyDecision;
}>;

// ---------------------------------------------------------------------------
// Deterministic fakes (tests, harness)
// ---------------------------------------------------------------------------

/** Fake policy that allows every well-formed candidate. */
export function allowAllArenaPolicy(policyIdText: string): ArenaAuthorizationPolicy {
  const policyId = requirePolicyId(policyIdText);
  return {
    policyId,
    decide: () => ({ allowed: true }),
  };
}

/** Fake policy that denies every candidate with one frozen reason. */
export function denyAllArenaPolicy(policyIdText: string, reason: ArenaPolicyDenyReason): ArenaAuthorizationPolicy {
  const policyId = requirePolicyId(policyIdText);
  return {
    policyId,
    decide: () => ({ allowed: false, reason }),
  };
}

/** Configuration of the scope-limit fake policy; `undefined` lists mean "unrestricted". */
export type ArenaScopeLimitPolicyConfig = Readonly<{
  allowedKinds?: readonly ArenaRequestKind[];
  allowedArtifactClasses?: readonly ArenaArtifactClass[];
  allowedEndpoints?: readonly ArenaEndpointRef[];
}>;

/**
 * Deterministic rules-based fake policy: allows a candidate iff its request
 * kind is listed, its artifact class (for artifact kinds) is listed, and
 * its endpoint is listed. First matching refusal wins, in that order.
 */
export function scopeLimitArenaPolicy(policyIdText: string, config: ArenaScopeLimitPolicyConfig): ArenaAuthorizationPolicy {
  const policyId = requirePolicyId(policyIdText);
  return {
    policyId,
    decide(candidate: ArenaRequestEnvelope): ArenaPolicyDecision {
      if (config.allowedKinds !== undefined && !config.allowedKinds.includes(candidate.requestKind)) {
        return { allowed: false, reason: "request-kind-not-permitted" };
      }
      const artifactClass = requestKindArtifactClass(candidate.requestKind);
      if (
        artifactClass !== undefined &&
        config.allowedArtifactClasses !== undefined &&
        !config.allowedArtifactClasses.includes(artifactClass)
      ) {
        return { allowed: false, reason: "artifact-class-not-permitted" };
      }
      if (
        config.allowedEndpoints !== undefined &&
        !config.allowedEndpoints.some((endpoint) => endpoint.endpointDigest === candidate.endpoint.endpointDigest)
      ) {
        return { allowed: false, reason: "endpoint-not-permitted" };
      }
      return { allowed: true };
    },
  };
}

/** Parses a policy id or throws (fake constructors take trusted text). */
function requirePolicyId(policyIdText: string): ArenaPolicyId {
  const policyId = asArenaPolicyId(policyIdText);
  if (policyId === undefined) {
    throw new Error(`invalid Arena policy id: ${policyIdText}`);
  }
  return policyId;
}
