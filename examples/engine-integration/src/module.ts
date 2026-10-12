/**
 * engine-integration module manifest (PL-038 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * example imports (the native-game precedent: examples/ is not a pnpm
 * workspace root, so sibling packages are imported by relative path
 * through their public entrypoints, and no package.json/workspace
 * importer exists here — the TL owns that surface). Exactly as imported:
 *
 * - tool-blender: the asset-authoring tool adapter + its deterministic
 *   fake bridge/clock (PL-025);
 * - engine-unreal / engine-unity / engine-godot: the three engine
 *   adapters — unreal drives the staged build's engine operations, all
 *   three typed bindings adjudicate the target profiles (PL-022/023/024);
 * - tool-fabric-runtime: the registration HOST — the real registry,
 *   invocation pipeline, shape catalog and content-addressed exchange
 *   every tool call flows through (PL-019);
 * - engine-adapter-contract: the neutral Adapter seam type the rig
 *   registers against;
 * - tool-fabric: the tool identity / surface version / input-issue
 *   vocabulary the registrations and shape validators use;
 * - build-orchestrator: the staged-build pipeline the workflow drives
 *   (PL-020), incl. its registry-adapter and the ToolFabricPort seam;
 * - build-contracts: the build input vocabulary (the five typed inputs);
 * - target-profiles: the frozen target taxonomy + the sealed profile
 *   record authority;
 * - package-system + package-registry + artifact-store: the digest/CAS
 *   authority, the registry authority with the R19 release gate, and the
 *   CAS-backed artifact store (PL-011);
 * - platform-contracts: the tenant id vocabulary (R20);
 * - runtime-contracts: the target-profile id / digest primitives;
 * - game-ir + game-contracts: the GameIR document vocabulary the game
 *   composition is authored in (§Game model).
 *
 * Only src/index.ts is exposed publicly.
 */
export const engineIntegrationModule = {
  id: "engine-integration",
  requires: [
    "artifact-store",
    "build-contracts",
    "build-orchestrator",
    "engine-adapter-contract",
    "engine-godot",
    "engine-unity",
    "engine-unreal",
    "game-contracts",
    "game-ir",
    "package-registry",
    "package-system",
    "platform-contracts",
    "runtime-contracts",
    "target-profiles",
    "tool-blender",
    "tool-fabric",
    "tool-fabric-runtime",
  ],
  provides: ["engine-integration"],
  publicEntrypoints: ["src/index.ts"],
} as const;
