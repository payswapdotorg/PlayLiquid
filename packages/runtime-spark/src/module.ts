/**
 * runtime-spark module manifest (PL-035 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format and the sensory-runtime delivery precedent).
 *
 * Dependency declaration mirrors this package manifest's workspace
 * dependencies exactly (spec/module-dependency-matrix.md PL-035 row:
 * runtime-spark | Runtime | runtime-core, build side reaches the
 * orchestrator from packages/spark):
 * - runtime-core: the deterministic Interactive Runtime kernel this
 *   package is a THIN shell over (world snapshots, command/event paths,
 *   journals, ports, construction) — never a fork;
 * - runtime-contracts: the FROZEN SparkTargetProfile vocabulary (R6,
 *   lock rule 16) + Experience Protocol branded primitives;
 * - game-ir: the ONLY content model — documents, nodes, values and the
 *   canonical value form behind content digests (E9);
 * - game-contracts: SceneRef/StreamingPolicy spatial-streaming
 *   vocabulary (R15);
 * - platform-contracts: TenantId/checkTenantIsolation (R20);
 * - package-system: the digest/CAS authority (E7) — computeDigest and
 *   canonicalJson for plan/schedule/manifest digests.
 * Only src/index.ts is exposed publicly.
 */
export const runtime_sparkModule = {
  id: "runtime-spark",
  requires: [
    "runtime-core",
    "runtime-contracts",
    "game-ir",
    "game-contracts",
    "platform-contracts",
    "package-system",
  ],
  provides: ["runtime-spark"],
  publicEntrypoints: ["src/index.ts"],
} as const;
