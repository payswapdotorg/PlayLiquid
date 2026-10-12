/**
 * lab-journey module manifest (PL-040 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * example imports (the PL-033 packages/web/gameos mount precedent +
 * the examples/native-game precedent: examples/ is not a pnpm workspace
 * root, so sibling packages are imported by relative path through their
 * public entrypoints, and no package.json/workspace importer exists here —
 * the TL owns that surface). The work-order dependency set (PL-028, 029,
 * 030, 031, 032) plus the transitive public contracts the walk actually
 * consumes, exactly as imported:
 *
 * - lab-contracts: the frozen Lab vocabulary — branded ids, evaluation
 *   seeds, the gap-ladder rungs and rung attempts, ArenaEscalationRef
 *   (the provider-neutral external reference, lock 32);
 * - lab-simulation: the REAL PL-028 evaluation engine + its deterministic
 *   fixture vocabulary (context, evidence, suite, observations);
 * - lab-organization: the REAL PL-029 compiler/search service doors the
 *   typed command port forwards to (openSearch, nextCandidates,
 *   evaluateCandidate, advanceCapabilityGap, getCapabilityGap,
 *   listCapabilityGaps, listEvidence);
 * - lab-learning: the REAL PL-030 learning service + the real-engine
 *   journey stack (createLabLearningJourney) the Lab phase wires;
 * - arena-integration: the provider-neutral contract layer — the
 *   authorization-scope builders, the Lab usage-rule policy port and the
 *   transport port the Arena phase consumes;
 * - arena-integration-runtime: the REAL PL-031 Arena runtime service +
 *   its deterministic fakes (stepping clock, content-addressed runtime
 *   store, fake Arena behind arena-integration's transport port) and the
 *   decision-digest oracle of the decided escalation command;
 * - community: the REAL PL-032 CommunityService + its deterministic
 *   in-memory ports (subject directory, package-registry seam, memory
 *   store, fixed clock, lineage-node/payload fixture builders);
 * - platform-contracts: the frozen tenancy/id vocabulary (TenantId,
 *   SubjectId, asTenantId/asSubjectId);
 * - package-system: the single digest authority (computeDigest) that
 *   content-addresses the journey journal + document (E5/E7).
 *
 * Only src/index.ts is exposed publicly.
 */
export const labJourneyModule = {
  id: "lab-journey",
  requires: [
    "arena-integration",
    "arena-integration-runtime",
    "community",
    "lab-contracts",
    "lab-learning",
    "lab-organization",
    "lab-simulation",
    "package-system",
    "platform-contracts",
  ],
  provides: ["lab-journey"],
  publicEntrypoints: ["src/index.ts"],
} as const;
