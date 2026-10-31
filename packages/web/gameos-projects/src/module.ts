/**
 * gameos-projects module manifest (PLX-UX-003 step 1).
 *
 * The World Projects workbench: read-model projections of the
 * authoritative project/world services ONLY (E5 — the same discipline as
 * the game-ui, gameos-lab and gameos-community rows). The workspace
 * sibling sources are imported through their public entrypoints by
 * relative path (the packages/web/gameos mount precedent, PL-033, and
 * the gameos-community sibling-source precedent, PL-034): the web
 * package manifest and the TL-frozen pnpm-lock stay untouched; the TL
 * links the workspace importer at promotion time.
 *
 * `requires` mirrors every module whose public source this package
 * imports: git-lineage (semantic change kinds and diffs — the semantic
 * PR change-kind summaries), package-system (package coordinates,
 * semver, content digests, the R19 release-gate vocabulary), community
 * (the frozen pull-request lifecycle: statuses, transition commands,
 * command/from-state tables, refusal codes — reused VERBATIM, never
 * forked), game-contracts (the ACR-001 world-kind read model and the
 * branch/commit git vocabulary) and platform-contracts for the frozen
 * TenantId/SubjectId tenancy vocabulary (R20). package-registry covers
 * the host-side registry read doors that source the composition pins
 * and gate verdicts (its own requires — artifact-store, package-system
 * — carry the transitive vocabulary). React is a host-provided peer
 * (the web app provides React — game-ui precedent).
 */
export const gameos_projectsModule = {
  id: "gameos-projects",
  requires: [
    "git-lineage",
    "package-system",
    "package-registry",
    "community",
    "game-contracts",
    "platform-contracts",
  ],
  provides: ["gameos-projects"],
  publicEntrypoints: ["src/index.ts"],
} as const;
