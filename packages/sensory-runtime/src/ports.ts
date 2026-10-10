/**
 * PORTS — every place an effect would otherwise live behind the sensory
 * runtime's back is a pure interface here, injected by the app and
 * faked in tests (platform-economy / lab-simulation precedent).
 *
 * Port list (work-order scope):
 * - {@link ServiceClock} — the ONLY time source (E9: no wall-clock in
 *   the domain; recorded-at stamps come from here).
 * - {@link SensoryProducerPort} — one per-channel raw producer. A
 *   producer is an INTERFACE: real capture (cameras, microphones,
 *   device IO) is deliberately NOT built (E11 — hosts own adapters);
 *   the only in-repo implementations are the seeded in-memory fakes.
 * - {@link SensoryHistoryPort} — append-only content-addressed history
 *   persistence (E10: records immutable, digest-pinned, idempotent by
 *   content key). A durable store is deliberately deferred (E6 —
 *   host-owned); this is the port contract the host wires.
 *
 * Async/stateful documentation (spec/worker-contract.md), this seam set:
 * - Mutable state owner: the sensory runtime host owns ONLY its poll
 *   bookkeeping (per-channel last epoch, monotonicity ledger); the
 *   history port owns the records; producers own their frames.
 * - Event order: one poll = producers in binding order, frames in
 *   producer-emission order; history appends in admission order.
 * - Idempotency: the sample content key (digest.ts) — same key, the
 *   recorded receipt returns, no second mutation (E10).
 * - Stale-result rule: producer epochs must be non-decreasing per
 *   channel; a lower epoch than the last admitted one is refused
 *   (`epoch-regression`).
 * - Replay/resume: a poll batch is a pure function of (binding, port
 *   states, epoch, clock) modulo the history append; content keys make
 *   replays idempotent.
 * - Retry/cancellation: synchronous; a re-polled identical frame is the
 *   same content key and returns the recorded receipt.
 *
 * Purity: interfaces + structural data only. No IO anywhere (E3).
 */

import type { SessionEpoch, Tick } from "@playliquid/runtime-contracts";
import type { SensorCapabilityId } from "@playliquid/game-contracts";
import type { ContentDigest } from "@playliquid/package-system";
import type { TenantId } from "@playliquid/platform-contracts";
import type { RawProducerFrame } from "./codec.ts";

// ---------------------------------------------------------------------------
// ServiceClock
// ---------------------------------------------------------------------------

/** Milliseconds stamp for history records — caller-injected, never a wall-clock read. */
export interface ServiceClock {
  /** Deterministic monotonic stamp source (the domain never calls Date.now). */
  readonly now: () => number;
}

// ---------------------------------------------------------------------------
// Producers
// ---------------------------------------------------------------------------

/**
 * One per-channel raw producer. `poll()` returns the frames produced
 * since the last poll (drain semantics are the producer's own; the
 * codec validates whatever arrives). Producers are UNTRUSTED edges:
 * their output is `unknown` until a codec admits it.
 */
export interface SensoryProducerPort {
  /** The channel id this producer serves (must match the avatar binding). */
  readonly channel: string;
  /** The frozen capability the producer emits under. */
  readonly capability: SensorCapabilityId;
  /** Drain and return raw frames (order: producer emission order). */
  readonly poll: () => readonly RawProducerFrame[];
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** One immutable, append-only history record (E10). */
export interface SensoryHistoryRecord {
  /** Content address of the record's own content (digest.ts). */
  readonly recordId: ContentDigest;
  /** The sample content key — the idempotency key (E10). */
  readonly contentKey: ContentDigest;
  readonly tenant: TenantId;
  readonly channel: string;
  readonly capability: SensorCapabilityId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  readonly contentDigest: string;
  /** Canonical value form of the payload (byte-stable projection). */
  readonly payloadValueForm: string;
  readonly recordedAt: number;
}

/** The recorded-receipt outcome of an idempotent duplicate append. */
export interface RecordedReceipt {
  readonly status: "recorded-receipt";
  readonly record: SensoryHistoryRecord;
}

/** Append result: appended (new record) or recorded-receipt (E10 replay). */
export type AppendOutcome =
  | { readonly status: "appended"; readonly record: SensoryHistoryRecord }
  | RecordedReceipt;

/**
 * The append-only content-addressed history port. Saves are idempotent
 * by content key: the same key returns the recorded receipt; a DIFFERENT
 * record under the same key is a typed refusal (content-addressed
 * discipline, E10). Records are immutable — there is no update API at
 * all, by design.
 */
export interface SensoryHistoryPort {
  /** Append one record (idempotent by content key). */
  readonly append: (record: SensoryHistoryRecord) => AppendOutcome;
  /** Tenant-scoped ordered read of the history. */
  readonly read: (tenant: TenantId) => readonly SensoryHistoryRecord[];
  /** Tenant+channel scoped read. */
  readonly readChannel: (tenant: TenantId, channel: string) => readonly SensoryHistoryRecord[];
  /** Look up by content key within a tenant. */
  readonly findByKey: (tenant: TenantId, contentKey: ContentDigest) => SensoryHistoryRecord | undefined;
}
