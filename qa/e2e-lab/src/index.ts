/**
 * qa/e2e-lab PUBLIC ENTRYPOINT (PL-040) — the adversarial Lab/Arena/Community
 * end-to-end suite.
 *
 * Journey-scale NEGATIVE + determinism battery over the SAME public surfaces
 * as examples/lab-journey but under a DIFFERENTLY-seeded hostile world (the
 * qa/browser precedent: different tenant, seeds, evidence ledger and ladder
 * route, so a shared fixture bug can never pass both suites at once): the
 * hostile journey walk itself (Lab gap ladder → Arena adjudication →
 * Community curation, E9 run-twice identical) plus the attack files — forged
 * escalations, tampered evidence ledgers, cross-tenant moves (R20) and
 * ladder guardrails (R18) — every refusal asserted with its typed code
 * VERBATIM (E8) and every replay surfacing its first receipt (E10).
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// Module manifest (PL-010 governance format)
export { qaE2eLabModule } from "./module.ts";

// The frozen hostile identity + seed vocabulary (E9)
export * from "./ids.ts";

// The append-only hash-chained journal + the content-addressed run seal (E10/E9)
export { createHostileJournal, sealHostileRun, verifyHostileChain } from "./hostile-journal.ts";
export type { HostileJournal, HostileJournalEntry, HostileRunSeal } from "./hostile-journal.ts";

// The shared assertion helpers (verbatim refusal codes + first receipts)
export { assertDuplicateWith, assertRefusedWith, factsOf, mutableEntriesOf, structuralCopyOf } from "./adversary-kit.ts";
export type { DuplicateShape, MutableJournalEntry, RefusedShape } from "./adversary-kit.ts";

// The typed hostile command port vocabulary (caller-carrying intents)
export { gapDoorCodes, narrowDoorCode, rungAttemptOf, searchOpenCodes } from "./hostile-port.ts";
export type { HostileCommandIntent, HostileCommandReceipt, HostileCommandRefusalCode } from "./hostile-port.ts";

// The hostile phase rigs (the real engines + ports, differently seeded)
export { createHostileWorld } from "./hostile-rig.ts";
export type { HostileCycleOutcome, HostileWorldRig } from "./hostile-rig.ts";
export { HOSTILE_ARENA_POLICY_ID, createHostileArena, hostileAskDigestOf, hostileEscalationRefOf } from "./hostile-arena.ts";
export type { HostileArenaRig } from "./hostile-arena.ts";
export { createHostileCommunity, createHostileGapDirectory, hostileGapLinkOf } from "./hostile-community.ts";
export type { HostileCommunityRig, HostileOutcomeFacts } from "./hostile-community.ts";

// The hostile journey itself (the adversarial thesis walk)
export { runHostileJourney } from "./hostile-journey.ts";
export type { HostileJourneyFacts, HostileJourneyRun } from "./hostile-journey.ts";
