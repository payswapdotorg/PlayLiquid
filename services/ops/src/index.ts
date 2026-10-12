/**
 * services/ops PUBLIC ENTRYPOINT (PL-044) — the operations service tree.
 *
 * Three surfaces, one tree (R7 platform services, honest E11):
 *
 * 1. THE DURABLE WORKER RUNTIME (E6): a generic durable work queue over
 *    content-addressed work documents — enqueue/lease/heartbeat/
 *    complete/fail with typed refusals, crash-anywhere resume to the
 *    last durable state and EXACTLY-ONCE effects (durable at-least-once
 *    redelivery × key-idempotent execution — the
 *    arena-integration-runtime durability idiom generalized).
 * 2. THE HEALTH/READINESS SERVICE: typed UP/DOWN/DEGRADED dependency
 *    gates over REAL service doors (refusal codes verbatim, E8) +
 *    liveness as the worker journal's freshness (E10).
 * 3. THE WEB HOST COMPOSITION: the PL-033/034 mount contract realized as
 *    one typed host document — data + typed wiring only; no DOM, no
 *    rendering, no network (the qa/browser journeys prove the stores).
 *
 * There is NO real infrastructure here (E11): no processes, no network,
 * no containers, no secrets — in-process services over injected ports,
 * deterministic under injected clocks.
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// Module manifest (PL-010 governance format)
export { servicesOpsModule } from "./module.ts";

// Content-addressed identity helpers (the tree's digest seam, E9).
export {
  isDigestHex,
  isJsonSafe,
  jsonSafeOf,
  opsDigestOf,
  opsWebHostDigestOf,
  opsWorkIdOf,
  taggedDigestOf,
} from "./digest.ts";

// THE DURABLE WORKER RUNTIME (E6/E10).
export { DurableWorkerRuntime } from "./worker.ts";
export type { WorkSubmission } from "./worker.ts";
export {
  TERMINAL_WORK_STATES,
  isWorkState,
} from "./worker-ports.ts";
export type {
  CompleteResult,
  DurableWorkerOptions,
  DriveResult,
  EffectOutcome,
  EffectRecord,
  EnqueueResult,
  FailResult,
  HeartbeatResult,
  LeaseResult,
  OpsCaller,
  OpsWorkerCaller,
  OpsWorkerDocument,
  OpsWorkerPorts,
  WorkEffect,
  WorkRecord,
  WorkState,
  WorkerClockPort,
  WorkerDoorRefusalCode,
  WorkerEffectsPort,
  WorkerRestoreResult,
  WorkerStorePort,
} from "./worker-ports.ts";
export {
  JOURNAL_GENESIS_DIGEST,
  WORK_JOURNAL_ENTRY_KINDS,
  appendJournalEntry,
  isWorkJournalEntryKind,
  journalEntryOf,
  verifyWorkJournal,
} from "./work-journal.ts";
export type {
  JournalVerification,
  WorkJournalEntry,
  WorkJournalEntryKind,
  WorkJournalRefusalCode,
} from "./work-journal.ts";

// The lease fold (worker-lease.ts) + the layered restore verification
// (worker-restore.ts) — pure siblings of the runtime.
export {
  expiredLeaseRefusal,
  heldLeaseCheck,
  isWorkDueFor,
  leaseDueOf,
  leaseFor,
  renewedLease,
} from "./worker-lease.ts";
export type { HeldLeaseCheck, LeaseDue } from "./worker-lease.ts";
export { verifyRestorableDocument, workIdentityVerifies } from "./worker-restore.ts";
export type { RestoreVerification } from "./worker-restore.ts";

// THE HEALTH/READINESS SERVICE.
export { GATE_STATUSES, OPS_HEALTH_DOORS, OpsHealthService, gateResultOf, isOpsHealthDoor } from "./health.ts";
export type {
  GateResult,
  GateStatus,
  HealthGate,
  LivenessReport,
  OpsHealthDoorId,
  OpsHealthOptions,
  ReadinessReport,
} from "./health.ts";
export {
  bindArtifactCasGate,
  bindBuildOrchestratorGate,
  bindEconomyGate,
  bindIntegrityGate,
  bindRegistryGate,
  bindRightsAuthorityGate,
  bindWebHostGate,
  bindWorkerJournalGate,
} from "./health-bindings.ts";
export type {
  ArtifactFetchDoor,
  BuildSnapshotDoor,
  RegistryReadDoor,
} from "./health-bindings.ts";

// THE WEB HOST COMPOSITION (PL-033/034 mount contract as typed data).
export {
  WEB_HOST_DEMO_FIXTURES,
  WEB_HOST_TRUTH,
  WEB_HOST_WORKBENCHES,
  WORKBENCH_PORTS,
  WORKBENCH_STORE_FACTORIES,
  composeWebHost,
  isWebHostDemoFixture,
  isWebHostWorkbench,
  verifyWebHostDocument,
} from "./web-host.ts";
export type {
  HostMount,
  PortBinding,
  PortProvider,
  WebHostDemoFixture,
  WebHostDocument,
  WebHostEnvironmentTruth,
  WebHostRefusalCode,
  WebHostResult,
  WebHostWorkbench,
} from "./web-host.ts";

// TEST-SUPPORT doubles + fixtures (lock rule 44: clearly labeled, never
// production integrations — E11).
export {
  OPS_FIXTURE_COMMIT,
  crashAfterRealInvocations,
  crashOnInvocationAttempt,
  crashOnNthSave,
  createCountingEffects,
  createFixedClock,
  createMemoryWorkerStore,
  createSteppingClock,
  opsFixtureMetadata,
  sealOpsPackageRecord,
} from "./fixtures.ts";
