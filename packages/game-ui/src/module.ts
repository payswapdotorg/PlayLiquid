/**
 * game-ui module manifest (PL-033).
 * Dependency declarations match the package manifest and (for the PL-026
 * pair) mirror the two modules that work order delivered. runtime-contracts
 * and game-contracts are declared directly and deliberately: read models
 * carry the protocol layer's branded primitives and the frozen R5 host
 * restriction vocabulary (UI consumes authoritative contracts — matrix
 * game-ui row; same direct-declaration precedent as avatar-runtime).
 * Cross-module access only through here or the package entrypoint;
 * implementation details stay inside the module.
 */
export const game_uiModule = {
  id: "game-ui",
  requires: [
    "package-system",
    "runtime-core",
    "runtime-contracts",
    "tool-fabric-runtime",
    "avatar-runtime",
    "capability-broker",
    "game-contracts",
  ],
  provides: ["game-ui"],
  publicEntrypoints: ["src/index.ts"],
} as const;
