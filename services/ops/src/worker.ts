/**
 * THE DURABLE WORKER RUNTIME (PL-044) — the single mutable-state owner
 * (E1) of the generic durable work queue: the arena-integration-runtime
 * durability idiom (PL-031) GENERALIZED over content-addressed work
 * documents.
 *
 * E6 semantics (the core contract, tested by fault injection at EVERY
 * durable point):
 * - enqueue is content-addressed: the work id derives from the content
 *   key (tenant, kind, effect kind, payload) — re-submission of the same
 *   content resumes the SAME work item as an idempotent duplicate
 *   receipt that grows nothing (E10);
 * - every state advance persists the whole content-addressed document
 *   through the store port BEFORE the next step, so a crash at ANY point
 *   resumes to the last durable state (restore() adopts only documents
 *   that fully verify — tampered content is a typed refusal, E8);
 * - effects are EXACTLY-ONCE under crash-resume as the composition of
 *   (a) the runtime leg: an effect with a durably recorded receipt is
 *   never re-invoked, and (b) the executor leg: the injected effects
 *   port dedupes by the stable `effectKey` (the same content key for
 *   every retry of one logical effect — the arena send-ledger
 *   discipline), so a crash between invocation and receipt re-invokes
 *   and receives a `duplicate` receipt;
 * - leases are heartbeat-renewed and expiry-reclaimable: an expired lease
 *   is reclaimed by the next claim (journal `lease-expired`), and a
 *   stale worker's completion of a reclaimed lease is a typed refusal —
 *   the first effective completion stands (E10);
 * - terminal states are immutable (E10): completions/failures of
 *   terminal work are honest duplicate receipts, never re-effects.
 *
 * Tenant isolation (R20): every door checks `checkTenantIsolation`
 * (platform-contracts authority — consumed, never re-implemented);
 * cross-tenant access is a typed refusal (E8).
 *
 * Pure domain: no IO beyond the injected ports, no timers, no globals;
 * synchronous refusals mutate nothing.
 */

import { checkTenantIsolation } from "../../../packages/platform-contracts/src/index.ts";
import { opsDigestOf, opsEffectKeyOf, opsWorkDigestOf, opsWorkIdOf, opsWorkKeyOf, opsWorkerDocumentDigestOf, isJsonSafe } from "./digest.ts";
import { appendJournalEntry } from "./work-journal.ts";
import type { WorkJournalEntry, WorkJournalEntryKind } from "./work-journal.ts";
import { expiredLeaseRefusal, heldLeaseCheck, isWorkDueFor, leaseFor, renewedLease } from "./worker-lease.ts";
import { verifyRestorableDocument, workIdentityVerifies } from "./worker-restore.ts";
import type {
  CompleteResult,
  DurableWorkerOptions,
  DriveResult,
  EffectRecord,
  EnqueueResult,
  FailResult,
  HeartbeatResult,
  LeaseResult,
  OpsCaller,
  OpsWorkerCaller,
  OpsWorkerDocument,
  OpsWorkerPorts,
  WorkRecord,
  WorkState,
  WorkerDoorRefusalCode,
  WorkerRestoreResult,
} from "./worker-ports.ts";

/** One work submission (tenant comes from the caller). */
export interface WorkSubmission {
  /** Host work-kind label (non-empty). */
  readonly kind: string;
  /** Host effect-kind label the executor dispatches on (non-empty). */
  readonly effectKind: string;
  /** JSON-safe payload (canonical-JSON serializable). */
  readonly payload: unknown;
}

/** The durable work-queue runtime. Construct with injected ports. */
export class DurableWorkerRuntime {
  private readonly ports: OpsWorkerPorts;
  private readonly leaseTtlMs: number;
  private readonly works = new Map<string, WorkRecord>();
  private readonly effects = new Map<string, EffectRecord>();
  private journal: readonly WorkJournalEntry[] = [];
  private revision = 0;

  constructor(options: DurableWorkerOptions) {
    this.ports = options.ports;
    this.leaseTtlMs = options.leaseTtlMs ?? 60_000;
  }

  /** The enqueue door: files one content-addressed work document (E6/E10). */
  enqueue(caller: OpsCaller, submission: WorkSubmission): EnqueueResult {
    if (
      typeof submission.kind !== "string" || submission.kind.length === 0 ||
      typeof submission.effectKind !== "string" || submission.effectKind.length === 0 ||
      !isJsonSafe(submission.payload)
    ) {
      return { ok: false, code: "invalid-work", detail: "work kind/effect kind must be non-empty strings and the payload must be JSON-safe" };
    }
    const key = opsWorkKeyOf({ tenant: String(caller.tenant), kind: submission.kind, effectKind: submission.effectKind, payload: submission.payload });
    const existing = this.works.get(opsWorkIdOf(key));
    if (existing !== undefined) {
      const isolation = checkTenantIsolation(caller, existing);
      if (!isolation.ok) return { ok: false, code: "cross-tenant", detail: `subject ${String(caller.subject)} of tenant ${String(isolation.requestTenant)} cannot resume work of tenant ${String(isolation.resourceTenant)} (R20)` };
      return { ok: true, work: existing, duplicate: true };
    }
    const now = this.now();
    const payloadDigest = this.digestOf(submission.payload);
    const work: WorkRecord = Object.freeze({
      workId: opsWorkIdOf(key),
      tenant: caller.tenant,
      enqueuedBy: caller.subject,
      kind: submission.kind,
      effectKind: submission.effectKind,
      payload: submission.payload,
      payloadDigest,
      workDigest: opsWorkDigestOf({
        tenant: String(caller.tenant),
        enqueuedBy: String(caller.subject),
        kind: submission.kind,
        effectKind: submission.effectKind,
        payload: submission.payload,
        payloadDigest,
        enqueuedAt: now,
      }),
      enqueuedAt: now,
      state: "queued",
      attempts: 0,
    });
    this.works.set(work.workId, work);
    this.journalAppend("enqueued", work.workId, now, { kind: submission.kind, effectKind: submission.effectKind, payloadDigest });
    this.persist();
    return { ok: true, work, duplicate: false };
  }

  /** The claim door: leases the oldest due work of the caller's tenant. */
  leaseNext(caller: OpsWorkerCaller): LeaseResult {
    const now = this.now();
    const candidate = this.tenantWorks(caller.tenant)
      .filter((work) => isWorkDueFor(caller, work, now))
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt || (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0))[0];
    if (candidate === undefined) {
      return { ok: false, code: "queue-empty", detail: `no due work for tenant ${String(caller.tenant)}` };
    }
    let reclaimed = false;
    let record = candidate;
    if (record.state === "leased" && record.lease !== undefined) {
      if (now >= record.lease.expiresAt) {
        this.journalAppend("lease-expired", record.workId, now, { workerId: record.lease.workerId, expiresAt: record.lease.expiresAt });
      }
      reclaimed = true;
    }
    const attempt = record.attempts + 1;
    const lease = leaseFor(caller, record, attempt, now, this.leaseTtlMs);
    record = Object.freeze({ ...record, state: "leased", attempts: attempt, lease });
    this.works.set(record.workId, record);
    this.journalAppend(reclaimed ? "lease-reclaimed" : "leased", record.workId, now, { workerId: caller.workerId, attempt });
    this.persist();
    return { ok: true, work: record, lease, reclaimed };
  }

  /** The heartbeat door: renews one held, unexpired lease. */
  heartbeat(caller: OpsWorkerCaller, workId: string): HeartbeatResult {
    const held = heldLeaseCheck(caller, workId, this.works.get(workId));
    if (!held.ok) return held;
    if (held.work.lease === undefined) return { ok: false, code: "not-leased", detail: `work ${workId} holds no lease` };
    const now = this.now();
    if (now >= held.work.lease.expiresAt) {
      return expiredLeaseRefusal(held.work.lease, workId, now);
    }
    const lease = renewedLease(held.work.lease, now, this.leaseTtlMs);
    const record = Object.freeze({ ...held.work, lease });
    this.works.set(workId, record);
    this.journalAppend("heartbeat", workId, now, { workerId: caller.workerId, heartbeats: lease.heartbeats });
    this.persist();
    return { ok: true, lease };
  }

  /** The completion door (terminal, immutable; duplicates are receipts). */
  complete(caller: OpsWorkerCaller, workId: string): CompleteResult {
    const held = heldLeaseCheck(caller, workId, this.works.get(workId));
    if (!held.ok) return held;
    if (held.work.state === "completed") return { ok: true, work: held.work, duplicate: true };
    if (held.work.state === "failed") {
      return { ok: false, code: "already-terminal", detail: `work ${workId} already failed (E10 — terminal states are immutable)` };
    }
    if (held.work.lease === undefined) return { ok: false, code: "not-leased", detail: `work ${workId} holds no lease` };
    const now = this.now();
    if (now >= held.work.lease.expiresAt) {
      return expiredLeaseRefusal(held.work.lease, workId, now);
    }
    const record = Object.freeze({ ...held.work, state: "completed" as WorkState, completedAt: now });
    this.works.set(workId, record);
    this.journalAppend("completed", workId, now, { workerId: caller.workerId, effectKey: this.effectKeyOf(record) });
    this.persist();
    return { ok: true, work: record, duplicate: false };
  }

  /** The failure door (terminal, immutable; duplicates are receipts). */
  fail(caller: OpsWorkerCaller, workId: string, reason: { readonly code: string; readonly detail: string }): FailResult {
    const held = heldLeaseCheck(caller, workId, this.works.get(workId));
    if (!held.ok) return held;
    if (held.work.state === "failed") return { ok: true, work: held.work, duplicate: true };
    if (held.work.state === "completed") {
      return { ok: false, code: "already-terminal", detail: `work ${workId} already completed (E10 — terminal states are immutable)` };
    }
    if (held.work.lease === undefined) return { ok: false, code: "not-leased", detail: `work ${workId} holds no lease` };
    const now = this.now();
    if (now >= held.work.lease.expiresAt) {
      return expiredLeaseRefusal(held.work.lease, workId, now);
    }
    const record = Object.freeze({
      ...held.work,
      state: "failed" as WorkState,
      failure: { code: reason.code, detail: reason.detail, failedAt: now },
    });
    this.works.set(workId, record);
    this.journalAppend("failed", workId, now, { workerId: caller.workerId, code: reason.code });
    this.persist();
    return { ok: true, work: record, duplicate: false };
  }

  /**
   * The orchestration door (E6): advances the caller's whole queue one
   * item at a time — lease → WAL effect-intent → invoke (or skip when a
   * durable receipt already stands) → record receipt → complete/fail —
   * every step persisting before the next. Any mid-queue refusal ends
   * the pass; the host simply drives again (idempotent).
   */
  driveQueue(caller: OpsWorkerCaller): DriveResult {
    let processed = 0;
    let failed = 0;
    for (;;) {
      const leased = this.leaseNext(caller);
      if (!leased.ok) {
        if (leased.code === "queue-empty") break;
        return { ok: false, code: leased.code, detail: leased.detail };
      }
      const work = leased.work;
      const effectKey = this.effectKeyOf(work);
      const now = this.now();
      this.journalAppend("effect-intended", work.workId, now, { effectKey, workerId: caller.workerId });
      this.persist(); // THE WAL WRITE: the intent is durable BEFORE the executor is invoked
      const standing = this.effects.get(effectKey);
      if (standing !== undefined) {
        // The runtime leg of exactly-once: a durable receipt stands —
        // never re-invoke; go straight to completion.
        this.journalAppend("effect-duplicate", work.workId, this.now(), { effectKey, source: "ledger" });
        const done = this.complete(caller, work.workId);
        if (!done.ok) return { ok: false, code: done.code, detail: done.detail };
        processed += 1;
        continue;
      }
      const outcome = this.ports.effects.perform({ effectKey, workId: work.workId, effectKind: work.effectKind, payload: work.payload });
      const at = this.now();
      if (outcome.ok) {
        const receipt: EffectRecord = Object.freeze({
          effectKey,
          workId: work.workId,
          effectKind: work.effectKind,
          outcome: outcome.duplicate ? "duplicate" : "performed",
          at,
          resultDigest: this.digestOf(outcome.result),
        });
        this.effects.set(effectKey, receipt);
        this.journalAppend(outcome.duplicate ? "effect-duplicate" : "effect-performed", work.workId, at, { effectKey, source: "executor" });
        this.persist();
        const done = this.complete(caller, work.workId);
        if (!done.ok) return { ok: false, code: done.code, detail: done.detail };
        processed += 1;
      } else {
        const receipt: EffectRecord = Object.freeze({
          effectKey,
          workId: work.workId,
          effectKind: work.effectKind,
          outcome: "refused",
          at,
          refusal: { code: outcome.code, detail: outcome.detail },
        });
        this.effects.set(effectKey, receipt);
        this.journalAppend("effect-refused", work.workId, at, { effectKey, code: outcome.code });
        this.persist();
        const failedOnce = this.fail(caller, work.workId, { code: outcome.code, detail: outcome.detail });
        if (!failedOnce.ok) return { ok: false, code: failedOnce.code, detail: failedOnce.detail };
        failed += 1;
      }
    }
    return { ok: true, processed, failed, remaining: this.remainingFor(caller) };
  }

  /** The completion door's remaining-due count for the caller's tenant. */
  private remainingFor(caller: OpsWorkerCaller): number {
    const now = this.now();
    return this.tenantWorks(caller.tenant).filter((work) => isWorkDueFor(caller, work, now)).length;
  }

  /** Tenant-scoped read of one work item (E8 tamper + R20 refusals). */
  readWork(caller: OpsCaller, workId: string): { ok: true; work: WorkRecord } | { ok: false; code: WorkerDoorRefusalCode; detail: string } {
    const stored = this.works.get(workId);
    if (stored === undefined) return { ok: false, code: "unknown-work", detail: `no work ${workId} was ever enqueued` };
    const isolation = checkTenantIsolation(caller, stored);
    if (!isolation.ok) return { ok: false, code: "cross-tenant", detail: `subject ${String(caller.subject)} of tenant ${String(isolation.requestTenant)} cannot read work of tenant ${String(isolation.resourceTenant)} (R20)` };
    if (!workIdentityVerifies(stored)) return { ok: false, code: "tampered-work", detail: `work ${workId} no longer matches its content-addressed identity (E8)` };
    return { ok: true, work: stored };
  }

  /** Tenant-scoped listing of work items (open order). */
  listWork(caller: OpsCaller): readonly WorkRecord[] {
    return this.tenantWorks(caller.tenant);
  }

  /** The append-only journal view (E10 — the ops evidence surface). */
  journalOf(): readonly WorkJournalEntry[] {
    return Object.freeze([...this.journal]);
  }

  /** The effect receipt ledger view (E10). */
  effectsOf(): readonly EffectRecord[] {
    return Object.freeze([...this.effects.values()]);
  }

  /** Journal freshness (E10 — the LIVENESS read the health service binds). */
  freshness(): { readonly entries: number; readonly lastEntryAt: number | undefined } {
    const last = this.journal[this.journal.length - 1];
    return { entries: this.journal.length, lastEntryAt: last?.at };
  }

  /** The current content-addressed service document (persistence view). */
  document(): OpsWorkerDocument {
    const works = this.tenantAllWorks();
    const effects = [...this.effects.values()];
    return Object.freeze({
      stateDigest: opsWorkerDocumentDigestOf({ revision: this.revision, works, effects, journal: this.journal }),
      revision: this.revision,
      works,
      effects,
      journal: this.journal,
    });
  }

  /**
   * Restores the whole document from the store (E6 snapshot restore).
   * The layered verification lives in worker-restore.ts: the document's
   * content address, every work item's identity chain, every effect
   * receipt's key and the journal chain are re-verified — a tampered
   * document is a typed refusal, never restored (E8). Restore is atomic:
   * nothing is adopted unless everything verifies.
   */
  restore(): WorkerRestoreResult {
    const verification = verifyRestorableDocument(this.ports.store.load());
    if (!verification.ok) return verification;
    const loaded = verification.document;
    this.works.clear();
    for (const work of loaded.works) this.works.set(work.workId, work);
    this.effects.clear();
    for (const receipt of loaded.effects) this.effects.set(receipt.effectKey, receipt);
    this.journal = loaded.journal;
    this.revision = loaded.revision;
    this.journalAppend("restored", "", this.now(), { works: loaded.works.length, effects: loaded.effects.length });
    this.persist();
    return { ok: true, works: this.works.size, effects: this.effects.size, journalLength: this.journal.length };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private now(): number {
    return this.ports.clock.now();
  }

  private digestOf(value: unknown): string {
    return opsDigestOf(value);
  }

  private effectKeyOf(work: WorkRecord): string {
    return opsEffectKeyOf({ workId: work.workId, effectKind: work.effectKind, payloadDigest: work.payloadDigest });
  }

  private tenantWorks(tenant: OpsCaller["tenant"]): readonly WorkRecord[] {
    return this.tenantAllWorks().filter((work) => checkTenantIsolation({ tenant }, work).ok);
  }

  private tenantAllWorks(): readonly WorkRecord[] {
    return [...this.works.values()].sort(
      (a, b) => a.enqueuedAt - b.enqueuedAt || (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0),
    );
  }

  private journalAppend(kind: WorkJournalEntryKind, workId: string, at: number, facts: Readonly<Record<string, unknown>>): void {
    this.journal = appendJournalEntry(this.journal, { kind, workId, at, facts });
  }

  private persist(): void {
    this.revision += 1;
    this.ports.store.save(this.document());
  }
}
