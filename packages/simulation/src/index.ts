/**
 * @playliquid/simulation — public surface (PL-014).
 *
 * The headless Simulation Runtime: a distinct execution path from the
 * Interactive Runtime that SHARES the Experience Protocol contracts
 * (architecture lock rule 12). Deterministic fixed-tick stepping over a
 * seeded RNG port; resettable, snapshot-able and replayable sessions with
 * byte-stable, content-addressed snapshots; partition-aware step planning
 * over the GameIR spatial types (a pure query layer — no threading); and
 * no wall-clock authority (injected clock/scheduler ports only).
 *
 * Module map:
 * - ports.ts          injected ports (RngPort, ClockPort, SnapshotStore,
 *                     PendingCommandQueue) + the flat snapshot artifact
 * - rng.ts            SplitMix32 seeded RNG (the RngPort fake) + fingerprints
 * - codec.ts          GameIRValue ⇄ JSON-safe codec + canonical snapshot bytes
 * - world.ts          WorldBlueprint / WorldState over GameIR values + digests
 * - kernel.ts         the deterministic tick executor + WorldSystem contract
 * - planning.ts       partition-aware step planning (uniform-grid; R15)
 * - log.ts            the session event log authority (E2/E10 bookkeeping)
 * - admission.ts      pure act-path helpers (idempotency, grants, decoding)
 * - session-types.ts  public typed results + the game binding description
 * - session.ts        SimulationSession — the Experience Protocol authority
 * - snapshot.ts       byte-stable snapshot payload build/verify/seal
 * - fakes.ts          in-memory port fakes (FixedClock, snapshot store, queue)
 * - demo.ts           the in-memory demo game binding used by tests/harness
 */

export type {
  RngState,
  RngPort,
  ClockPort,
  PendingCommand,
  PendingCommandQueue,
  SimulationSnapshot,
  SnapshotStore,
  SimulationSessionPorts,
} from "./ports.ts";
export { makeRng, restoreRng, rngFingerprint, rngRange, RNG_DRAW_SPACE } from "./rng.ts";
export {
  encodeGameIRValue,
  decodeGameIRValue,
  canonicalJsonString,
} from "./codec.ts";
export type { JsonSafe } from "./codec.ts";
export {
  entityKey,
  initialWorldState,
  worldStateDigest,
  entityStateOf,
  withEntityState,
  entityKeys,
  entityPosition,
} from "./world.ts";
export type { WorldEntityBlueprint, WorldBlueprint, WorldState } from "./world.ts";
export {
  runKernelTick,
  validateWorldSystems,
} from "./kernel.ts";
export type {
  SystemTickInput,
  SystemTickOutput,
  EmittedEvent,
  WorldSystem,
  KernelTickInput,
  KernelTickOutput,
} from "./kernel.ts";
export {
  resolveGridCell,
  planPartitions,
  extractEntityPlacements,
  estimateTickWork,
  planStepBatches,
} from "./planning.ts";
export type {
  EntityPlacement,
  PartitionCellPlan,
  PartitionPlanResult,
  StepBatchPlanItem,
  StepBatchPlan,
} from "./planning.ts";
export {
  SimulationSession,
  SESSION_TERMINATED_EVENT_KIND,
} from "./session.ts";
export type {
  SimulationGameBinding,
  SimulationActInput,
  LoadResult,
  ResetResult,
  StepResult,
  TerminateResult,
  ReplayWindowResult,
  SubmitResult,
  RestoreResult,
  BeginResult,
  AdvanceResult,
} from "./session-types.ts";
export {
  buildSnapshotPayload,
  canonicalSnapshotForm,
  validateSnapshotPayload,
  decodeContinuation,
  sealSnapshot,
  snapshotFormDigest,
  verifySnapshotArtifact,
} from "./snapshot.ts";
export type {
  PendingCommandRecord,
  IdempotencyRecord,
  SimulationSnapshotPayload,
  SnapshotBuildInput,
  SnapshotPayloadValidation,
  RestoredContinuation,
  SnapshotVerification,
} from "./snapshot.ts";
export { FixedClock, InMemorySnapshotStore, makePendingCommandQueue } from "./fakes.ts";
export {
  demoGameBinding,
  demoBlueprint,
  demoSystems,
  demoGrant,
  demoSeed,
  demoEntityRefs,
  movePayload,
  DEMO_WORLD_ID,
  DEMO_SCENE_ID,
  DEMO_ENTITY_HERO,
  DEMO_ENTITY_COMPANION,
  DEMO_ENTITY_BEACON,
  DEMO_AGENT_ID,
  DEMO_AVATAR_ID,
  DEMO_ACTOR_ID,
  DEMO_CAPABILITY,
  DEMO_INTENT_KIND,
  DEMO_COMMAND_KIND,
} from "./demo.ts";
