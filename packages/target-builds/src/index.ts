/**
 * @playliquid/target-builds — public surface (PL-036).
 *
 * The multi-target build surface over the merged build family: typed
 * target-set resolution against the four engine adapters' bindings
 * (PL-021..PL-024), a durable content-addressed fan-out plan driving ONE
 * build-orchestrator document PER TARGET (PL-020), and the typed
 * aggregation into one multi-target build record with provenance +
 * verification evidence (R19), CAS-shaped content digests (E7), resume
 * semantics (E6), determinism (E9) and tenant isolation (R20).
 *
 * Module map:
 * - request.ts       the typed multi-target build request + validation + content fingerprint
 * - catalog.ts       the engine binding catalog over the four merged adapters
 * - profiles.ts      the target profile source port + bundle verification
 * - resolution.ts    total per-target binding / typed refusal adjudication
 * - plan.ts          the durable fan-out plan + per-target request commands
 * - outcomes.ts      per-target results, outcome views, durable outcomes, verdicts
 * - evidence.ts      R19 provenance + verification evidence aggregation
 * - record.ts        the multi-target build record (content-addressed)
 * - ports.ts         service options + the keyed fan-out store seam (E6)
 * - driver.ts        the per-target staged-build driver
 * - service.ts       the service (doors, state ownership, reads, resume, restore)
 * - fakes.ts         in-memory test doubles (clearly labeled; never production)
 * - fixtures.ts      test/harness fixtures (NOT exported from this barrel)
 *
 * Purity: the domain has no IO, no timers, no globals; every effect lives
 * behind a port. The service instance is the single mutable-state owner.
 */

// Tenancy vocabulary (R20) — re-exported from the build-family authority.
export { asTenantId, isTenantId } from "@playliquid/build-orchestrator";
export type { TenantId } from "@playliquid/build-orchestrator";

// The typed multi-target build request
export type {
  MultiTargetPins,
  MultiTargetBuildRequest,
  RequestViolationCode,
  RequestViolation,
  RequestValidation,
  PerTargetBuildRequest,
} from "./request.ts";
export {
  validateMultiTargetBuildRequest,
  canonicalTargets,
  computeMultiTargetRequestFingerprint,
  multiTargetEncounterKey,
  perTargetNonce,
} from "./request.ts";

// The engine binding catalog over the four merged adapters
export type { EngineCatalogEntry, EngineCatalog, EngineServeVerdict } from "./catalog.ts";
export { createDefaultEngineCatalog, catalogEngineIds } from "./catalog.ts";

// Target profile source + verification
export type { TargetProfileBundle, TargetProfilePort, ProfileRefusalCode, ProfileVerification } from "./profiles.ts";
export { verifyProfileBundle } from "./profiles.ts";

// Target-set resolution (total; typed refusals)
export type {
  TargetRefusalCode,
  TargetRefusal,
  TargetBinding,
  TargetSetResolution,
} from "./resolution.ts";
export { resolveTargetSet } from "./resolution.ts";

// The durable fan-out plan
export type { FanoutPlanEntry, MultiTargetFanoutPlan } from "./plan.ts";
export { buildTargetRequestCommand, computeFanoutPlan, planTargetKey } from "./plan.ts";

// Per-target outcomes
export type {
  TargetStageDigest,
  TargetBuildResult,
  TargetOutcome,
  DurableTargetOutcome,
  MultiTargetVerdict,
} from "./outcomes.ts";
export { outcomeOfResult, computeVerdict, skipOutcomeOf } from "./outcomes.ts";

// R19 evidence aggregation
export type {
  TargetSourcePins,
  TargetProvenanceEvidence,
  TargetVerificationEvidence,
} from "./evidence.ts";
export { aggregateProvenance, aggregateVerification, evidenceListDigest, sourcePinsOf } from "./evidence.ts";

// The multi-target build record
export type { MultiTargetBuildRecord } from "./record.ts";
export {
  computeRecordDigest,
  sealMultiTargetRecord,
  verifyMultiTargetRecord,
  canonicalRecordForm,
  documentDigestMapping,
  mintRecordId,
} from "./record.ts";

// Ports + the service + the state document/snapshot (E6)
export type { FanoutStorePort, MultiTargetBuildServiceOptions } from "./ports.ts";
export type {
  RecordedRequestEncounter,
  MultiTargetBuildsDocument,
  MultiTargetBuildsSnapshot,
  MultiTargetSnapshotRefusalCode,
} from "./snapshot.ts";
export { snapshotOfDocument, verifyMultiTargetSnapshot, isMultiTargetDocument } from "./snapshot.ts";
export type {
  MultiTargetExecutionRefusal,
  MultiTargetExecutionResult,
  MultiTargetRestoreResult,
} from "./service.ts";
export { MultiTargetBuildService } from "./service.ts";

// Test doubles (clearly labeled; never production — E11)
export type { MemoryFanoutStores, MemoryProfileSource } from "./fakes.ts";
export { createMemoryFanoutStores, createMemoryProfileSource } from "./fakes.ts";
