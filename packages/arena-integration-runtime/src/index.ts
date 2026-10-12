/**
 * @playliquid/arena-integration-runtime — public surface (PL-031).
 *
 * The Arena runtime: the component that EXECUTES decided capability-gap
 * escalations through @playliquid/arena-integration's typed provider-neutral
 * contract layer (architecture.md §Arena + §Capability gaps; R18; lock rules
 * 6/32):
 *
 * - INTAKE of DECIDED escalations (never auto-escalated): the host's
 *   content-addressed decision record verifies, the cited source (a
 *   lab-organization gap finding with its walked lab-contracts record, a
 *   lab-contracts gap record, or a lab-learning rung-classified summary)
 *   resolves and passes the rung gate, and the request resolves into an
 *   arena-integration envelope — typed kebab-case refusals, total, never
 *   throws;
 * - ORCHESTRATION (E6): content-addressed, tenant-scoped (R20), resumable
 *   escalation cases driving arena-integration's own draft→…→
 *   ingested|rejected|expired machine through the ArenaTransport port (the
 *   deterministic in-memory fake in-repo; real providers are host-side,
 *   E11), with the send/ingest receipt ledgers this runtime owns;
 * - INGESTION-ONLY responses: validated envelopes flow through
 *   arena-integration's ingestion verdicts into passive evidence packages,
 *   provenance-marked arena-external, labeled with their epistemic class
 *   (external validated result / external estimate / external authorized
 *   artifact; E11). No type, port or function here can mutate live
 *   PlayLiquid state from an Arena response (structurally negative-tested);
 * - the PENDING PL-007 ACR seam is bridged from this package:
 *   ArenaEscalationRequest = lab-contracts' ArenaEscalationRef &
 *   arena-integration's ArenaRequestEnvelope, pinned by a coherence oracle
 *   (escalation-request.ts). packages/arena-integration itself is untouched.
 *
 * Module map:
 * - primitives.ts          case/source id brands + frozen refusal vocabularies
 * - digest.ts              content-addressed identity + tamper oracles
 * - escalation-request.ts  the ACR bridge (Lab-side escalation request record)
 * - records.ts             sources, the decided command, the case record
 * - intake.ts              the admission oracle (registration + case opening)
 * - epistemic.ts           the E11 labeling fold
 * - drive.ts               the pure orchestration steps (lifecycle folds)
 * - ports.ts               injected ports (clock, store, policy, transport)
 * - service-types.ts       service door types
 * - service.ts             ArenaRuntimeService — the state owner (R20 scoping)
 * - fakes.ts               deterministic in-memory fakes + the journey stack
 * - harness.ts             runtime evidence harness (node src/harness.ts)
 */

// Primitives — id brands + frozen refusal vocabularies
export {
  ARENA_CASE_REFUSAL_CODES,
  ARENA_ESCALATION_SOURCE_KINDS,
  ARENA_INTAKE_REFUSAL_CODES,
  asArenaCaseId,
  asArenaSourceKey,
  isArenaEscalationSourceKind,
} from "./primitives.ts";
export type {
  ArenaCaseId,
  ArenaCaseRefusalCode,
  ArenaEscalationSourceKind,
  ArenaIntakeRefusalCode,
  ArenaSourceKey,
  SourceRegistrationRefusalCode,
} from "./primitives.ts";

// Digest — content-addressed identity + tamper oracles
export {
  arenaAuditRecordDigestOf,
  arenaCaseDigestOf,
  arenaCaseIdOf,
  arenaCaseKeyDigestOf,
  arenaDecisionDigestOf,
  arenaDigestOf,
  arenaDocumentDigestOf,
  arenaEscalationHandleOf,
  arenaResponseDigestMatches,
  arenaResponseDigestOf,
  arenaSourceDigestOf,
  arenaSourceKeyOf,
  contentDigestOf,
  jsonSafeOf,
  runtimeDigestOf,
} from "./digest.ts";
export type { ArenaCaseIdentityContent, ArenaCaseKeyContent } from "./digest.ts";

// The ACR bridge — the Lab-side escalation request record
export {
  arenaRequestEnvelopeOf,
  bridgeArenaEscalationRequest,
  checkArenaEscalationRequestCoherence,
} from "./escalation-request.ts";
export type {
  ArenaEscalationRequest,
  ArenaEscalationRequestCoherence,
  ArenaEscalationRequestIncoherenceReason,
  ArenaRequestEnvelopeInput,
} from "./escalation-request.ts";

// Records — sources, the decided command, the case
export { ARENA_ESCALATION_CASE_KIND } from "./records.ts";
export type {
  ArenaEscalationCase,
  ArenaEscalationCaseKind,
  ArenaEscalationCommand,
  ArenaIntakeResult,
  EscalationSourceSubmission,
  GapSummarySource,
  RegisteredEscalationSource,
  SourceRegistrationResult,
} from "./records.ts";

// Intake — the admission oracle
export {
  arenaRungGateOfSource,
  gapSummaryDigestOfSource,
  openArenaEscalationCase,
  registerEscalationSource,
} from "./intake.ts";
export type { ArenaIntakeKnownState } from "./intake.ts";

// Epistemic — the E11 labeling fold
export {
  ARENA_EXTERNAL_CLASSES,
  asArenaEstimate,
  isArenaEstimate,
  isArenaExternalClass,
  isArenaLabeledPayload,
  labelArenaEvidencePackage,
} from "./epistemic.ts";
export type { ArenaExternalClass, ArenaLabeledPayload, ArenaProvenance } from "./epistemic.ts";

// Drive — the pure orchestration steps
export { isTerminalArenaState } from "./drive.ts";

// Ports — the host seams
export type {
  ArenaRuntimeCaller,
  ArenaRuntimeClockPort,
  ArenaRuntimeDocument,
  ArenaRuntimePorts,
  ArenaRuntimeStore,
} from "./ports.ts";

// Service — the state owner
export { ArenaRuntimeService } from "./service.ts";
export type { ArenaRuntimeServiceOptions } from "./service.ts";
export type {
  CaseReadResult,
  DriveCaseOutcome,
  DriveCaseResult,
  LabeledEvidenceResult,
  OpenCaseDoorResult,
  RegisterSourceDoorResult,
  RestoreDoorResult,
} from "./service-types.ts";

// Fakes — deterministic in-memory doubles + the journey stack
export {
  createArenaRuntimeJourney,
  createArenaRuntimeStore,
  createFakeArena,
  createSteppingClock,
  fakeArenaEndpoint,
  fakeArenaResponseTo,
  fixtureAskDigest,
  fixtureEscalationId,
  fixtureGapFinding,
  fixtureGapSummary,
  fixtureWalkedGapRecord,
} from "./fakes.ts";
export type { ArenaRuntimeJourney } from "./fakes.ts";
