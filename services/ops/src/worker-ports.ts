/**
 * INJECTED PORTS + RECORDS of the durable worker runtime (PL-044).
 *
 * The runtime owns mutable domain state (E1): the work table, the effect
 * receipt ledger and the append-only work journal (E10). EVERYTHING it
 * must not own as ambient authority arrives through these seams:
 *
 * - {@link WorkerClockPort} — caller-programmed time (never Date.now);
 * - {@link WorkerStorePort} — whole-document persistence (E6: the durable
 *   store is the host's to wire; the arena-integration-runtime snapshot
 *   discipline generalized);
 * - {@link WorkerEffectsPort} — the executor of work effects. THE HOST
 *   CONTRACT: the executor is idempotent by `effectKey` — one REAL effect
 *   per key, re-invocations return `duplicate: true` receipts (the arena
 *   send-ledger discipline: retries re-submit the SAME envelope; the
 *   receiver dedupes by content key). Exactly-once effects under
 *   crash-resume are the COMPOSITION of the runtime's durable
 *   at-least-once redelivery and this port's keyed dedupe.
 *
 * Async/stateful discipline (spec/worker-contract.md), binding for this
 * tree: mutable state owner = the DurableWorkerRuntime instance
 * (worker.ts) — persisted through {@link WorkerStorePort} snapshots;
 * command admission = the pure intake checks over caller-supplied time +
 * owned state; event order = the journal, append-only, admission order;
 * idempotency keys = the work content key (E10 duplicate receipts) and
 * the effect key; stale-result rule = the first effective receipt stands,
 * completions of expired leases are typed refusals; replay/resume =
 * restore() of the content-addressed document (refuses tampered
 * content); retry/cancellation = re-drive re-submits the SAME effect key;
 * refused doors mutate nothing.
 *
 * Purity: types only in this file.
 */

import type { SubjectId, TenantId } from "../../../packages/platform-contracts/src/index.ts";
import type { WorkJournalEntry } from "./work-journal.ts";

/** Service-level time authority (the house ClockPort shape). */
export interface WorkerClockPort {
  now(): number;
}

/** One work item's lifecycle state (queued → leased → completed|failed). */
export type WorkState = "queued" | "leased" | "completed" | "failed";

/** Terminal states are immutable (E10). */
export const TERMINAL_WORK_STATES: readonly WorkState[] = Object.freeze(["completed", "failed"]);

/** Type guard over {@link WorkState}. */
export function isWorkState(value: unknown): value is WorkState {
  return typeof value === "string" && (["queued", "leased", "completed", "failed"] as const as readonly string[]).includes(value);
}

/** One lease held by one worker (heartbeat-renewed, expiry-reclaimable). */
export interface LeaseRecord {
  readonly leaseId: string;
  readonly workerId: string;
  readonly attempt: number;
  readonly leasedAt: number;
  readonly expiresAt: number;
  readonly heartbeats: number;
  readonly lastHeartbeatAt: number;
}

/**
 * One content-addressed WORK DOCUMENT: identity (`workDigest` pins the
 * immutable admission content), the evolving orchestration state
 * (attempts, lease, terminal facts) OUTSIDE the identity digest, and the
 * `payload` the effect executor receives (JSON-safe).
 */
export interface WorkRecord {
  readonly workId: string;
  readonly tenant: TenantId;
  readonly enqueuedBy: SubjectId;
  readonly kind: string;
  readonly effectKind: string;
  readonly payload: unknown;
  readonly payloadDigest: string;
  readonly workDigest: string;
  readonly enqueuedAt: number;
  readonly state: WorkState;
  readonly attempts: number;
  readonly lease?: LeaseRecord;
  readonly completedAt?: number;
  readonly failure?: { readonly code: string; readonly detail: string; readonly failedAt: number };
}

/** One observed effect-executor outcome (the durable receipt ledger). */
export interface EffectRecord {
  readonly effectKey: string;
  readonly workId: string;
  readonly effectKind: string;
  readonly outcome: "performed" | "duplicate" | "refused";
  readonly at: number;
  /** Digest of the executor's result (when ok). */
  readonly resultDigest?: string;
  /** The executor's typed refusal (verbatim, E8). */
  readonly refusal?: { readonly code: string; readonly detail: string };
}

/** The logical effect handed to the executor (keyed dedupe contract). */
export interface WorkEffect {
  readonly effectKey: string;
  readonly workId: string;
  readonly effectKind: string;
  readonly payload: unknown;
}

/** The executor's outcome: performed, idempotent duplicate, or refusal. */
export type EffectOutcome =
  | { readonly ok: true; readonly duplicate: boolean; readonly result: unknown }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/** The effect executor port (host-injected; idempotent by effectKey). */
export interface WorkerEffectsPort {
  perform(effect: WorkEffect): EffectOutcome;
}

/** One persisted, content-addressed snapshot of the whole runtime state (E6). */
export interface OpsWorkerDocument {
  /** Content address of this document (digest.ts discipline). */
  readonly stateDigest: string;
  readonly revision: number;
  readonly works: readonly WorkRecord[];
  readonly effects: readonly EffectRecord[];
  readonly journal: readonly WorkJournalEntry[];
}

/** Write/read port for service-document persistence (E6). */
export interface WorkerStorePort {
  save(document: OpsWorkerDocument): void;
  load(): OpsWorkerDocument | undefined;
}

/** The port bundle the durable worker runtime needs (host-injected). */
export interface OpsWorkerPorts {
  readonly clock: WorkerClockPort;
  readonly store: WorkerStorePort;
  readonly effects: WorkerEffectsPort;
}

/** Who is calling (tenant + subject claim; identity authority is elsewhere). */
export interface OpsCaller {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}

/** A worker identity claiming leases (subject of the caller's tenant). */
export interface OpsWorkerCaller extends OpsCaller {
  readonly workerId: string;
}

/** Construction options. */
export interface DurableWorkerOptions {
  readonly ports: OpsWorkerPorts;
  /** Lease time-to-live in ms (default 60_000; tests inject their own). */
  readonly leaseTtlMs?: number;
}

// ---------------------------------------------------------------------------
// Door results (typed at every door; refusals mutate nothing)
// ---------------------------------------------------------------------------

/** Result of enqueueing (E10 duplicate receipts resume the SAME work). */
export type EnqueueResult =
  | { readonly ok: true; readonly work: WorkRecord; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: "invalid-work" | "cross-tenant"; readonly detail: string };

/** Result of claiming the next work item (possibly via expiry reclaim). */
export type LeaseResult =
  | { readonly ok: true; readonly work: WorkRecord; readonly lease: LeaseRecord; readonly reclaimed: boolean }
  | { readonly ok: false; readonly code: "queue-empty" | "cross-tenant"; readonly detail: string };

/** Result of one lease heartbeat. */
export type HeartbeatResult =
  | { readonly ok: true; readonly lease: LeaseRecord }
  | { readonly ok: false; readonly code: WorkerDoorRefusalCode; readonly detail: string };

/** Result of completing one work item (duplicates are honest receipts). */
export type CompleteResult =
  | { readonly ok: true; readonly work: WorkRecord; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: WorkerDoorRefusalCode; readonly detail: string };

/** Result of failing one work item (terminal; E10). */
export type FailResult =
  | { readonly ok: true; readonly work: WorkRecord; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: WorkerDoorRefusalCode; readonly detail: string };

/** Result of one driveQueue pass. */
export type DriveResult =
  | {
      readonly ok: true;
      readonly processed: number;
      readonly failed: number;
      readonly remaining: number;
    }
  | { readonly ok: false; readonly code: WorkerDoorRefusalCode; readonly detail: string };

/** Result of the restore door (E6; tampered content is never adopted). */
export type WorkerRestoreResult =
  | { readonly ok: true; readonly works: number; readonly effects: number; readonly journalLength: number }
  | { readonly ok: false; readonly code: WorkerRestoreRefusalCode; readonly detail: string };

/** The runtime doors' shared refusal vocabulary (frozen). */
export type WorkerDoorRefusalCode =
  | "unknown-work"
  | "cross-tenant"
  | "not-leased"
  | "lease-expired"
  | "lease-holder"
  | "already-terminal"
  | "tampered-work";

/** The restore door's refusal vocabulary (frozen). */
export type WorkerRestoreRefusalCode =
  | "no-persisted-document"
  | "tampered-document"
  | "tampered-work"
  | "tampered-effect"
  | "broken-journal";
