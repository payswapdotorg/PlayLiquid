/**
 * @playliquid/platform-multiplayer — public surface (PL-016).
 *
 * The multiplayer AUTHORITY service: the server-side binding of platform
 * multiplayer policy (`@playliquid/platform-contracts`) with the runtime
 * session authority machinery (`@playliquid/runtime-contracts`), per
 * spec/module-dependency-matrix.md row
 * `multiplayer | Platform | platform-contracts, runtime-contracts`.
 *
 * Module map:
 * - digest.ts      pure SHA-256 + byte-stable canonical JSON (E9)
 * - topology.ts    frozen topology enum, per-topology rules, policy binding
 * - ports.ts       simulator seam, transport, store, clock, scheduler ports
 * - intents.ts     typed intent admission (schema + policy + consistency)
 * - admission.ts   platform session admission binding (decideAdmission)
 * - outcomes.ts    protected-outcome enforcement + authority outcome build
 * - snapshot.ts    byte-stable snapshot documents + replay boundaries
 * - kernel.ts      the authority session kernel (the mutable-state owner)
 * - fakes.ts       deterministic in-memory fakes for tests/harness
 *
 * Purity: the domain has no IO, no network, no timers; every effect lives
 * behind a port. The kernel instance is the single mutable-state owner.
 */

// Values
export { canonicalJson, sha256Hex, digestOf } from "./digest.ts";
export {
  MULTIPLAYER_TOPOLOGIES,
  TOPOLOGY_RULES,
  isMultiplayerTopology,
  topologyRules,
  kernelTopologyFromServicePolicy,
  resolveMultiplayerConfiguration,
} from "./topology.ts";
export {
  intentKindsAligned,
  validateIntentSubmission,
  deriveCommandAdmissionPolicy,
  planIntentAdmission,
} from "./intents.ts";
export {
  bridgeMatchSessionId,
  deriveAdmissionFacts,
  adjudicateParticipantAdmission,
} from "./admission.ts";
export {
  refuseRuntimeClaim,
  refusePlatformClaim,
  buildAuthoritativeOutcome,
  computeAuthorityOutcome,
} from "./outcomes.ts";
export {
  encodeSnapshotDocument,
  decodeSnapshotDocument,
  documentStateDigest,
  documentSnapshotId,
  boundaryRecord,
  documentSubjects,
} from "./snapshot.ts";
export {
  buildSessionDocument,
  adoptSessionDocument,
  rebuildSnapshotRegistry,
  snapshotIdOfDocument,
} from "./document.ts";
export { admitEffect } from "./effects.ts";
export { AuthoritySessionKernel } from "./kernel.ts";
export {
  FAKE_EVENT_KINDS,
  FAKE_PROTECTED_GRANT_KINDS,
  createFakeGamePolicy,
  createFakeIntentSchemas,
  createFakeIntentRules,
  createFakeSimulator,
  createRecordingTransport,
  createMemorySessionStore,
  createFixedClock,
  createRecordingScheduler,
} from "./fakes.ts";

// Types — topology
export type {
  MultiplayerTopology,
  CommandOriginKind,
  TopologyAdmissionRules,
  MultiplayerSessionConfiguration,
  ConfigurationRefusalCode,
  ConfigurationResolution,
} from "./topology.ts";
// Types — ports
export type {
  ParticipantView,
  AdmittedIntent,
  SimulationBootstrapInput,
  SimulationStepInput,
  SimulationStepResult,
  SimulationEffect,
  StandingProposal,
  SimulationFinalInput,
  SimulationFinalResult,
  AuthoritySimulator,
  TransportDelivery,
  MultiplayerTransport,
  StoredSnapshotRecord,
  SessionStore,
  AuthorityClock,
  NextTickDue,
  TickSchedulerPort,
} from "./ports.ts";
// Types — intents
export type {
  IntentSchema,
  IntentAdmissionRule,
  IntentSubmission,
  IntentValidationFailure,
  IntentValidation,
  IntentAdmissionPlanInput,
  IntentAdmissionPlan,
} from "./intents.ts";
// Types — admission
export type {
  ParticipantRefusalCode,
  ParticipantAdmissionResult,
  AdmissionFactsInput,
} from "./admission.ts";
// Types — outcomes
export type {
  ClientClaimRefusalCore,
  ClientClaimRefusal,
  OutcomeBuildInput,
  OutcomeBuildResult,
  OutcomeDecisionComputeInput,
  OutcomeComputation,
} from "./outcomes.ts";
// Types — snapshot
export type {
  RefusalRecord,
  PendingCommandView,
  ParticipantSnapshotView,
  SnapshotBoundaryView,
  AuthoritySnapshotDocument,
  SnapshotDecodeResult,
} from "./snapshot.ts";
// Types — kernel
export type {
  AuthoritySessionKernelOptions,
  AuthoritySessionState,
  PendingCommand,
  OpenResult,
  IntentSubmitResult,
  TickResult,
  OutcomeDecisionResult,
  SnapshotResult,
  RestoreResult,
  TerminateResult,
  ReplayResult,
  ClientClaimResult,
} from "./kernel-types.ts";
// Types — document + effects
export type {
  DocumentMeta,
} from "./document.ts";
export type {
  EffectAdmissionContext,
  EffectGrant,
  EffectAdmission,
} from "./effects.ts";
// Types — fakes
export type {
  FakeMovePayload,
  FakeFirePayload,
  FakeScorePayload,
  FakeAuthorityState,
} from "./fakes.ts";
