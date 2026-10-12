/**
 * THE RIGHTS LATTICE (PL-041, R20) — the pure effective-right computation.
 *
 * A right is ALWAYS (tenant, subject, capability). Four arms, each
 * delegating to the authority that owns the question:
 *
 * - PLATFORM arm: platform service capabilities (rewards, integrity,
 *   moderation, …). Delegates to platform-contracts' own
 *   `checkLeastPrivilege` oracle over the platform grant directory
 *   snapshot — refusal codes VERBATIM (`tenant-mismatch` is the auditable
 *   cross-tenant probe, `capability-not-granted`/`permission-not-granted`
 *   the least-privilege denials).
 * - AVATAR arm: the R5 body projection. Delegates to avatar-runtime's
 *   `effectiveCapabilities` over the registered binding's definition and
 *   host restriction. A host restriction can only ever REMOVE rights —
 *   an UNDECLARED capability is refused `body-lacks-capability` even
 *   under the most permissive restriction (the R5 negative, proven by
 *   test); a DENIED capability is refused `restricted-by-host`.
 * - RUNTIME arm: broker-mediated avatar actions (lattice-runtime.ts).
 * - ELEVATED-REVIEW arm: rights minted from ingested arena escalation
 *   cases (PL-031). Pure lookup over the minted rights.
 *
 * Every arm applies the integrity-derived suspension LAST-if-at-all
 * (R11): a `suspended` disposition removes the right with the verdict's
 * probabilistic evidence attached (band + interval; certainty is
 * unrepresentable — there is no boolean field anywhere on the entry).
 *
 * Purity: no IO, no clock, no randomness. Same inputs → same result (E9).
 */

import { checkLeastPrivilege } from "@playliquid/platform-contracts";
import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import { effectiveCapabilities } from "@playliquid/avatar-runtime";
import type { AvatarCapabilityId } from "@playliquid/game-contracts";
import type {
  ElevatedReviewRight,
  HostBindingRecord,
  IntegrityRightsEntry,
} from "./ports.ts";
import type { RightsRequest } from "./vocabulary.ts";
import type { AdjudicationResult, LatticeInputs } from "./lattice-folds.ts";
import { currentSuspension, invalid, latestBinding, right, suspended } from "./lattice-folds.ts";
import { adjudicateRuntime } from "./lattice-runtime.ts";

/** THE adjudication fold (pure). Dispatches to the arm by capability kind. */
export function adjudicate(request: RightsRequest, inputs: LatticeInputs): AdjudicationResult {
  const suspension = currentSuspension(request.tenant, request.subject, inputs.standings);
  switch (request.capability.kind) {
    case "platform":
      return adjudicatePlatform(request, inputs.platformGrants, suspension);
    case "avatar":
      return adjudicateAvatar(request, inputs.bindings, suspension);
    case "runtime":
      return adjudicateRuntime(request, inputs, suspension);
    case "elevated-review":
      return adjudicateElevated(request, inputs.elevated, suspension);
    default:
      return invalid("capability kind is not a known arm");
  }
}

// Re-exports of the shared folds (the package's public surface keeps ONE
// module map: everything lattice-related is reachable from here).
export { currentSuspension, denialReasonOf } from "./lattice-folds.ts";
export type {
  IntegrityEvidenceNote,
  EffectiveRight,
  AdjudicationResult,
  LatticeInputs,
} from "./lattice-folds.ts";

// ---------------------------------------------------------------------------
// Platform arm
// ---------------------------------------------------------------------------

function adjudicatePlatform(
  request: RightsRequest,
  grants: readonly ScopedCapabilityGrant[],
  suspension: IntegrityRightsEntry | undefined,
): AdjudicationResult {
  const capability = request.capability;
  if (capability.kind !== "platform") return invalid("dispatch mismatch");
  const check = checkLeastPrivilege(
    {
      tenant: request.tenant as ScopedCapabilityGrant["tenant"],
      subject: request.subject as ScopedCapabilityGrant["subject"],
      capability: capability.capability as ScopedCapabilityGrant["capability"],
      permission: capability.permission as "read",
    },
    grants,
  );
  if (!check.ok) {
    return {
      granted: false,
      code: check.code,
      detail: `platform least-privilege refusal: ${check.code}`,
      evidence: [`capability:${capability.capability}`, `permission:${capability.permission}`],
    };
  }
  return suspended(suspension) ?? right(request, `platform:${capability.capability}`, [
    `grant:${capability.capability}/${capability.permission}`,
    `tenant:${request.tenant}`,
  ], suspension);
}

// ---------------------------------------------------------------------------
// Avatar arm (R5)
// ---------------------------------------------------------------------------

function adjudicateAvatar(
  request: RightsRequest,
  bindings: readonly HostBindingRecord[],
  suspension: IntegrityRightsEntry | undefined,
): AdjudicationResult {
  const capability = request.capability;
  if (capability.kind !== "avatar") return invalid("dispatch mismatch");
  // R20 structural tenancy: the binding must exist for THIS tenant. A
  // binding under another tenant is a typed refusal BEFORE any capability
  // check could pass — never a permission question.
  const current = latestBinding(bindings, request.tenant, capability.host);
  if (current === undefined) {
    const foreign = bindings.some((binding) => binding.host === capability.host);
    return foreign
      ? {
          granted: false,
          code: "cross-tenant-request",
          detail: `host ${capability.host} is bound to another tenant`,
          evidence: [`host:${capability.host}`, `tenant:${request.tenant}`],
        }
      : {
          granted: false,
          code: "unknown-host",
          detail: `no avatar binding for host ${capability.host} in this tenant`,
          evidence: [`host:${capability.host}`],
        };
  }
  const projection = effectiveCapabilities(current.definition, current.restriction);
  const wanted = capability.capability as AvatarCapabilityId;
  if (projection.denied.includes(wanted)) {
    return {
      granted: false,
      code: "restricted-by-host",
      detail: `host restriction denies ${capability.capability} (R5)`,
      evidence: [`host:${capability.host}`, `denied:${capability.capability}`],
    };
  }
  if (!projection.granted.includes(wanted)) {
    // R5 negative: a restriction can only ever REMOVE rights. A capability
    // the body never declared is refused even under the most permissive
    // restriction — restrictions structurally cannot add.
    return {
      granted: false,
      code: "body-lacks-capability",
      detail: `the avatar body never declares ${capability.capability}; a host restriction cannot add it (R5)`,
      evidence: [`host:${capability.host}`, `undeclared:${capability.capability}`],
    };
  }
  return (
    suspended(suspension) ??
    right(request, `avatar:${capability.capability}`, [
      `host:${capability.host}`,
      `definition:${String(current.definition.definitionDigest)}`,
      `survived-restriction:${capability.capability}`,
    ], suspension)
  );
}

// ---------------------------------------------------------------------------
// Elevated-review arm (PL-031-derived)
// ---------------------------------------------------------------------------

function adjudicateElevated(
  request: RightsRequest,
  elevated: readonly ElevatedReviewRight[],
  suspension: IntegrityRightsEntry | undefined,
): AdjudicationResult {
  const capability = request.capability;
  if (capability.kind !== "elevated-review") return invalid("dispatch mismatch");
  const minted = elevated.find(
    (entry) =>
      entry.tenant === request.tenant && entry.subject === request.subject && entry.caseId === capability.caseId,
  );
  if (minted === undefined) {
    const foreign = elevated.some((entry) => entry.caseId === capability.caseId && entry.tenant !== request.tenant);
    return {
      granted: false,
      code: foreign ? "cross-tenant-request" : "no-elevated-right",
      detail: foreign
        ? `elevated review right for case ${capability.caseId} belongs to another tenant`
        : `no elevated review right was minted for case ${capability.caseId}`,
      evidence: [`case:${capability.caseId}`],
    };
  }
  return (
    suspended(suspension) ??
    right(request, "arena-escalated-review", [
      `case:${capability.caseId}`,
      `evidence:${minted.evidenceDigest}`,
    ], suspension)
  );
}
