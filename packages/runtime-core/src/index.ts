/**
 * @playliquid/runtime-core — public surface (PL-013).
 *
 * The Interactive Runtime session kernel of PlayLiquid GameOS: the
 * Experience Protocol (load, reset, observe, act, step, snapshot, restore,
 * replay seam, terminate) implemented over @playliquid/runtime-contracts
 * as the single canonical command/event path (E2, lock rule 12), with:
 *
 * - the CapabilityPort seam to the Capability Broker (lock rule 4; the
 *   broker itself is Work Order PL-026 — the seam ships, not the broker);
 * - injected host-side ports (renderer surface, input source, transport,
 *   snapshot store, clock) — no IO, no timers, no engine SDKs here;
 * - deterministic fixed-tick stepping and canonical byte-stable snapshots
 *   (E9) with segmented, append-only event logs (E10);
 * - in-memory fakes + a reference world driver for tests and evidence.
 *
 * Imports `@playliquid/runtime-contracts` only, per
 * spec/module-dependency-matrix.md (runtime-core | runtime-contracts,
 * capability-broker — the latter reached through the CapabilityPort seam).
 *
 * Module map:
 * - construction.ts    role-guarded factory, kernel options + limits
 * - kernel.ts          THE kernel orchestrator (phases/epoch/tick/world)
 * - journal.ts         event log + sequences + replay window owner
 * - command-path.ts    the `act` pipeline + idempotency owner
 * - snapshots.ts       snapshot boundary registry owner
 * - event-kinds.ts     kernel-authority event kind constants
 * - serialize.ts       canonical byte-stable snapshot codec
 * - world.ts           WorldDriver seam (game simulation plug point)
 * - ports.ts           host-side ports (renderer/input/transport/store/clock)
 * - capability-port.ts CapabilityPort seam to the broker (PL-026)
 * - results.ts         typed operation results (all epoch-tagged)
 * - logview.ts         epoch-segmented canonical log validation
 * - fakes.ts           TEST-SUPPORT in-memory fakes + reference driver
 * - harness.ts         runtime evidence harness (node src/harness.ts)
 */

// Construction (kernel options, limits, role-guarded factory)
export { createInteractiveRuntime, DEFAULT_KERNEL_LIMITS } from "./construction.ts";
export type { KernelOptions, KernelLimits, KernelCreationResult } from "./construction.ts";

// Kernel
export { InteractiveRuntimeKernel } from "./kernel.ts";

// Command path (act pipeline)
export { SessionCommandPath } from "./command-path.ts";
export type { ActInput, CommandPathHost } from "./command-path.ts";

// Journal (canonical event path storage)
export { SessionJournal } from "./journal.ts";
export type { JournalBatch, ReplayWindow } from "./journal.ts";

// Snapshots (boundary registry)
export { SessionSnapshots } from "./snapshots.ts";
export type { SnapshotHost, RestorePlan } from "./snapshots.ts";

// Event kinds
export { RUNTIME_EVENT_KINDS } from "./event-kinds.ts";

// Results
export type {
  KernelErrorCode,
  KernelRejection,
  KernelFailure,
  LoadResult,
  ObserveResult,
  ActResult,
  StepResult,
  ResetResult,
  SnapshotResult,
  RestoreResult,
  ReplayResult,
  TerminateResult,
  IntegrityResult,
} from "./results.ts";

// World driver seam
export type { WorldDriver, WorldStep, WorldEventEffect } from "./world.ts";

// Host-side ports
export type {
  ClockPort,
  RendererPort,
  RendererFrame,
  InputSourcePort,
  InputSample,
  TransportPort,
  TransportMessage,
  SnapshotStorePort,
  StoredSnapshot,
} from "./ports.ts";

// Capability broker seam
export type { CapabilityPort, CapabilityPortContext } from "./capability-port.ts";

// Canonical serialization
export {
  canonicalJson,
  isJsonSafeValue,
  encodeSnapshotBytes,
  decodeSnapshotPayload,
  SNAPSHOT_FORMAT,
  CanonicalEncodeError,
  SnapshotDecodeError,
} from "./serialize.ts";
export type { JsonSafeValue, KernelSnapshotPayload } from "./serialize.ts";

// Log view
export {
  SESSION_BOUNDARY_EVENT_KINDS,
  isSessionBoundaryEvent,
  splitLogSegments,
  validateKernelEventLog,
} from "./logview.ts";

// Test-support fakes + reference driver (NOT production adapters)
export {
  ManualClock,
  InMemoryRenderer,
  InMemoryInputSource,
  InMemoryTransport,
  InMemorySnapshotStore,
  GrantTableCapabilityPort,
  CounterWorldDriver,
  COUNTER_WORLD_KIND,
  seededOffset,
  testGameRef,
  interactiveDescriptor,
  avatarActor,
  playerActor,
  capId,
} from "./fakes.ts";
export type { GrantTableOptions, CounterWorld } from "./fakes.ts";
