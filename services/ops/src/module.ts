/**
 * services/ops module manifest (PL-044 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * operations tree imports (the qa/browser precedent: services/ops is not
 * a pnpm workspace root, so sibling packages are imported by relative
 * path through their src/index.ts public entrypoints ONLY, and no
 * package.json/workspace importer exists here — the TL owns that
 * surface). The ops service drives:
 *
 * - platform-contracts: the tenancy/isolation oracles (checkTenantIsolation,
 *   the SubjectId/TenantId vocabulary);
 * - package-system: the canonical-JSON serialization authority + the
 *   sealed package-record digest oracle (canary verification) + the
 *   record fixtures' sealing;
 * - package-registry: the registry coordinate read seam (the
 *   package-registry health gate + deployment artifact lookups);
 * - build-contracts: the ToolOperationId vocabulary (the
 *   build-orchestrator gate's fake tool-fabric operations);
 * - build-orchestrator: the staged-build snapshot verification door (the
 *   build-orchestrator health gate);
 * - security-gameos: the REAL rights authority (the rights-authority
 *   health gate) and the R20 role/capability vocabularies;
 * - platform-economy: the REAL economy service snapshot door (the
 *   platform-economy health gate);
 * - platform-integrity: the REAL integrity standing door (the
 *   platform-integrity health gate).
 *
 * NOTE (deliberate, E11-honest): game-ui / gameos-lab / gameos-community
 * are NOT imported here. Their public entrypoints re-export .tsx
 * components plain `node --test` cannot load (the PL-043 finding), and
 * the web host composition is specified as DATA + TYPED WIRING — the
 * mount-contract vocabulary mirrors their documented public ports/stores/
 * fixtures, while the executable proof of the REAL stores lives in the
 * qa/browser journey suite.
 */
export const servicesOpsModule = {
  id: "services-ops",
  requires: [
    "build-contracts",
    "build-orchestrator",
    "package-registry",
    "package-system",
    "platform-contracts",
    "platform-economy",
    "platform-integrity",
    "security-gameos",
  ],
  provides: ["services-ops"],
  publicEntrypoints: ["src/index.ts"],
} as const;
