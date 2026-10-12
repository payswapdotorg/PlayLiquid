/**
 * qa/e2e-lab module manifest (PL-040 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * adversarial suite imports (the qa/browser precedent: qa/ is not a pnpm
 * workspace root, so sibling packages are imported by relative path through
 * their public entrypoints, and no package.json/workspace importer exists
 * here — the TL owns that surface). The hostile walk + its negative battery
 * drive the REAL public surfaces of:
 *
 * - lab-contracts: the frozen Lab vocabulary — branded ids, evaluation
 *   seeds, the gap-ladder rungs/transitions and the ladder authority
 *   itself (appendGapRungAttempt, validateGapRecord) the guardrail
 *   negatives probe directly;
 * - lab-simulation: the REAL PL-028 evaluation engine + its deterministic
 *   fixture vocabulary (context, evidence, suite, observations, the
 *   calibrate oracle the tampered-evidence negatives attack);
 * - lab-organization: the REAL PL-029 compiler/search service doors the
 *   typed hostile command port forwards to (openSearch, nextCandidates,
 *   evaluateCandidate, advanceCapabilityGap, getCapabilityGap,
 *   listCapabilityGaps, listEvidence);
 * - lab-learning: the REAL PL-030 learning service + the real-engine
 *   journey stack (createLabLearningJourney) the hostile world wires, and
 *   the identity oracle (verifyLearningRecord) the tamper negatives probe;
 * - arena-integration: the provider-neutral contract layer — the
 *   authorization-scope builders, the Lab usage-rule policy port and the
 *   transport port the hostile Arena phase consumes;
 * - arena-integration-runtime: the REAL PL-031 Arena runtime service the
 *   forged-escalation negatives attack (intake, persisted-document
 *   tamper oracle, drive, labeled evidence) over its deterministic
 *   fakes (stepping clock, content-addressed store, fake Arena);
 * - community: the REAL PL-032 CommunityService the cross-tenant and
 *   hostile-journey phases drive, over its deterministic in-memory ports
 *   (subject directory, package-registry seam, memory store, fixed clock);
 * - platform-contracts: the frozen tenancy/id vocabulary (TenantId,
 *   SubjectId, asTenantId/asSubjectId);
 * - package-system: the single digest authority (computeDigest) that
 *   content-addresses the hostile journal + run seal (E5/E7/E9).
 *
 * Only src/index.ts is exposed publicly.
 */
export const qaE2eLabModule = {
  id: "qa-e2e-lab",
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
  provides: ["qa-e2e-lab"],
  publicEntrypoints: ["src/index.ts"],
} as const;
