/**
 * PORTS — every effect the build orchestrator would otherwise perform
 * behind its back is a pure interface here, injected by the host and faked
 * in tests (platform-economy / tool-fabric-runtime precedent). The domain
 * and the service depend only on these seams: no IO, no timers, no
 * globals, no engine SDKs (E3).
 *
 * Port list (work-order scope):
 * - {@link ServiceClock}         — the ONLY time source (E3).
 * - {@link BuildStore}           — durable append-only event persistence (E6).
 * - {@link BuildSourcePort}      — the registry/CAS read seam: input-digest
 *   resolvability, lock loading and package-closure resolution. The
 *   registry authority is @playliquid/package-registry (PL-011); the
 *   digest/CAS authority is @playliquid/package-system — this port never
 *   re-implements either, it is the wiring seam the host implements
 *   (registry adapter shipped in registry-adapter.ts).
 * - {@link ToolFabricPort}       — the Tool Fabric runtime seam (PL-019):
 *   build stage steps execute as provider-neutral tool operations through
 *   THIS port only. The adapter over @playliquid/tool-fabric-runtime ships
 *   in tool-fabric-adapter.ts; availability of cited operations is part of
 *   the seam so a missing toolchain is OBSERVABLE and recordable as a
 *   truthful limitation (E11), never a silent failure.
 */

import type {
  BuildStage,
  ToolOperationId,
  VerificationEvidence,
} from "@playliquid/build-contracts";
import type { ContentDigest, PackageLock, ResolutionResult } from "@playliquid/package-system";
import type { BuildEvent } from "./events.ts";

/** The only time source the service will ever consult (E3). */
export interface ServiceClock {
  now(): number;
}

/**
 * Durable event persistence (E6): the append-only transition log. A REAL
 * durable store is host-owned; the in-memory fake in fakes.ts is a test
 * double (process-local memory is NOT durable across restarts — E11
 * truthful limitation). Implementations must persist events in append
 * order and replay them in the same order.
 */
export interface BuildStore {
  /** Durably appends events; the log never rewrites (E10). */
  appendEvents(events: readonly BuildEvent[]): void;
  /** Every persisted event, in append order (replay source, E6). */
  loadEvents(): readonly BuildEvent[];
}

/** The result of the package-closure resolution seam (reuses package-system's authority verbatim). */
export type ClosureResolution = ResolutionResult;

/**
 * The registry/CAS read seam: everything the orchestrator needs to (a)
 * answer build-input digest resolvability at admission, (b) load the
 * pinned game lock, and (c) resolve the locked package closure. The
 * closure resolution result is package-system's `ResolutionResult` — the
 * single resolution authority (E9 determinism; never re-implemented here).
 */
export interface BuildSourcePort {
  /** Can the host currently resolve content addressed by `digest`? */
  canResolve(digest: ContentDigest): boolean;
  /** The pinned lock for `fingerprint`, or null when not resolvable. */
  loadLock(fingerprint: ContentDigest): PackageLock | null;
  /** Deterministic closure resolution of a lock against the registry. */
  resolveClosure(lock: PackageLock): ClosureResolution;
}

/** One build-tool invocation the orchestrator issues through the fabric seam. */
export interface BuildToolCall {
  /** The stage the step belongs to (frozen stage vocabulary). */
  readonly stage: BuildStage;
  /** The provider-neutral tool operation this step runs (seam vocabulary). */
  readonly operation: ToolOperationId;
  /** Deterministic call id (E9): same logical step ⇒ same call id. */
  readonly callId: string;
  /** Deterministic idempotency key (E6): replays must not re-execute. */
  readonly idempotencyKey: string;
  /** JSON-shaped step input (exchanged by value; artifacts stay by reference). */
  readonly input: unknown;
}

/** The typed result of one build-tool invocation through the fabric seam. */
export type BuildToolResult =
  | { readonly outcome: "ok"; readonly output: unknown }
  | { readonly outcome: "failed"; readonly code: string; readonly message: string };

/** One artifact emitted by a tool step (package-system CAS vocabulary, E7). */
export interface ToolEmittedArtifact {
  /** Namespaced dotted artifact kind, e.g. `game.bundle`. */
  readonly artifactKind: string;
  readonly digest: ContentDigest;
  readonly sizeBytes: number;
  readonly mediaType: string;
}

/** The contract a tool step's ok-output must satisfy to be accepted. */
export interface BuildToolOutput {
  readonly artifacts?: readonly ToolEmittedArtifact[];
  readonly evidence?: readonly VerificationEvidence[];
}

/**
 * The Tool Fabric runtime seam (PL-019). Stage steps execute as tool
 * operations exclusively through this port; `availableOperations` makes
 * toolchain gaps observable so the service records truthful E11
 * limitations instead of fabricating success.
 */
export interface ToolFabricPort {
  /** Invokes one build-tool step. Total; typed failures; never throws. */
  invokeBuildTool(call: BuildToolCall): Promise<BuildToolResult>;
  /** Tool operations currently registered behind the fabric (E11 truth). */
  availableOperations(): readonly ToolOperationId[];
}
