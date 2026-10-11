/**
 * @playliquid/build-orchestrator — public surface (PL-020).
 *
 * The build orchestration AUTHORITY service per spec/module-dependency-matrix.md
 * row `build-orchestrator | Build | build-contracts, tool-fabric-runtime`:
 * tenant-scoped build intake over build-contracts' admission oracle (E1),
 * the E10 orchestration pipeline — package-closure resolution with the R19
 * provenance/licensing gate, deterministic seeded planning (E9) and tool
 * stage execution through the Tool Fabric runtime seam — every transition
 * recorded as an append-only authority-stamped event, outputs validated
 * by build-contracts' composition validator and the console vendor-SDK
 * gate. Missing toolchains are truthful E11 limitations, never faked.
 *
 * Module map:
 * - tenancy.ts          tenant id vocabulary + tenant-scoped keys (R20)
 * - events.ts           the append-only event log vocabulary + corruption checks (E10)
 * - document.ts         build records, the state document, snapshots (E6)
 * - ports.ts            the effect seams: clock, store, source, fabric (E3)
 * - service-types.ts    the service door result shapes
 * - closure.ts          package-closure adjudication (R19 build gate)
 * - plan.ts             deterministic seeded build planning (E9)
 * - stages.ts           tool-stage execution over the fabric seam + output assembly
 * - intake.ts           the E1 admission engine (admitBuildRequest composition)
 * - service-arcs.ts     the E10 phase-arc engine (resolve/plan/tool/package)
 * - service.ts          the service (doors, state ownership, reads, restore)
 * - registry-adapter.ts BuildSourcePort over @playliquid/package-registry (PL-011)
 * - tool-fabric-adapter.ts ToolFabricPort over @playliquid/tool-fabric-runtime (PL-019)
 * - fakes.ts            in-memory test doubles (clearly labeled; never production)
 * - fixtures.ts         test/harness fixtures (NOT exported from this barrel)
 *
 * Purity: the domain has no IO, no timers, no globals; every effect lives
 * behind a port. The service instance is the single mutable-state owner.
 */

// Tenancy vocabulary (R20)
export type { TenantId } from "./tenancy.ts";
export { asTenantId, isTenantId, tenantEncounterKey } from "./tenancy.ts";

// Event log (E10)
export type {
  BuildEvent,
  BuildEventType,
  BuildEventSequence,
  BuildEventDetail,
  PhaseTransitionDetail,
  StageCompletedDetail,
  BuildFailedDetail,
  BuildSucceededDetail,
  LimitationRecordedDetail,
} from "./events.ts";
export {
  BUILD_ORCHESTRATOR_AUTHORITY,
  BUILD_EVENT_TYPES,
  isBuildEvent,
  findEventLogCorruption,
  nextSequence,
} from "./events.ts";

// State document + snapshots (E6)
export type {
  EnvironmentLimitation,
  BuildRecord,
  RecordedEncounter,
  BuildOrchestratorDocument,
  StoredBuildSnapshot,
  SnapshotRestoreRefusalCode,
  SnapshotRestoreRefusal,
  SnapshotVerification,
} from "./document.ts";
export { snapshotOf, isBuildOrchestratorDocument, verifySnapshot } from "./document.ts";

// Ports (E3)
export type {
  ServiceClock,
  BuildStore,
  ClosureResolution,
  BuildSourcePort,
  BuildToolCall,
  BuildToolResult,
  ToolEmittedArtifact,
  BuildToolOutput,
  ToolFabricPort,
} from "./ports.ts";

// Service doors
export type {
  BuildIntakeRefusalCode,
  BuildIntakeRefusal,
  BuildIntakeResult,
  DriveStepResult,
  DriveRefusalCode,
  DriveRefusal,
  DriveOptions,
  CancelResult,
  BuildStatusView,
  StatusRefusal,
  EventLogRefusal,
  EventLogView,
  BuildServiceRestoreResult,
  BuildOrchestratorServiceOptions,
} from "./service-types.ts";

// Closure adjudication (R19)
export type {
  BuildClosure,
  ClosureRefusalCode,
  ClosureRefusal,
  ClosureAdmission,
} from "./closure.ts";
export {
  adjudicateClosure,
  closureRecords,
  closureProvenance,
  closureModelProvenance,
} from "./closure.ts";

// Deterministic planning (E9)
export type { PlannedBuildStep, BuildPlan } from "./plan.ts";
export {
  OPERATION_STAGE_TABLE,
  stageForOperation,
  computeBuildPlan,
  planStepsForStage,
  planOperations,
} from "./plan.ts";

// Stage execution + output assembly
export type {
  StageFailure,
  ToolStageOutcome,
  ClosureProvenanceEvidence,
  PlannedStepSummary,
} from "./stages.ts";
export {
  runToolStage,
  parseToolOutput,
  isVerificationEvidenceRecord,
  hasAuthorizedVendorEvidence,
  assembleManifest,
  assembleOutputs,
  stepRecord,
  packageStageDigest,
  manifestDigestOf,
} from "./stages.ts";

// The service
export { BuildOrchestratorService } from "./service.ts";
export type { ArcHost } from "./service-arcs.ts";
export { advanceOneArc } from "./service-arcs.ts";
export { admitBuildToIntake } from "./intake.ts";
export type { BuildIntakeDeps } from "./intake.ts";

// Host adapters (production wiring over the merged authorities)
export type { RegistryBuildSourceOptions, LockSource, KnownContent } from "./registry-adapter.ts";
export { createRegistryBuildSource } from "./registry-adapter.ts";
export type { FabricToolBinding, ToolFabricAdapterOptions } from "./tool-fabric-adapter.ts";
export { createToolFabricAdapter } from "./tool-fabric-adapter.ts";

// Test doubles (clearly labeled; never production — E11)
export type { ManualClock, MemoryBuildStore, FakeBuildSourceOptions, ScriptedFailure, FakeToolFabric } from "./fakes.ts";
export {
  createManualClock,
  createMemoryBuildStore,
  createFakeBuildSource,
  createFakeToolFabric,
} from "./fakes.ts";
