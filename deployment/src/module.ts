/**
 * deployment module manifest (PL-044 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * deployment tree imports (the qa/browser + services/ops precedent:
 * deployment/ is not a pnpm workspace root, so sibling packages are
 * imported by relative path through their src/index.ts public
 * entrypoints ONLY, and no package.json/workspace importer exists here —
 * the TL owns that surface). The deployment verifier drives:
 *
 * - package-system: the PL-011 record authority — sealed package records
 *   (the artifact corpus), the canonical-JSON serialization authority,
 *   the content-digest discipline (sha256:<64 hex>) and the R19
 *   release gate re-run by the verifier itself;
 * - package-registry: the PL-011 registry/CAS authority — the pure
 *   registry index (getByDigest door), the record↔CAS binding
 *   (publishRecordToCas / fetchRecordFromCas) and the relaxed-index
 *   opt-out the negative corpus exercises;
 * - artifact-store: the PL-011 CAS itself (the DeploymentCasDoor is the
 *   ArtifactStore interface; the in-memory-first implementation backs
 *   the corpus);
 * - platform-contracts: the R20 tenancy/isolation oracles
 *   (checkTenantIsolation), the least-privilege grant shape
 *   (ScopedCapabilityGrant + isScopedCapabilityGrant) and the
 *   TenantId/SubjectId vocabulary;
 * - security-gameos: the R20 rights authority — the pure adjudication
 *   fold (the platform arm of the lattice) and the role seam
 *   (checkRightsRole, RightsAuthorityGrant) authorizing the submitting
 *   tenant's rights-admin;
 * - target-profiles: the PL-008 frozen target taxonomy (TARGETS/
 *   isTargetId) and the sealed profile-record discipline
 *   (sealTargetProfileRecord) the corpus builds its bundles with;
 * - target-builds: the PL-036 surface — the TargetProfilePort seam and
 *   the fail-closed profile verification door (verifyProfileBundle,
 *   createMemoryProfileSource);
 * - runtime-contracts: the Experience-Protocol primitives the sealed
 *   profile records cite (asTargetProfileId, asDigest);
 * - services-ops: the PL-044 operations tree's public health-door
 *   vocabulary (OPS_HEALTH_DOORS / isOpsHealthDoor) its deployment
 *   units' readiness gates cite, plus the deterministic fixed clock the
 *   manifest generation reuses.
 */
export const deploymentModule = {
  id: "deployment",
  requires: [
    "artifact-store",
    "package-registry",
    "package-system",
    "platform-contracts",
    "runtime-contracts",
    "security-gameos",
    "services-ops",
    "target-builds",
    "target-profiles",
  ],
  provides: ["deployment"],
  publicEntrypoints: ["src/index.ts"],
} as const;
