/**
 * @playliquid/community — public surface (PL-032).
 *
 * The community contribution service: typed contribution records over
 * the architecture's §Community vocabulary, provenance chains that
 * REFERENCE the platform-identity subject vocabulary, git-lineage
 * origin nodes and package-system content digests (never re-implement
 * them), the frozen contribution state machine
 * submitted -> triaged -> under-review -> accepted/rejected/withdrawn
 * with authority-stamped append-only history (E10) and content-addressed
 * idempotency receipts, the R18 typed capability-gap link through a
 * read-only Lab seam, and the E8 trust model: third-party contributions
 * are untrusted until qualified at accept.
 *
 * Module map:
 * - records.ts    kinds, state machine, provenance + gap-link vocabulary
 * - history.ts    content-addressed ids, append-only transition records
 * - admission.ts  the pure submission + workflow/qualification oracles
 * - ports.ts      store, clock, subject/gap/registry seams, snapshot codec
 * - snapshot.ts   pure document build + deep validation
 * - service.ts    the community service (the mutable-state owner)
 * - fakes.ts      deterministic in-memory fakes for tests/harness
 *
 * Purity: the domain has no IO, no timers, no globals; every effect
 * lives behind a port. The service instance is the single
 * mutable-state owner.
 */

// Values — records
export {
  CONTRIBUTION_KINDS,
  CONTRIBUTION_STATUSES,
  CONTRIBUTION_TRANSITIONS,
  TRANSITION_COMMANDS,
  COMMAND_FROM_STATES,
  REFERENCE_ID_PATTERN,
  MAX_REASON_LENGTH,
  MODEL_USAGE_KINDS,
  isContributionKind,
  isContributionStatus,
  canTransitionContribution,
  isTerminalContributionStatus,
  isTransitionCommandKind,
  asGapId,
  asCycleId,
  isCapabilityGapLink,
  asContributionId,
  isContributionOrigin,
  isModelProvenanceEntry,
  isContributionProvenanceInput,
  isContributionProvenance,
  isContributionRecord,
} from "./records.ts";
// Values — history
export {
  contributionIdOf,
  submissionIdentityOf,
  transitionCommandKeyOf,
  transitionRecordIdOf,
  submissionTransitionOf,
  isContributionTransitionRecord,
} from "./history.ts";
// Values — admission
export {
  adjudicateSubmission,
  adjudicateTransition,
  lineageBaseOf,
} from "./admission.ts";
// Values — ports + snapshot
export {
  isCommunityStateDocument,
  encodeSnapshotDocument,
  decodeSnapshotDocument,
} from "./ports.ts";
export { buildCommunityDocument, validateCommunityDocument, cloneContribution } from "./snapshot.ts";
// Values — service
export { CommunityService } from "./service.ts";
// Values — fakes
export {
  createMemoryCommunityStore,
  createFixedClock,
  createMemorySubjectDirectory,
  createMemoryGapDirectory,
  createMemoryPackageRegistry,
  fakePackageCoordinate,
  fakeLineageNode,
  fakeGapLink,
  fakePayload,
  ids,
  at,
} from "./fakes.ts";

// Types — records
export type {
  ContributionKind,
  ContributionStatus,
  TransitionCommandKind,
  GapId,
  CycleId,
  CapabilityGapLink,
  ContributionId,
  ContributionOrigin,
  ContributionProvenanceInput,
  ContributionProvenance,
  ContributionRecord,
} from "./records.ts";
// Types — history
export type {
  SubmissionIdentity,
  TransitionRecordContent,
  ContributionTransitionRecord,
  ContributionRow,
  TransitionRow,
} from "./history.ts";
// Types — admission
export type {
  SubmitContributionCommand,
  CommunityServicePolicy,
  ContributionRefusalCode,
  SubmissionFacts,
  GapSeamFacts,
  SubmissionAdmission,
  TransitionCommand,
  LineageBaseQualification,
  TransitionFacts,
  TransitionAdmission,
  TransitionRefusalCode,
} from "./admission.ts";
// Types — ports
export type {
  CommunityStateDocument,
  StoredCommunitySnapshot,
  CommunityStore,
  ServiceClock,
  SubjectDirectory,
  GapDirectory,
  PackageQualification,
  PackageRegistrySeam,
} from "./ports.ts";
// Types — snapshot
export type { CommunityStateDocument as CommunityDocument, StateProjection, ValidatedState } from "./snapshot.ts";
// Types — service
export type {
  CommunityServiceOptions,
  SubmitResult,
  TransitionResult,
  SnapshotOutcome,
} from "./service.ts";
