/**
 * @playliquid/platform-social — public surface (PL-015).
 *
 * The social graph service: follow/block relations, tenant-scoped
 * queries, block-beats-follow safety, event-sourced admission over
 * `@playliquid/platform-contracts` with game-ir canonical event
 * evidence, per spec/module-dependency-matrix.md row
 * `social | Platform | platform-contracts, game-ir`.
 *
 * Module map:
 * - digest.ts     pure SHA-256 + byte-stable canonical JSON (E9)
 * - history.ts     append-only change records + game-ir evidence digests
 * - relations.ts   follow/block edges, graph views, friend cohorts
 * - admission.ts   the pure command oracle (binds adjudicateSocialAction)
 * - ports.ts       store, clock, subject directory, grant directory ports
 * - service.ts     the social service (the mutable-state owner)
 * - fakes.ts       deterministic in-memory fakes for tests/harness
 *
 * Purity: the domain has no IO, no timers, no globals; every effect
 * lives behind a port. The service instance is the single
 * mutable-state owner.
 */

// Values
export { canonicalJson, sha256Hex, digestOf } from "./digest.ts";
export {
  evidenceDigestOf,
  evidenceRecord,
  changeRecordId,
} from "./history.ts";
export {
  edgeKey,
  deriveGraphView,
  friendCohortOf,
  isFollowing,
  isBlocking,
} from "./relations.ts";
export { adjudicateSocialGraphCommand } from "./admission.ts";
export { SocialService } from "./service.ts";
export { isSocialStateDocument } from "./ports.ts";
export {
  FAKE_SOCIAL_EVENT_KINDS,
  fakeBinding,
  createMemorySocialStore,
  createFixedClock,
  createMemorySubjectDirectory,
  createMemoryGrantDirectory,
  socialGrant,
} from "./fakes.ts";

// Types — history
export type {
  SocialEventEvidence,
  SocialRelationKind,
  SocialRelationChange,
  SocialRelationChangeRecord,
} from "./history.ts";
// Types — relations
export type { SocialEdge, SocialGraphView } from "./relations.ts";
// Types — admission
export type {
  SocialGraphCommandKind,
  SocialGraphCommand,
  SocialGraphFactsInput,
  SocialRefusalCode,
  SocialGraphAdmission,
} from "./admission.ts";
// Types — ports
export type {
  SocialEdgeRow,
  SocialStateDocument,
  StoredSocialSnapshot,
  SocialStore,
  ServiceClock,
  SubjectDirectory,
  GrantDirectory,
} from "./ports.ts";
// Types — service
export type {
  SocialServiceOptions,
  SocialSubmitResult,
  SocialSnapshotOutcome,
} from "./service.ts";
