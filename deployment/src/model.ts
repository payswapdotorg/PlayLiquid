/**
 * THE TYPED DEPLOYMENT MODEL (PL-044) — a DeploymentPlan is service UNITS,
 * each pinned to EXACTLY what a verifier can check:
 *
 * - ARTIFACT: a PL-011 package-registry/artifact-store CONTENT DIGEST
 *   (package-system's `ContentDigest` — `sha256:<64 hex>`). No floating
 *   tags, no "latest": a deployment unit is content, addressed by content.
 * - TARGET PROFILE: a target id from the FROZEN target taxonomy
 *   (target-profiles, PL-008 — the taxonomy PL-036's target-builds
 *   resolves against); the sealed profile bundle itself is supplied by
 *   the host's target-profile port and verified through target-builds'
 *   own `verifyProfileBundle` door.
 * - HEALTH GATE: a readiness dependency declaration citing the
 *   services/ops health DOOR vocabulary (OPS_HEALTH_DOORS — PL-044's own
 *   frozen eight: package-registry, artifact-cas, build-orchestrator,
 *   rights-authority, platform-economy, platform-integrity,
 *   ops-worker-journal, web-host-composition).
 * - RIGHTS SCOPE (R20): an explicit least-privilege grant list in the
 *   platform-contracts `ScopedCapabilityGrant` shape — the exact
 *   vocabulary security-gameos' platform lattice arm consumes — verified
 *   through security-gameos' own adjudication fold.
 * - PROVENANCE (R19): carried BY THE ARTIFACT RECORD (package-system's
 *   provenance + license metadata) and enforced by the release gate the
 *   verifier re-runs itself — never trusted from the registry's
 *   admission policy.
 *
 * E11 HONESTY: the model carries the environment truth structurally
 * (all-false) — there is no real infrastructure, no network, no
 * containers, no secrets management anywhere in this tree; a plan is a
 * typed MODEL verified in-process, and a real deployment would bind the
 * same contracts to real infrastructure.
 *
 * Purity: types, frozen vocabularies and total structural guards only.
 */

import { isContentDigest } from "../../packages/package-system/src/index.ts";
import { isTargetId } from "../../packages/target-profiles/src/index.ts";
import type { TargetId } from "../../packages/target-profiles/src/index.ts";
import { isOpsHealthDoor } from "../../services/ops/src/index.ts";
import type { OpsHealthDoorId } from "../../services/ops/src/index.ts";
import { isRightsAuthorityRole } from "../../packages/security-gameos/src/index.ts";
import type { RightsAuthorityGrant } from "../../packages/security-gameos/src/index.ts";
import { isScopedCapabilityGrant } from "../../packages/platform-contracts/src/index.ts";
import type { ScopedCapabilityGrant, SubjectId, TenantId } from "../../packages/platform-contracts/src/index.ts";
import { deployPlanDigestOf, isJsonSafe, jsonSafeOf } from "./digest.ts";

/** Every deployment unit kind of this repo's honest topology (frozen). */
export const DEPLOYMENT_UNIT_KINDS = Object.freeze([
  "ops-service",
  "web-host",
  "platform-service",
] as const);

/** One deployment unit kind. */
export type DeploymentUnitKind = (typeof DEPLOYMENT_UNIT_KINDS)[number];

/** Type guard over {@link DeploymentUnitKind}. */
export function isDeploymentUnitKind(value: unknown): value is DeploymentUnitKind {
  return typeof value === "string" && (DEPLOYMENT_UNIT_KINDS as readonly string[]).includes(value);
}

/**
 * The E11 environment truth every deployment plan carries (all-false,
 * structural): no real infrastructure, no network, no containers, no
 * secrets management. A plan that claims otherwise cannot verify.
 */
export interface DeploymentEnvironmentTruth {
  readonly realInfrastructure: false;
  readonly network: false;
  readonly containers: false;
  readonly secretsManagement: false;
}

/** The only truth value that can verify (E11). */
export const DEPLOYMENT_TRUTH: DeploymentEnvironmentTruth = Object.freeze({
  realInfrastructure: false,
  network: false,
  containers: false,
  secretsManagement: false,
});

/** Structural guard over {@link DeploymentEnvironmentTruth}. */
export function isDeploymentEnvironmentTruth(value: unknown): value is DeploymentEnvironmentTruth {
  if (typeof value !== "object" || value === null) return false;
  const truth = value as Partial<DeploymentEnvironmentTruth>;
  return truth.realInfrastructure === false && truth.network === false && truth.containers === false && truth.secretsManagement === false;
}

/**
 * One deployable service unit. `artifactDigest` is the unit's WHOLE
 * content pin (PL-011); the registry record behind it carries the R19
 * provenance/license evidence the verifier re-checks itself.
 */
export interface DeploymentUnit {
  readonly unitId: string;
  readonly kind: DeploymentUnitKind;
  /** The tenant this unit serves/is scoped to (R20). */
  readonly tenant: TenantId;
  /** PL-011 content digest of the unit's artifact record (no floating tags). */
  readonly artifactDigest: string;
  /** The frozen target taxonomy id this unit deploys onto. */
  readonly target: TargetId;
  /** The readiness doors this unit's deployment is gated on. */
  readonly healthGates: readonly OpsHealthDoorId[];
  /**
   * The least-privilege platform grants this unit's service identity
   * holds (R20). May be EMPTY for pure infrastructure units — absence of
   * a grant means no access (default deny), the honest minimum.
   */
  readonly rightsScope: readonly ScopedCapabilityGrant[];
}

/** Who submits a plan for verification (the tenant's rights-admin, R20). */
export interface DeploymentSubmitter {
  readonly subject: SubjectId;
  /** The security-gameos authority role grants backing the submission. */
  readonly grants: readonly RightsAuthorityGrant[];
}

/** THE deployment plan (content-addressed by {@link deploymentPlanDigest}). */
export interface DeploymentPlan {
  readonly planId: string;
  readonly tenant: TenantId;
  readonly submittedBy: DeploymentSubmitter;
  readonly units: readonly DeploymentUnit[];
  readonly truth: DeploymentEnvironmentTruth;
}

/** Type guard over {@link DeploymentUnit} (total; untrusted input safe). */
export function isDeploymentUnit(value: unknown): value is DeploymentUnit {
  if (typeof value !== "object" || value === null) return false;
  const unit = value as Partial<DeploymentUnit>;
  if (typeof unit.unitId !== "string" || unit.unitId.length === 0 || unit.unitId.length > 214) return false;
  if (!isDeploymentUnitKind(unit.kind)) return false;
  if (typeof unit.tenant !== "string" || unit.tenant.length === 0) return false;
  if (!isContentDigest(unit.artifactDigest)) return false;
  if (!isTargetId(unit.target)) return false;
  if (!Array.isArray(unit.healthGates) || unit.healthGates.length === 0) return false;
  if (!unit.healthGates.every((door) => isOpsHealthDoor(door))) return false;
  if (!Array.isArray(unit.rightsScope)) return false;
  return unit.rightsScope.every((grant) => isScopedCapabilityGrant(grant));
}

/** Type guard over {@link DeploymentSubmitter} (total). */
export function isDeploymentSubmitter(value: unknown): value is DeploymentSubmitter {
  if (typeof value !== "object" || value === null) return false;
  const submitter = value as Partial<DeploymentSubmitter>;
  if (typeof submitter.subject !== "string" || submitter.subject.length === 0) return false;
  if (!Array.isArray(submitter.grants)) return false;
  return submitter.grants.every((grant) => {
    if (typeof grant !== "object" || grant === null) return false;
    const candidate = grant as Partial<RightsAuthorityGrant>;
    return (
      typeof candidate.tenant === "string" && candidate.tenant.length > 0 &&
      typeof candidate.subject === "string" && candidate.subject.length > 0 &&
      isRightsAuthorityRole(candidate.role)
    );
  });
}

/** Type guard over {@link DeploymentPlan} (total; untrusted input safe). */
export function isDeploymentPlan(value: unknown): value is DeploymentPlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as Partial<DeploymentPlan>;
  if (typeof plan.planId !== "string" || plan.planId.length === 0 || plan.planId.length > 214) return false;
  if (typeof plan.tenant !== "string" || plan.tenant.length === 0) return false;
  if (!isDeploymentSubmitter(plan.submittedBy)) return false;
  if (!Array.isArray(plan.units) || plan.units.length === 0) return false;
  if (!plan.units.every((unit) => isDeploymentUnit(unit))) return false;
  if (!isDeploymentEnvironmentTruth(plan.truth)) return false;
  return isJsonSafe(value);
}

/**
 * The canonical content a plan's identity digest covers (E9): everything
 * except bookkeeping the digest itself would make circular. Key order is
 * never significant (canonicalJson sorts keys).
 */
export function deploymentPlanContent(plan: DeploymentPlan): unknown {
  return jsonSafeOf({
    planId: plan.planId,
    tenant: plan.tenant,
    submittedBy: plan.submittedBy,
    units: plan.units,
    truth: plan.truth,
  });
}

/** The content-addressed identity digest of a deployment plan (E9). */
export function deploymentPlanDigest(plan: DeploymentPlan): string {
  return deployPlanDigestOf(deploymentPlanContent(plan));
}
