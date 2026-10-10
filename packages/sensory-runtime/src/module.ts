/**
 * sensory-runtime module manifest (PL-027 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format and the lab-simulation delivery precedent).
 *
 * Dependency declaration mirrors spec/module-dependency-matrix.md design
 * intent row `sensory-runtime | Runtime | avatar-runtime` plus the typed
 * vocabulary each seam needs (recorded here per the avatar-runtime and
 * lab-simulation precedents of declaring frozen-vocabulary dependencies
 * directly):
 * - avatar-runtime: the managed foundation — SensorSample,
 *   SensorInputPort, AvatarDefinition/HostRestriction composition
 *   projection. Contracts-only import through the package entry.
 * - game-contracts: the FROZEN SensorCapabilityId vocabulary (R5).
 * - game-ir: canonical value forms + hashGameIRValue — the semantic
 *   kernel's digest authority for sample content digests (E9).
 * - runtime-contracts: Digest/Tick/SessionEpoch brands.
 * - platform-contracts: TenantId/SubjectId/checkTenantIsolation (R20).
 * - package-system: canonical JSON + computeDigest for envelope content
 *   keys at this package's own seam (community precedent).
 * Only src/index.ts is exposed publicly.
 */
export const sensory_runtimeModule = {
  id: "sensory-runtime",
  requires: [
    "avatar-runtime",
    "game-contracts",
    "game-ir",
    "runtime-contracts",
    "platform-contracts",
    "package-system",
  ],
  provides: ["sensory-runtime"],
  publicEntrypoints: ["src/index.ts"],
} as const;
