/**
 * Primitive value types shared by every Runtime/Experience Protocol contract.
 *
 * Purity: this module (and the whole package) performs NO IO. There is no
 * clock read, no randomness, no network, no filesystem. Time is always an
 * explicit input ({@link Timestamp}); identifiers are supplied by callers.
 *
 * Nominal typing: identifiers are branded strings so that unrelated id spaces
 * cannot be silently interchanged (a {@link SessionId} is not an
 * {@link EventId}). Branding is compile-time only; the `as*` constructors are
 * documented no-op casts that exist purely to cross from plain strings into
 * the nominal id spaces at system boundaries.
 */

declare const runtimeBrand: unique symbol;

/**
 * Nominal brand. `Brand<T, B>` is `T` at runtime and a distinct nominal type
 * at compile time. The branded property is required and readonly precisely so
 * that plain, unbranded values are NOT assignable to branded types — misuse
 * must fail to compile (see colocated tests for type-level misuse cases).
 */
export type Brand<T, B extends string> = T & { readonly [runtimeBrand]: B };

// ---------------------------------------------------------------------------
// Identifier spaces
// ---------------------------------------------------------------------------

/** Identifier of a runtime session (authoritative runtime state machine). */
export type SessionId = Brand<string, "SessionId">;
/** Identifier of a single command on the canonical command path. */
export type CommandId = Brand<string, "CommandId">;
/** Identifier of a single event on the canonical event path. */
export type EventId = Brand<string, "EventId">;
/** Stable identity of an actor (player, avatar agent, platform system). */
export type ActorId = Brand<string, "ActorId">;
/** Identifier of one typed intent emitted by an intelligence (proposal only). */
export type IntentId = Brand<string, "IntentId">;
/** Identifier of one capability-mediated action request. */
export type ActionRequestId = Brand<string, "ActionRequestId">;
/** Identifier of a capability (semantic permission name). */
export type CapabilityId = Brand<string, "CapabilityId">;
/** Identifier of one grant of a capability to one actor. */
export type CapabilityGrantId = Brand<string, "CapabilityGrantId">;
/** Identifier of a long-running runtime job (simulation, match). */
export type JobId = Brand<string, "JobId">;
/** Identifier of a client-submitted (untrusted) claim. */
export type ClaimId = Brand<string, "ClaimId">;
/** Identifier of an authoritative (server-decided) outcome. */
export type OutcomeId = Brand<string, "OutcomeId">;
/** Identifier of a persisted session snapshot (content-addressed). */
export type SnapshotId = Brand<string, "SnapshotId">;
/** Identifier of a target profile (e.g. `spark`). */
export type TargetProfileId = Brand<string, "TargetProfileId">;
/** Checkpoint reference of a durable job (content-addressed). */
export type CheckpointRef = Brand<string, "CheckpointRef">;
/** Opaque idempotency nonce supplied by the requesting actor. */
export type IdempotencyNonce = Brand<string, "IdempotencyNonce">;

/**
 * Semantic kind of a command on the canonical command path.
 * Command kinds are game/runtime-defined strings (e.g. `"world.act"`); the
 * brand prevents accidental use of an event kind where a command kind is
 * required (requirement E2: one canonical command/event path per behavior).
 */
export type CommandKind = Brand<string, "CommandKind">;
/** Semantic kind of an event on the canonical event path. */
export type EventKind = Brand<string, "EventKind">;
/** Semantic kind of a typed intent (proposal; never a mutation). */
export type IntentKind = Brand<string, "IntentKind">;

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

/**
 * Milliseconds since Unix epoch, ALWAYS supplied by the caller. This package
 * never reads a wall clock; comparisons between timestamps are pure.
 */
export type Timestamp = Brand<number, "TimestampMs">;
/** Discrete simulation time step within one session. Monotonic per epoch. */
export type Tick = Brand<number, "Tick">;
/** 1-based, gapless per-session sequence number of an admitted command. */
export type CommandSequence = Brand<number, "CommandSequence">;
/** 1-based, gapless per-session sequence number of an emitted event. */
export type EventSequence = Brand<number, "EventSequence">;
/**
 * Session epoch. Starts at 1; incremented by the authoritative runtime on
 * `reset` and `restore`. Results produced under an older epoch are stale
 * (see idempotency.ts — stale-result rule).
 */
export type SessionEpoch = Brand<number, "SessionEpoch">;
/** Lowercase hex SHA-256 digest (64 chars) of an artifact or state snapshot. */
export type Digest = Brand<string, "Sha256Digest">;
/** Explicit reproducibility seed (requirement E9). */
export type DeterminismSeed = Brand<string, "DeterminismSeed">;

// ---------------------------------------------------------------------------
// Actor references
// ---------------------------------------------------------------------------

/** Trust class of an actor. Drives admission rules (see capability.ts). */
export type ActorClass =
  | "player"
  | "avatar-agent"
  | "platform-system"
  | "host-authority";

/** Who issued a command / intent / claim. Pure data; no authentication here. */
export interface ActorRef {
  readonly actorClass: ActorClass;
  readonly actorId: ActorId;
}

// ---------------------------------------------------------------------------
// Constructors (compile-time-only nominal casts) and tiny validators
// ---------------------------------------------------------------------------

/** Nominal cast: string -> SessionId. */
export function asSessionId(value: string): SessionId {
  return value as SessionId;
}
/** Nominal cast: string -> CommandId. */
export function asCommandId(value: string): CommandId {
  return value as CommandId;
}
/** Nominal cast: string -> EventId. */
export function asEventId(value: string): EventId {
  return value as EventId;
}
/** Nominal cast: string -> ActorId. */
export function asActorId(value: string): ActorId {
  return value as ActorId;
}
/** Nominal cast: string -> IntentId. */
export function asIntentId(value: string): IntentId {
  return value as IntentId;
}
/** Nominal cast: string -> ActionRequestId. */
export function asActionRequestId(value: string): ActionRequestId {
  return value as ActionRequestId;
}
/** Nominal cast: string -> CapabilityId. */
export function asCapabilityId(value: string): CapabilityId {
  return value as CapabilityId;
}
/** Nominal cast: string -> CapabilityGrantId. */
export function asCapabilityGrantId(value: string): CapabilityGrantId {
  return value as CapabilityGrantId;
}
/** Nominal cast: string -> JobId. */
export function asJobId(value: string): JobId {
  return value as JobId;
}
/** Nominal cast: string -> ClaimId. */
export function asClaimId(value: string): ClaimId {
  return value as ClaimId;
}
/** Nominal cast: string -> OutcomeId. */
export function asOutcomeId(value: string): OutcomeId {
  return value as OutcomeId;
}
/** Nominal cast: string -> SnapshotId. */
export function asSnapshotId(value: string): SnapshotId {
  return value as SnapshotId;
}
/** Nominal cast: string -> TargetProfileId. */
export function asTargetProfileId(value: string): TargetProfileId {
  return value as TargetProfileId;
}
/** Nominal cast: string -> CheckpointRef. */
export function asCheckpointRef(value: string): CheckpointRef {
  return value as CheckpointRef;
}
/** Nominal cast: string -> IdempotencyNonce. */
export function asIdempotencyNonce(value: string): IdempotencyNonce {
  return value as IdempotencyNonce;
}
/** Nominal cast: string -> CommandKind. */
export function asCommandKind(value: string): CommandKind {
  return value as CommandKind;
}
/** Nominal cast: string -> EventKind. */
export function asEventKind(value: string): EventKind {
  return value as EventKind;
}
/** Nominal cast: string -> IntentKind. */
export function asIntentKind(value: string): IntentKind {
  return value as IntentKind;
}
/** Nominal cast: number -> Timestamp. */
export function asTimestamp(ms: number): Timestamp {
  return ms as Timestamp;
}
/** Nominal cast: number -> Tick. */
export function asTick(n: number): Tick {
  return n as Tick;
}
/** Nominal cast: number -> CommandSequence. */
export function asCommandSequence(n: number): CommandSequence {
  return n as CommandSequence;
}
/** Nominal cast: number -> EventSequence. */
export function asEventSequence(n: number): EventSequence {
  return n as EventSequence;
}
/** Nominal cast: number -> SessionEpoch. */
export function asSessionEpoch(n: number): SessionEpoch {
  return n as SessionEpoch;
}
/** Nominal cast: string -> DeterminismSeed. */
export function asDeterminismSeed(value: string): DeterminismSeed {
  return value as DeterminismSeed;
}
/** Nominal cast: string -> Digest (lowercase hex SHA-256, 64 chars). */
export function asDigest(value: string): Digest {
  return value as Digest;
}

/** True iff `value` is a syntactically valid lowercase-hex SHA-256 digest. */
export function isValidDigest(value: string): value is string {
  return /^[0-9a-f]{64}$/.test(value);
}

/** True iff `n` is a usable 1-based sequence number. */
export function isPositiveSequence(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1;
}
