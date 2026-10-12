/**
 * spark module manifest (PL-035 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format and the engine-family delivery precedent).
 *
 * Dependency declaration mirrors this package manifest's workspace
 * dependencies exactly (spec/module-dependency-matrix.md PL-035 row:
 * the runtime half is runtime-spark | runtime-core; the build half —
 * this package — reaches the orchestrator):
 * - build-orchestrator: the staged build pipeline this surface drives
 *   (intake admission, phase arcs, terminal outputs, event log);
 * - build-contracts: the build request vocabulary — BuildInputs,
 *   BuildRequestCommand, admission (never re-declared here);
 * - target-profiles: the FROZEN spark target profile record vocabulary
 *   (SparkTargetProfileRecord — a spark record cannot exist without its
 *   9:16 mobile-first spark properties, lock rule 16);
 * - runtime-spark: the pure planners whose digests the typed build
 *   results carry (boot plan + stream schedule + cache manifest);
 * - runtime-contracts: the FROZEN SparkTargetProfile constructors the
 *   sealed spark profile records carry (asSparkProfileId / asTargetProfileId
 *   / asTimestamp / asDigest — the runtime half's manifest precedent);
 * - game-ir: the ONLY content model — the documents builds pin;
 * - game-contracts: the frozen id/ref vocabulary of fixture documents
 *   (runtime-spark manifest precedent);
 * - package-system: the digest/CAS authority (E7) — computeDigest,
 *   computeLockFingerprint, lock/record vocabulary for fixtures.
 *
 * Tenancy (R20) rides build-orchestrator's own tenant vocabulary and
 * door enforcement (its tenancy.ts: tenant administration belongs to
 * the platform identity authority — the same decision stands here).
 * Only src/index.ts is exposed publicly.
 */
export const sparkModule = {
  id: "spark",
  requires: [
    "build-contracts",
    "build-orchestrator",
    "game-contracts",
    "game-ir",
    "package-system",
    "runtime-contracts",
    "runtime-spark",
    "target-profiles",
  ],
  provides: ["spark"],
  publicEntrypoints: ["src/index.ts"],
} as const;
