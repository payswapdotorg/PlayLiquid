/**
 * THE LAB/ARENA/COMMUNITY REFERENCE JOURNEY — the public entrypoint of
 * examples/lab-journey (PL-040; the fourth reference proof after
 * native-game, engine-integration and large-world).
 *
 * The demonstration that the product thesis closes END TO END over REAL
 * public surfaces only: the Lab discovers a capability gap and walks its
 * ladder one rung at a time → the Arena adjudicates a DECIDED escalation of
 * that gap to an ingested, epistemically-labeled evidence package → the
 * Community curates the Arena outcome as an accepted, provenance-carrying
 * contribution linked back to the gap. Every step lands in an append-only
 * hash-chained journal (E10) and the run seals a content-addressed journey
 * document (E9: run twice, identical journal + digests). This barrel is the
 * example's module surface (src/module.ts declares it; src/contract.ts is
 * the PL-010 governance re-export).
 */

// Module manifest (PL-010 governance format)
export { labJourneyModule } from "./module.ts";

// The frozen identity + seed vocabulary (E9)
export * from "./ids.ts";

// The append-only journal + the content-addressed journey document (E10/E9)
export { createJourneyJournal, sealJourneyDocument } from "./journal.ts";
export type { JourneyJournal, JourneyJournalEntry, JourneyDocument } from "./journal.ts";

// The three phases (the real surfaces each walks)
export { createJourneyLab, initialSearchIntent } from "./lab-phase.ts";
export type { LabPhaseRig, LabCommandIntent, LabCommandReceipt, LabCommandRefusalCode, LabLoopOutcome } from "./lab-phase.ts";
export { arenaCallerOf, arenaEscalationRefOf, askDigestOf, createJourneyArena, JOURNEY_ARENA_POLICY_ID } from "./arena-phase.ts";
export type { ArenaPhaseRig } from "./arena-phase.ts";
export { createJourneyCommunity, createLabGapDirectory, provenanceFactsOf, trailOf } from "./community-phase.ts";
export type { ArenaOutcomeFacts, CommunityPhaseRig } from "./community-phase.ts";

// The canonical journey itself
export { runCanonicalLabArenaJourney } from "./journey.ts";
export type { CanonicalJourneyFacts, CanonicalJourneyRun } from "./journey.ts";
