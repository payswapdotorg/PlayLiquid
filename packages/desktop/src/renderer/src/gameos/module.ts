/**
 * gameos-product-shell module manifest (RW-001, spec/release/ACR-R1).
 *
 * The PlayLiquid GameOS desktop product shell: the DEFAULT first-window
 * experience composing the existing product modules (game-ui Studio,
 * gameos-lab, gameos-community) behind PlayLiquid GameOS navigation with
 * host-wired ports. Production data crosses the modules' existing typed
 * seams only — no demo fixtures, no StaticStudioDataPort, no fakes (lock
 * rule 44); E5 (UI reads through ports) and E13 (typed intents) verbatim.
 *
 * requires mirrors every module whose public source this shell may
 * import: the three product UI modules plus the domain read models their
 * host adapters source (Lab, Community, arena, platform contracts, the
 * package/runtime/broker/tools/avatar systems backing the Studio).
 * Relative-source imports per the PL-033/034 gameos mount precedent —
 * the web/desktop package manifests and the TL-frozen pnpm-lock stay
 * untouched. React is host-provided (the desktop renderer).
 */
export const gameos_productShellModule = {
  id: "gameos-product-shell",
  requires: [
    "game-ui",
    "gameos-lab",
    "gameos-community",
    "lab-contracts",
    "lab-simulation",
    "lab-organization",
    "lab-learning",
    "community",
    "arena-integration",
    "arena-integration-runtime",
    "platform-contracts",
    "game-contracts",
    "package-system",
    "package-registry",
    "runtime-contracts",
    "runtime-core",
    "capability-broker",
    "tool-fabric-runtime",
    "avatar-runtime",
  ],
  provides: ["gameos-product-shell"],
  publicEntrypoints: ["src/index.ts"],
} as const;
