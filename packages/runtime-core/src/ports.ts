/**
 * HOST-SIDE PORTS of the Interactive Runtime kernel.
 *
 * The kernel is a DOMAIN module: it performs no IO, owns no timers, and
 * never touches a real renderer, input device, network socket or disk.
 * Every host concern is an injected port (spec/module-dependency-matrix.md
 * rules: "domain is pure; app orchestrates through ports; adapters own
 * IO/tool/engine details"). In-memory fakes for every port live in
 * fakes.ts and are the ONLY concrete implementations this work order
 * ships — real adapters (canvas/WebGL renderer, device input, websocket
 * transport, durable snapshot store) are later host work.
 *
 * Async/stateful documentation (spec/worker-contract.md), binding for the
 * ports collectively:
 *
 * - Mutable state owner: THE KERNEL owns session state. Ports are
 *   observation/effects surfaces: data flows OUT of the kernel through
 *   renderer/transport, and IN only as explicit requests (input samples,
 *   snapshots). No port may mutate kernel state; there is no callback into
 *   the kernel from a port.
 * - Clock: the kernel has NO internal notion of wall time (no
 *   timers-as-authority). Timestamps on commands come from the capability
 *   port; the {@link ClockPort} exists so HOST adapters (and the test
 *   fakes) obtain time from one injected, controllable authority.
 * - Retry/cancellation: ports are synchronous request/response or one-way
 *   notify surfaces; retry policy is owned by host adapters, never by the
 *   kernel, and is out of scope for this work order.
 */

import type {
  CommandReceipt,
  Digest,
  ExperienceObservation,
  IdempotencyNonce,
  CapabilityGrantId,
  RuntimeEventEnvelope,
  SessionEpoch,
  SessionId,
  SnapshotId,
  Tick,
  Timestamp,
  TypedIntent,
} from "@playliquid/runtime-contracts";
import type { KernelSnapshotPayload } from "./serialize.ts";

/**
 * Injected time authority for host adapters. The kernel itself never calls
 * it — its existence here is the sanctioned replacement for `Date.now()`
 * and timer scheduling anywhere in the runtime core.
 */
export interface ClockPort {
  now(): Timestamp;
}

/** One presentation frame pushed to the renderer surface (one-way). */
export interface RendererFrame {
  readonly sessionId: SessionId;
  readonly tick: Tick;
  readonly epoch: SessionEpoch;
  readonly phase: string;
  readonly events: readonly RuntimeEventEnvelope[];
  readonly committedEventSeq: number;
}

/**
 * Renderer surface port. `present` is a one-way notification: rendering may
 * never fail the kernel, and may never feed back into kernel state. The
 * kernel treats presenter errors as host bugs (they propagate as
 * exceptions; no kernel state is rolled back because presentation happens
 * strictly AFTER events are committed).
 */
export interface RendererPort {
  present(frame: RendererFrame): void;
}

/** One harvested input sample: an untrusted typed intent + its claim. */
export interface InputSample {
  readonly intent: TypedIntent;
  /** Grant claim; required for avatar-agent intents (lock rule 14). */
  readonly grantId?: CapabilityGrantId;
  readonly nonce: IdempotencyNonce;
}

/**
 * Input source port. Polled explicitly by the host loop via
 * `kernel.harvestInputs()`; the kernel never blocks on input. Samples are
 * UNTRUSTED: every harvested intent goes through the full capability ->
 * admission -> idempotency path exactly like any other `act`.
 */
export interface InputSourcePort {
  poll(): readonly InputSample[];
}

/** Outbound transport messages emitted by the kernel (one-way). */
export type TransportMessage =
  | { readonly kind: "observation"; readonly observation: ExperienceObservation }
  | { readonly kind: "receipt"; readonly receipt: CommandReceipt; readonly sessionId: SessionId };

/**
 * Transport port (multiplayer/authority wiring is later work). The kernel
 * is the AUTHORITY side: it only posts observations and receipts OUT
 * (R9/lock 19 — clients submit input, they never assert outcomes). There
 * is deliberately no inbound message type: inbound commands arrive through
 * the normal `act`/input paths so the canonical command path stays single
 * (E2).
 */
export interface TransportPort {
  post(message: TransportMessage): void;
}

/** Content-addressed store result for one saved snapshot. */
export interface StoredSnapshot {
  readonly snapshotId: SnapshotId;
  readonly stateDigest: Digest;
}

/**
 * Snapshot store port: the host-side content-addressed persistence seam.
 * The kernel hands over the canonical payload AND its already-computed
 * canonical bytes (serialize.ts owns the byte layout); the store computes
 * the digest, assigns the content-addressed id, and can serve the payload
 * back on restore. Stores may deduplicate identical bytes (same digest ->
 * same snapshot id) — that is what makes byte-stability observable.
 */
export interface SnapshotStorePort {
  save(payload: KernelSnapshotPayload, canonicalBytes: string): StoredSnapshot;
  load(snapshotId: SnapshotId): KernelSnapshotPayload | undefined;
}
