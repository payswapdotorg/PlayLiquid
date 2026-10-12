/**
 * gameos-lab module manifest (PL-034).
 *
 * The Lab workbench UI: read-model projections of the authoritative Lab
 * packages ONLY (E5 — the same discipline as the game-ui row). The
 * workspace sibling sources are imported through their public
 * entrypoints by relative path (the packages/web/gameos mount precedent,
 * PL-033): the web package manifest and the TL-frozen pnpm-lock stay
 * untouched; the TL links the workspace importer at promotion time.
 *
 * requires mirrors every module whose public source this package
 * imports: the Lab read models (lab-contracts, lab-simulation,
 * lab-organization, lab-learning, arena-integration,
 * arena-integration-runtime) plus platform-contracts for the frozen
 * TenantId/SubjectId tenancy vocabulary (R20). React is a host-provided
 * peer (the web app provides React — game-ui precedent).
 */
export const gameos_labModule = {
  id: "gameos-lab",
  requires: [
    "lab-contracts",
    "lab-simulation",
    "lab-organization",
    "lab-learning",
    "arena-integration",
    "arena-integration-runtime",
    "platform-contracts",
  ],
  provides: ["gameos-lab"],
  publicEntrypoints: ["src/index.ts"],
} as const;
