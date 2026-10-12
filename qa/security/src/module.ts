/**
 * qa/security module manifest (PL-041 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * negative suite imports (the PL-033 packages/web/gameos mount precedent:
 * qa/ is not a pnpm workspace root, so sibling packages are imported by
 * relative path, and no package.json/workspace importer exists here —
 * the TL owns that surface). The suite adversarially drives the REAL
 * public surfaces of:
 *
 * - security-gameos (PL-041): the rights authority itself — the
 *   lattice, the admission gates, the settlement authorization, the
 *   integrity-derived standings, the escalation rights, the refusal
 *   ledger and the snapshot document (the system under test);
 * - platform-contracts: the frozen tenancy/id vocabulary and the
 *   FORBIDDEN_VERDICT_FIELDS certainty table the forged-marker
 *   negatives assert against;
 * - platform-integrity (PL-018): the REAL integrity service the
 *   verdict-edit negatives drive to issue a fresh standing.
 */
export const qaSecurityModule = {
  id: "qa-security",
  requires: [
    "platform-contracts",
    "platform-integrity",
    "security-gameos",
  ],
  provides: ["qa-security"],
  publicEntrypoints: ["src/index.ts"],
} as const;
