/**
 * THE DEPLOYMENT VERIFIER (PL-044) — plan → verify → typed results (E8),
 * and a VERIFIED plan gets a content-addressed seal (E9).
 *
 * WHAT THE VERIFIER ENFORCES (each refusal is typed, total — the verifier
 * never throws and mutates nothing):
 *
 * - ARTIFACT TRUTH (PL-011, E7/E8): every unit's pinned content digest
 *   must resolve through the REGISTRY door to a sealed record that still
 *   matches its content digest, AND through the CAS door via
 *   package-registry's own `fetchRecordFromCas` (fetch → parse → re-seal
 *   → digest equality → structural validation), AND both authorities
 *   must agree on the content. Tampered or unknown digests refuse.
 * - PROVENANCE (R19): the verifier re-runs package-system's release gate
 *   ITSELF (`checkReleaseGate`) on the resolved record — provenance is a
 *   DEPLOYMENT gate, never a trust in the registry's admission policy (a
 *   relaxed index cannot smuggle a license-missing artifact through).
 * - TARGET PROFILE (PL-036/PL-008): the unit's target must be in the
 *   frozen taxonomy and the profile bundle must pass target-builds' own
 *   `verifyProfileBundle` (fail-closed, seal-checked).
 * - HEALTH GATES: every gate must cite a known services/ops door (the
 *   frozen OPS_HEALTH_DOORS vocabulary); unknown doors refuse, and a
 *   unit declares its gates without duplicates.
 * - RIGHTS (R20): the submitting subject must be the tenant's
 *   rights-admin (security-gameos' own role oracle); every unit is
 *   tenant-scoped to the plan's tenant (the platform-contracts isolation
 *   oracle); every declared grant is structurally in the lattice
 *   (`isScopedCapabilityGrant` — capability ∈ the frozen R7 vocabulary,
 *   permissions ∈ read/submit/administer); and the grant actually
 *   adjudicates GRANTED through security-gameos' pure lattice fold
 *   (the platform arm — which itself delegates to platform-contracts'
 *   least-privilege oracle, consumed verbatim).
 *
 * E9: the seal is a pure function of (plan content, unit count, instant,
 * verifier id) under the injected clock — run twice, identical.
 */

import { canonicalJson, checkReleaseGate, isContentDigest, verifyPackageDigest } from "../../packages/package-system/src/index.ts";
import type { ReleaseGateFailureCode } from "../../packages/package-system/src/index.ts";
import { fetchRecordFromCas } from "../../packages/package-registry/src/index.ts";
import { verifyProfileBundle } from "../../packages/target-builds/src/index.ts";
import { isTargetId } from "../../packages/target-profiles/src/index.ts";
import { adjudicate, checkRightsRole } from "../../packages/security-gameos/src/index.ts";
import type { LatticeInputs } from "../../packages/security-gameos/src/index.ts";
import { checkTenantIsolation, isScopedCapabilityGrant } from "../../packages/platform-contracts/src/index.ts";
import { isOpsHealthDoor } from "../../services/ops/src/index.ts";
import { DEPLOYMENT_VERIFIER_ID } from "./ports.ts";
import type { DeploymentClockPort, DeploymentDoors, DeploymentSeal, DeploymentVerification, DeploymentVerifierOptions } from "./ports.ts";
import { isDeploymentUnitKind } from "./model.ts";
import type { DeploymentPlan, DeploymentUnit } from "./model.ts";
import { deploymentPlanDigest } from "./model.ts";
import { deploySealDigestOf } from "./digest.ts";

/**
 * The lattice inputs with every arm BUT platform empty: a deployment
 * plan declares only platform capabilities for its service identities,
 * so only the platform arm (platform-contracts' least-privilege oracle,
 * delegated by security-gameos) can ever fire. The empty broker/policy
 * shapes are structural placeholders, never interpreted.
 */
const EMPTY_LATTICE: Omit<LatticeInputs, "platformGrants"> = {
  broker: { grants: [], policy: { capabilityIntentKinds: {}, intentCommandKinds: {}, restrictions: { denied: [], approvalRequired: [] } }, ledger: { consumed: {} } },
  bindings: [],
  sessions: [],
  standings: [],
  elevated: [],
};

/** Mints the deterministic content-addressed seal of a verified plan (E9). */
export function mintDeploymentSeal(plan: DeploymentPlan, clock: DeploymentClockPort): DeploymentSeal {
  const planDigest = deploymentPlanDigest(plan);
  const verifiedAt = clock.now();
  return {
    planDigest,
    sealDigest: deploySealDigestOf({ verifier: DEPLOYMENT_VERIFIER_ID, planDigest, units: plan.units.length, verifiedAt }),
    verifiedAt,
    units: plan.units.length,
    verifier: DEPLOYMENT_VERIFIER_ID,
  };
}

/**
 * Re-derives a committed seal against a plan (E9 + E8): the seal must
 * cover THIS plan's content digest, THIS unit count, the pinned verifier
 * id, and its own seal digest must recompute at its recorded instant. A
 * forged or transplanted seal refuses `seal-mismatch`.
 */
export function verifyDeploymentSeal(
  seal: DeploymentSeal,
  plan: DeploymentPlan,
): { readonly ok: true } | { readonly ok: false; readonly code: "seal-mismatch"; readonly detail: string } {
  const planDigest = deploymentPlanDigest(plan);
  if (seal.planDigest !== planDigest) {
    return { ok: false, code: "seal-mismatch", detail: `the seal covers plan digest ${seal.planDigest.slice(0, 12)}… but this plan hashes to ${planDigest.slice(0, 12)}…` };
  }
  if (seal.units !== plan.units.length) {
    return { ok: false, code: "seal-mismatch", detail: `the seal covers ${String(seal.units)} unit(s) but the plan carries ${String(plan.units.length)}` };
  }
  if (seal.verifier !== DEPLOYMENT_VERIFIER_ID) {
    return { ok: false, code: "seal-mismatch", detail: `the seal names verifier ${seal.verifier}, not ${DEPLOYMENT_VERIFIER_ID}` };
  }
  const recomputed = deploySealDigestOf({ verifier: DEPLOYMENT_VERIFIER_ID, planDigest, units: plan.units.length, verifiedAt: seal.verifiedAt });
  if (recomputed !== seal.sealDigest) {
    return { ok: false, code: "seal-mismatch", detail: "the seal digest does not recompute at its recorded instant (forged or tampered seal, E8)" };
  }
  return { ok: true };
}

/** THE verification door. Total; refusals mutate nothing (E8). */
export function verifyDeploymentPlan(plan: unknown, options: DeploymentVerifierOptions): DeploymentVerification {
  const refusal = verifyPlanShape(plan);
  if (refusal !== undefined) return refusal;
  const typedPlan = plan as DeploymentPlan;
  const seenUnits = new Set<string>();
  for (const unit of typedPlan.units) {
    if (seenUnits.has(unit.unitId)) {
      return { ok: false, code: "invalid-plan", detail: `unit ${unit.unitId} is declared twice` };
    }
    seenUnits.add(unit.unitId);
  }
  const role = checkRightsRole(typedPlan.submittedBy.grants, typedPlan.tenant, typedPlan.submittedBy.subject, "rights-admin");
  if (!role.ok) {
    return { ok: false, code: role.code, detail: `the submitting subject may not deploy: ${role.code === "not-authorized" ? "no rights-admin grant for this tenant's subject (default deny)" : "the subject's rights-admin grant belongs to another tenant (R20)"}` };
  }
  for (const unit of typedPlan.units) {
    const refused = verifyUnit(unit, typedPlan, options.doors);
    if (refused !== undefined) return refused;
  }
  return { ok: true, seal: mintDeploymentSeal(typedPlan, options.clock) };
}

function verifyPlanShape(plan: unknown): DeploymentVerification | undefined {
  if (typeof plan !== "object" || plan === null) {
    return { ok: false, code: "invalid-plan", detail: "a deployment plan is an object" };
  }
  const candidate = plan as Partial<DeploymentPlan>;
  if (typeof candidate.planId !== "string" || candidate.planId.length === 0) {
    return { ok: false, code: "invalid-plan", detail: "the plan carries a non-empty planId" };
  }
  if (typeof candidate.tenant !== "string" || candidate.tenant.length === 0) {
    return { ok: false, code: "invalid-plan", detail: "the plan carries a non-empty tenant" };
  }
  const submitter = candidate.submittedBy;
  if (typeof submitter !== "object" || submitter === null || typeof submitter.subject !== "string" || submitter.subject.length === 0 || !Array.isArray(submitter.grants)) {
    return { ok: false, code: "invalid-plan", detail: "the plan names its submitting subject and its authority grants" };
  }
  if (!Array.isArray(candidate.units) || candidate.units.length === 0) {
    return { ok: false, code: "invalid-plan", detail: "a deployment plan declares at least one service unit" };
  }
  const truth = candidate.truth;
  if (truth === undefined || truth.realInfrastructure !== false || truth.network !== false || truth.containers !== false || truth.secretsManagement !== false) {
    return { ok: false, code: "honesty-violation", detail: "a deployment plan may not claim real infrastructure, network, containers or secrets management — this model verifies in-process only (E11)" };
  }
  return undefined;
}

function verifyUnit(unit: DeploymentUnit, plan: DeploymentPlan, doors: DeploymentDoors): DeploymentVerification | undefined {
  const unitId = typeof unit.unitId === "string" && unit.unitId.length > 0 ? unit.unitId : "<malformed>";
  if (typeof unit.unitId !== "string" || unit.unitId.length === 0 || !isDeploymentUnitKind(unit.kind) || typeof unit.tenant !== "string" || unit.tenant.length === 0) {
    return { ok: false, code: "invalid-plan", unitId, detail: `unit ${unitId} carries a non-empty id, a known kind and a non-empty tenant` };
  }
  if (typeof unit.artifactDigest !== "string" || !isContentDigest(unit.artifactDigest)) {
    return { ok: false, code: "invalid-artifact", unitId, detail: `unit ${unitId} pins a malformed artifact digest (expected a PL-011 content digest, sha256:<64 hex>)` };
  }
  const isolation = checkTenantIsolation({ tenant: plan.tenant }, { tenant: unit.tenant });
  if (!isolation.ok) {
    return { ok: false, code: "cross-tenant-scope", unitId, detail: `unit ${unitId} belongs to tenant ${isolation.resourceTenant} but the plan is tenant ${isolation.requestTenant} — a plan may not deploy another tenant's units (R20)` };
  }
  const gates = unit.healthGates;
  if (!Array.isArray(gates) || gates.length === 0) {
    return { ok: false, code: "invalid-plan", unitId, detail: `unit ${unitId} declares at least one readiness health gate` };
  }
  const seenDoors = new Set<string>();
  for (const door of gates) {
    if (!isOpsHealthDoor(door)) {
      return { ok: false, code: "unknown-health-door", unitId, detail: `unit ${unitId} cites unknown readiness door ${String(door)} — the door vocabulary is frozen (services/ops OPS_HEALTH_DOORS)` };
    }
    if (seenDoors.has(door)) {
      return { ok: false, code: "duplicate-health-door", unitId, detail: `unit ${unitId} declares door ${door} twice` };
    }
    seenDoors.add(door);
  }
  if (!isTargetId(unit.target)) {
    return { ok: false, code: "unknown-target", unitId, detail: `unit ${unitId} targets ${String(unit.target)}, which is outside the frozen target taxonomy` };
  }
  const profile = verifyProfileBundle(doors.profiles.bundleFor(unit.target), unit.target);
  if (!profile.ok) {
    return { ok: false, code: profile.code, unitId, detail: `unit ${unitId}: ${profile.message}` };
  }
  const scopeRefusal = verifyRightsScope(unit);
  if (scopeRefusal !== undefined) return scopeRefusal;
  return verifyArtifact(unit, doors);
}

function verifyRightsScope(unit: DeploymentUnit): DeploymentVerification | undefined {
  if (!Array.isArray(unit.rightsScope)) {
    return { ok: false, code: "invalid-rights-scope", unitId: unit.unitId, detail: `unit ${unit.unitId} carries a rights scope array` };
  }
  const seenPairs = new Set<string>();
  for (const grant of unit.rightsScope) {
    if (!isScopedCapabilityGrant(grant)) {
      return { ok: false, code: "invalid-rights-scope", unitId: unit.unitId, detail: `unit ${unit.unitId} declares a grant outside the R20 lattice (capability must be a frozen platform capability; permissions must be read/submit/administer)` };
    }
    const isolation = checkTenantIsolation(unit, grant);
    if (!isolation.ok) {
      return { ok: false, code: "cross-tenant-scope", unitId: unit.unitId, detail: `unit ${unit.unitId} of tenant ${isolation.requestTenant} declares a grant for tenant ${isolation.resourceTenant} — cross-tenant scope is refused (R20)` };
    }
    const pair = `${grant.subject}:${grant.capability}`;
    if (seenPairs.has(pair)) {
      return { ok: false, code: "invalid-rights-scope", unitId: unit.unitId, detail: `unit ${unit.unitId} declares subject ${grant.subject} on capability ${grant.capability} twice` };
    }
    seenPairs.add(pair);
    for (const permission of grant.permissions) {
      const decision = adjudicate(
        { tenant: unit.tenant, subject: grant.subject, capability: { kind: "platform", capability: grant.capability, permission } },
        { ...EMPTY_LATTICE, platformGrants: unit.rightsScope },
      );
      if (!decision.granted) {
        return { ok: false, code: "rights-not-granted", unitId: unit.unitId, detail: `unit ${unit.unitId}'s declared scope does not adjudicate (${grant.subject} × ${grant.capability}:${permission}): the security-gameos lattice refused \`${decision.code}\` — ${decision.detail}` };
      }
    }
  }
  return undefined;
}

function verifyArtifact(unit: DeploymentUnit, doors: DeploymentDoors): DeploymentVerification | undefined {
  const record = doors.registry.getByDigest(unit.artifactDigest);
  if (record === null) {
    return { ok: false, code: "unknown-artifact", unitId: unit.unitId, detail: `unit ${unit.unitId} pins artifact ${unit.artifactDigest} which no registry record resolves (unknown or tampered digest — no floating tags, E8)` };
  }
  if (!verifyPackageDigest(record)) {
    return { ok: false, code: "tampered-artifact", unitId: unit.unitId, detail: `unit ${unit.unitId}'s artifact record no longer matches its sealed content digest (E8)` };
  }
  const fetched = fetchRecordFromCas(doors.cas, unit.artifactDigest);
  if (!fetched.ok) {
    return { ok: false, code: "artifact-unavailable", unitId: unit.unitId, detail: `unit ${unit.unitId}'s artifact ${unit.artifactDigest} does not resolve through the CAS: ${fetched.code} — ${fetched.message}` };
  }
  if (canonicalJson(record) !== canonicalJson(fetched.record)) {
    return { ok: false, code: "artifact-mismatch", unitId: unit.unitId, detail: `unit ${unit.unitId}'s artifact resolves differently through the registry and the CAS — the authorities disagree` };
  }
  const gate = checkReleaseGate(record);
  if (!gate.pass) {
    const first = gate.reasons[0];
    return { ok: false, code: (first?.code ?? "invalid-record") as ReleaseGateFailureCode, unitId: unit.unitId, detail: `unit ${unit.unitId}'s artifact fails the R19 release gate: ${gate.reasons.map((reason) => `${reason.code} (${reason.message})`).join("; ")}` };
  }
  return undefined;
}
