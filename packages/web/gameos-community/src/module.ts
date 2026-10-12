/**
 * gameos-community module manifest (PL-034).
 *
 * The Community contribution UI: read-model projections of the
 * authoritative community package ONLY (E5 — the same discipline as the
 * game-ui and gameos-lab rows). The workspace sibling source is imported
 * through its public entrypoint by relative path (the packages/web/gameos
 * mount precedent, PL-033): the web package manifest and the TL-frozen
 * pnpm-lock stay untouched; the TL links the workspace importer at
 * promotion time.
 *
 * `requires` mirrors every module whose public source this package
 * imports: community (PL-032 — the contribution domain: kinds, state
 * machine, provenance chains, refusal vocabularies) plus
 * platform-contracts for the frozen TenantId/SubjectId tenancy
 * vocabulary (R20). The community module's own requires (git-lineage,
 * game-ir, package-system) cover the provenance vocabulary transitively.
 * React is a host-provided peer (the web app provides React — game-ui
 * precedent).
 */
export const gameos_communityModule = {
  id: "gameos-community",
  requires: ["community", "platform-contracts"],
  provides: ["gameos-community"],
  publicEntrypoints: ["src/index.ts"],
} as const;
