/**
 * AVATAR RUNTIME PORTS (pure interfaces — the seams the interactive and
 * simulation runtimes host; this package ships no execution kernel of its
 * own).
 *
 * Data flow per cycle (runtime.ts):
 *
 *   SensorInputPort.poll() ──► restriction filter ──► AvatarMemoryPort.append()
 *                                            └──────► AvatarIntelligencePort.decide()
 *   AvatarIntelligencePort.decide() ──► intent claims ──► Capability Broker
 *   broker "granted" ──► ActuatorOutputPort.emit(canonical command)
 *   broker "denied"  ──► AvatarIntelligencePort.notifyDenial(feedback)
 *
 * Trust boundaries (architecture.md "Security"; lock rules 13/14):
 * - The intelligence (an avatar brain: third-party/AI-generated, untrusted
 *   until qualified) sees only filtered perceptions and emits INTENT
 *   CLAIMS — proposals referencing a grant, never authority;
 * - every claim is evaluated by the broker; only granted resolutions
 *   become canonical commands on the actuator output;
 * - no port receives an engine handle, kernel state or mutation path.
 *
 * Async/stateful documentation (spec/worker-contract.md), this seam set:
 * - Mutable state owner: the HOST RUNTIME owns session/kernel state; the
 *   avatar runtime owns only its per-cycle report sequence and request-id
 *   counter. Ports are observation/effect surfaces.
 * - Event order: one cycle = poll → filter → remember → decide → act; the
 *   actuator port receives commands in claim order.
 * - Idempotency: each claim carries an {@link IdempotencyNonce}; the
 *   avatar runtime builds `IdempotencyKey {scope:"action", actor, nonce}`
 *   exactly per runtime-contracts idempotency.ts; deduplication is owned
 *   by the kernel after admission (the broker deliberately does not
 *   dedup — see capability-broker broker.ts docs).
 * - Stale results: evaluations carry the cycle's epoch; grants issued
 *   under older epochs are broker-denied (`grant-epoch-stale`).
 * - Retry/cancellation: synchronous cycle; a retried claim re-uses its
 *   nonce and is deduplicated kernel-side. Nothing async is retained.
 */

import type {
  ActionRequest,
  ActionResolution,
  CapabilityGrantId,
  CommandId,
  IdempotencyNonce,
  IntentId,
  IntentKind,
  RuntimeCommandEnvelope,
  SessionEpoch,
  SessionId,
  Tick,
  Timestamp,
  TypedIntent,
} from "@playliquid/runtime-contracts";

/** One perception sample from a sensor channel (unfiltered input). */
export interface SensorSample {
  /** Channel id matching an `AvatarSensorChannel.channel` of the body. */
  readonly channel: string;
  readonly tick: Tick;
  readonly payload: unknown;
}

/** Sensor input port: the body's perception surface (host-driven). */
export interface SensorInputPort {
  poll(): readonly SensorSample[];
}

/** A memory-recorded perception (post-filter). */
export interface PerceptionRecord {
  readonly channel: string;
  readonly tick: Tick;
  readonly payload: unknown;
  readonly recordedAt: Timestamp;
}

/** Avatar memory port: append-only perception memory with recall. */
export interface AvatarMemoryPort {
  append(record: PerceptionRecord): void;
  /** Recall records of one channel (or all when channel omitted). */
  recall(channel?: string, sinceTick?: Tick): readonly PerceptionRecord[];
}

/**
 * An intent claim: the untrusted intelligence proposes a typed intent AND
 * references the grant it believes it acts under (mirrors runtime-core's
 * `InputSample`: intent + grantId + nonce — the claim is validated by the
 * broker, never trusted).
 */
export interface AvatarIntentClaim<P = unknown> {
  readonly intent: TypedIntent<P>;
  /** The grant the brain claims to act under; broker-validated. */
  readonly grantId: CapabilityGrantId;
  /** Reuse across retries of the same logical action (idempotency). */
  readonly nonce: IdempotencyNonce;
}

/** Denial feedback routed back to the intelligence (learning signal). */
export interface AvatarDenialFeedback {
  readonly intentId: IntentId;
  readonly intentKind: IntentKind;
  /** Where the refusal came from: the broker (authority) or the body. */
  readonly source: "broker" | "body";
  /** Broker denial reason, or a local refusal code. */
  readonly reason: string;
}

/**
 * The avatar intelligence port (the brain seam). Implementations are host
 * concerns — model selection stays under the ZCode AI runtime (lock 5);
 * this package ships only the interface and test fakes.
 */
export interface AvatarIntelligencePort {
  decide(perceptions: readonly PerceptionRecord[]): readonly AvatarIntentClaim[];
  notifyDenial(feedback: AvatarDenialFeedback): void;
}

/** Actuator output port: where granted canonical commands land. */
export interface ActuatorOutputPort {
  emit(command: RuntimeCommandEnvelope): void;
}

/**
 * The broker seam the avatar runtime is wired to. STRUCTURALLY satisfied
 * by capability-broker's `CapabilityBroker.evaluate` (and by runtime-core's
 * `CapabilityPort`); declared locally so this package depends on the
 * frozen protocol shape, not on a concrete broker class.
 */
export interface AvatarBrokerPort {
  evaluate<P>(request: ActionRequest<P>, context: AvatarBrokerContext): ActionResolution<P>;
}

/** The broker evaluation context (identical shape to CapabilityPortContext). */
export interface AvatarBrokerContext {
  readonly sessionId: SessionId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
}

/** Ids of commands emitted during one cycle (audit read model). */
export type EmittedCommandIds = readonly CommandId[];
