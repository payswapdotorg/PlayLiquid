# The durable worker semantics (services/ops, PL-044)

The durable worker runtime (`services/ops/src/worker.ts`,
`DurableWorkerRuntime`) is a generic durable work queue over
content-addressed work documents — the arena-integration-runtime
durability idiom (PL-031) generalized. This doc states the contract the
tests prove; the crash matrix below is the E6 evidence.

## The model

- **Work is content-addressed.** A work item's id derives from its
  CONTENT KEY — (tenant, kind, effect kind, payload). Re-submission of
  the same content resumes the SAME work item as an idempotent duplicate
  receipt that grows nothing (E10). Bookkeeping (who enqueued, when) is
  excluded from the key on purpose.
- **Every state advance persists first.** The whole content-addressed
  service document (works, effect receipts, the journal) is written
  through the injected `WorkerStorePort` BEFORE the next step happens.
  A crash at any point therefore resumes to the last durable state
  (`restore()` adopts only documents that fully verify — tampered
  content is a typed refusal, E8).
- **Effects are exactly-once under crash-resume as a composition**:
  - the *runtime leg*: an effect with a durably recorded receipt is
    never re-invoked;
  - the *executor leg*: the host-injected `WorkerEffectsPort` dedupes by
    a stable `effectKey` — the same content key for every retry of one
    logical effect — so a crash between invocation and receipt
    re-invokes and receives a `duplicate: true` receipt.
- **Leases are heartbeat-renewed and expiry-reclaimable.** An expired
  lease is reclaimed by the next claim (journal `lease-expired` +
  `lease-reclaimed`); a stale worker's completion of a reclaimed lease is
  a typed refusal — the first effective completion stands (E10).
- **Terminal states are immutable (E10).** Completions/failures of
  terminal work are honest duplicate receipts, never re-effects.
- **The journal is append-only and hash-chained (E10).** Every
  transition appends one entry; each entry's digest covers its content
  plus the previous entry's digest, and the whole journal is part of the
  content-addressed service document. Edits break the chain and are
  typed `broken-journal` refusals on restore.
- **Tenant isolation (R20)** at every door via platform-contracts'
  `checkTenantIsolation` — cross-tenant access is a typed refusal.

## The crash model (how the tests inject faults)

A fault is injected at one DURABLE point (a store save or an effects
invocation), the throw propagates, and the runtime instance is
ABANDONED — an accurate model of process death because every mutation
is persisted through the store port before anything else happens, so
only the store's durable content matters. The resume is a FRESH runtime
over the SAME store and the SAME counting executor (the executor models
the durable external side effect: it survives the process death and
dedupes by the stable effect key). No real timers are used — the clock
is injected and the tests advance it explicitly.

## The F1–F8 fault rows (E6 evidence, by name)

After 3 enqueues, one drive pass saves at: #4 lease, #5 WAL intent, #6
effect receipt, #7 completion, #8 next item's lease.

| Row | Fault point | Resumed state | Exactly-once proof |
| --- | --- | --- | --- |
| **F1** — crash on the LAST enqueue save | save #3 (item 3 never durable) | the durable truth holds items 1–2; the resume re-submits the same content as a FRESH item | one real invocation per item, zero duplicates |
| **F2** — crash after the lease is persisted, before the effect intent | save #5 | the lease (save #4) is durable; the same worker resumes its OWN lease (`lease-reclaimed`) | one real invocation per item, zero duplicates |
| **F3** — crash after the WAL intent is persisted, before the executor is invoked | attempt #1 | the WAL intent stands durably, no effect ran; the resume re-invokes for real | one real invocation per item, zero duplicates |
| **F4** — crash AFTER the real effect, BEFORE its receipt is persisted | invocation #2 | item 1 fully durable; item 2's effect ran but its receipt is lost; the resume re-invokes and the executor answers with the keyed duplicate (`effect-duplicate`, source executor) | one real invocation per item; the duplicate is the executor's idempotent receipt — THE exactly-once composition |
| **F5** — crash after the effect receipt is persisted, before completion | save #7 | the receipt (save #6) is durable; the resume SKIPS the executor — the ledger-skip path (`effect-duplicate`, source ledger) — and completes | zero re-invocations of the executor |
| **F6** — crash mid-queue after the first completion | save #8 | item 1 completed durably; items 2–3 resume from their durable queued state, no loss | one real invocation per item, zero duplicates |
| **F7** — crash holding a lease, clock passes the TTL, a DIFFERENT worker reclaims | save #5 + TTL | the expired lease is reclaimed by `worker-2` (`lease-expired` + `lease-reclaimed` journaled) | one real invocation per item, zero duplicates |
| **F8** — crash holding a lease, clock passes the TTL, the SAME worker restarts and re-claims | save #5 + TTL | its own expired lease is re-claimed by the same worker id (the restart path — own-lease due even after expiry) | one real invocation per item, zero duplicates |

Rows whose crash PRECEDES the first invocation (F1/F2/F3/F6/F7/F8) must
show ZERO duplicate invocations: the resume performs the effect once,
for real. Only F4 — the fault point after a real invocation but before
its receipt became durable — requires the keyed-duplicate path. F5
proves the complement: a durable receipt means the runtime NEVER
re-invokes.

## What the tests also prove around the matrix

- **E9 determinism**: the same enqueue+drive sequence produces the
  identical journal, identical state digest and identical effect set,
  run twice.
- **E10 idempotency**: re-enqueue of decided content is a duplicate
  receipt; a completed item's completion is a duplicate receipt;
  re-driving never re-effects.
- **E8 typed refusals that mutate nothing**: invalid work, cross-tenant
  doors, lease refusals (heartbeat on unleased work, foreign
  lease-holder, expired lease), the executor's own refusal code surfaced
  verbatim.
- **Restore verification**: naively tampered documents, payload edits,
  payload edits with recomputed digests (the workId pins the content
  key) and edited journal entries are all typed refusals, never
  restored; an honest document restores atomically and appends the
  `restored` record.

## Honest limits (E11)

The runtime is an in-process service: the "process death" is modeled by
abandoning the instance with a throwing port, the "disk" is the injected
store port (in-memory in tests), and the "external side effect" is the
injected effects port. No real processes, sockets or files are involved.
A real host binds the same three ports to real infrastructure — that is
the entire seam.
