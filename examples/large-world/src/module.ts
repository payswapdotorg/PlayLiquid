/**
 * large-world module manifest (PL-039 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * example imports (the PL-033 packages/web/gameos mount precedent:
 * examples/ is not a pnpm workspace root, so sibling packages are
 * imported by relative path through their public entrypoints, and no
 * package.json/workspace importer exists here — the TL owns that
 * surface). The work-order dependency set (PL-011, PL-013, PL-014,
 * PL-020) resolves as follows, listed exactly as imported:
 *
 * - package-registry + artifact-store: the federated package graph and
 *   the CAS — the 87 lattice packages publish, pin and resolve through
 *   these authorities (PL-011);
 * - simulation + replay: THE Simulation Runtime this reference runs
 *   (headless, reproducible, resettable, snapshot-able, replayable) and
 *   the platform replay primitive sealing the recorded trajectory
 *   (PL-014; the Interactive Runtime kernel of PL-013 is NOT imported —
 *   lock rule 12 keeps the two execution paths distinct and the
 *   large-world reference demonstrates the headless path; the
 *   Experience Protocol vocabulary itself is runtime-contracts, listed
 *   below);
 * - build-orchestrator + build-contracts: the staged pipeline the
 *   per-chunk builds drive (PL-020);
 * - game-contracts: the frozen spatial vocabulary (World → Region →
 *   Zone → Chunk refs, streaming policies) and id grammar;
 * - game-ir: the GameIR document (the static world definition) and the
 *   value language (R14);
 * - package-system: digest/lock/record sealing authorities;
 * - runtime-contracts: the shared Experience Protocol vocabulary
 *   (sessions, seeds, commands, grants).
 *
 * Only src/index.ts is exposed publicly.
 */
export const latticeModule = {
  id: "large-world",
  requires: [
    "artifact-store",
    "build-contracts",
    "build-orchestrator",
    "game-contracts",
    "game-ir",
    "package-registry",
    "package-system",
    "replay",
    "runtime-contracts",
    "simulation",
  ],
  provides: ["large-world"],
  publicEntrypoints: ["src/index.ts"],
} as const;
