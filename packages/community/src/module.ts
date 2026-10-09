/**
 * community module manifest (PL-010 governance format).
 *
 * Dependency declaration mirrors the work-order dependency list
 * (PL-032 depends on PL-012 git-lineage and PL-004 platform-contracts)
 * plus the design-intent matrix row `community | Product | git-lineage,
 * game-ir` and the typed transitive vocabulary of git-lineage's node
 * coordinates (package-system: PackageCoordinate, computeDigest). Only
 * src/index.ts is exposed publicly.
 */
export const communityModule = {
  id: "community",
  requires: ["git-lineage", "game-ir", "platform-contracts", "package-system"],
  provides: ["community"],
  publicEntrypoints: ["src/index.ts"],
} as const;
