/**
 * LATTICE — the public entrypoint of the Large-world/package-graph
 * reference (PL-039; examples/large-world).
 *
 * The demonstration that "Worlds support spatial partitioning and
 * streaming" (R15) over "a federated package graph, CAS artifacts,
 * incremental builds, spatial world partitions and scalable headless
 * simulation" (§Scalability): a 128×128-unit world partitioned into 8×8
 * chunks under the World → Region → Zone → Chunk hierarchy, published as
 * 87 immutable packages on the federated registry with CAS-backed
 * digests, streamed by a deterministic schedule driven by a moving
 * viewpoint agent, and simulated headlessly at scale over the
 * Simulation Runtime (reproducible, resettable, snapshot-able,
 * replayable) — with typed refusals wherever the streaming contract
 * forbids an op (E8) and content-derived digests everywhere (E9).
 */

// Module manifest (PL-010 governance format)
export { latticeModule } from "./module.ts";

// Identity + semantic vocabulary (frozen data)
export * from "./ids.ts";
export * from "./events.ts";

// The spatial layout + the GameIR document (the static definition)
export * from "./layout.ts";
export { latticeDocument, LATTICE_WORLD, VIEWPOINT_ENTITY, CORE_CHUNK_ID, entryScene, floraEntityIds, viewpointState, WORLD_STREAMING } from "./document.ts";

// The derived world model (static hierarchy + streaming contracts)
export * from "./world-model.ts";

// The streaming semantics (R15: schedule, admission, state machine)
export * from "./streaming.ts";

// The package graph (87 packages; CAS + registry + lock, E7/R19)
export {
  LATTICE_PACKAGE_COUNT,
  chunkContentBytes,
  chunkReliefBytes,
  createChunkResolver,
  entityKeysOfChunk,
  publishLatticeWorld,
  verifyLatticeLock,
} from "./packages.ts";
export type { LatticeWorldGraph, PublicationRefusal } from "./packages.ts";

// The versioned composition (§Game model)
export { composeLatticeWorld, documentArtifactBytes, latticeGameRef } from "./composition.ts";
export type { LatticeComposition, CompositionRefusal, LatticeGameRef } from "./composition.ts";

// The Simulation Runtime binding (§Runtime: headless, reproducible…)
export {
  CARRIER_ENTITY_IDS,
  LATTICE_SYSTEM_IDS,
  LATTICE_WORLD_KIND,
  buildLatticeBinding,
  gameRefSummaryOf,
  latticeBlueprint,
  latticeSeed,
  latticeSystems,
  plannedPositionAfter,
  streamingViewOf,
  viewpointEntityKey,
  viewpointGrant,
} from "./binding.ts";

// Replay capture + deterministic re-execution (R8)
export {
  BOUNDARY_TICK,
  FINAL_TICK,
  LATTICE_SESSION_ID,
  POST_MOVES,
  PRE_MOVES,
  compareLatticeReplay,
  createLatticeLauncher,
  recordedMove,
  sealLatticeReplay,
  verifyLatticeReplay,
  viewpointMoveEnvelope,
} from "./replay.ts";
export type { ScriptedMove, SealedLatticeReplay } from "./replay.ts";

// The canonical streaming scenario (E9 end-to-end evidence)
export { plannedWaypoints, runCanonicalScenario, scenarioEvidenceOf } from "./scenario.ts";
export type { LatticeScenario, LatticeScenarioStats } from "./scenario.ts";

// The chunk build seam (§Build: staged, per-chunk, typed refusals)
export {
  LATTICE_TENANT,
  OTHER_TENANT,
  composeChunkBuildInputs,
  createChunkKitchen,
} from "./build.ts";
export type { ChunkBuildIdentity, ChunkBuildOutcome, ChunkBuildRefusal, ChunkBuildResult, ChunkBuildRefusalCode, ChunkKitchen } from "./build.ts";
