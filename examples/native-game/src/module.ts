/**
 * native-game module manifest (PL-037 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * example imports (the PL-033 packages/web/gameos mount precedent:
 * examples/ is not a pnpm workspace root, so sibling packages are
 * imported by relative path through their public entrypoints, and no
 * package.json/workspace importer exists here — the TL owns that
 * surface). The work-order dependency set (PL-011, PL-013, PL-015,
 * PL-017, PL-018, PL-021, PL-035) plus the transitive public contracts
 * the composition needs (game-ir, game-contracts, platform-contracts,
 * package-system) are all listed exactly as imported:
 *
 * - package-registry + artifact-store: package records, gates and
 *   CAS-backed digests the game's packages resolve through (PL-011);
 * - runtime-core: THE interactive runtime kernel — the Experience
 *   Protocol this game drives (PL-013);
 * - platform-identity/-social/-leaderboard/-achievements: the platform
 *   services the game consumes (PL-015);
 * - platform-economy: entitlement/reward settlement (PL-017, R10);
 * - platform-integrity: probabilistic competitive-integrity evidence
 *   (PL-018, R11);
 * - engine-playcanvas: the web-target engine binding (PL-021, R12);
 * - runtime-spark + spark: the spark fast-start target profile and its
 *   build surface (PL-035, R6);
 * - replay: the platform replay primitive sealing the command stream the
 *   integrity evaluation consumes (R8/R11);
 * - runtime-contracts: the frozen Experience Protocol / session /
 *   intent vocabulary the kernel consumes;
 * - build-contracts + build-orchestrator + target-profiles: the build
 *   input vocabulary, the staged pipeline the spark build drives, and
 *   the frozen target-profile record taxonomy (§Build).
 *
 * Only src/index.ts is exposed publicly.
 */
export const nativeGameModule = {
  id: "native-game",
  requires: [
    "artifact-store",
    "build-contracts",
    "build-orchestrator",
    "engine-playcanvas",
    "game-contracts",
    "game-ir",
    "package-registry",
    "package-system",
    "platform-achievements",
    "platform-contracts",
    "platform-economy",
    "platform-identity",
    "platform-integrity",
    "platform-leaderboard",
    "platform-social",
    "replay",
    "runtime-contracts",
    "runtime-core",
    "runtime-spark",
    "spark",
    "target-profiles",
  ],
  provides: ["native-game"],
  publicEntrypoints: ["src/index.ts"],
} as const;
