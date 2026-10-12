/**
 * LEASE SEMANTICS of the durable worker runtime (PL-044) — the pure
 * claim/expiry/reclaim fold, extracted from worker.ts for file hygiene
 * (one concern per file; no import cycles: this module only imports
 * leaf-ward siblings + the platform tenancy oracle).
 *
 * The runtime instance remains the single mutable-state owner (E1): every
 * function here is a PURE classification/construction over records. The
 * claim model (E6):
 *
 * - QUEUED work is due for any worker of the owning tenant;
 * - a lease held by the CALLER'S OWN worker id is due (a restarted
 *   process re-claiming its own lease — the crash-resume path);
 * - a lease held by ANOTHER worker is due only once it has EXPIRED
 *   (now >= expiresAt) — then any worker of the tenant may RECLAIM it;
 * - terminal work is never due (E10: terminals are immutable).
 *
 * Lease expiry refusals are typed (`lease-expired`) and the first
 * effective completion stands: a stale worker completing a lease that was
 * reclaimed underneath it is refused, never re-effected.
 *
 * Purity: no IO, no clock reads (instants arrive as values), no globals.
 */

import { checkTenantIsolation } from "../../../packages/platform-contracts/src/index.ts";
import { opsLeaseDigestOf, opsLeaseIdOf } from "./digest.ts";
import type {
  LeaseRecord,
  OpsWorkerCaller,
  WorkRecord,
  WorkerDoorRefusalCode,
} from "./worker-ports.ts";

/** Why one work item is (or is not) claimable by one caller at one instant. */
export type LeaseDue = "queued" | "own-lease" | "expired-lease" | "not-due";

/** Classifies the claim state of `work` for `caller` at `now` (pure). */
export function leaseDueOf(caller: OpsWorkerCaller, work: WorkRecord, now: number): LeaseDue {
  if (work.state === "queued") return "queued";
  if (work.state !== "leased" || work.lease === undefined) return "not-due";
  if (work.lease.workerId === caller.workerId) return "own-lease";
  return now >= work.lease.expiresAt ? "expired-lease" : "not-due";
}

/** True when `caller` may claim `work` at `now` (the due fold). */
export function isWorkDueFor(caller: OpsWorkerCaller, work: WorkRecord, now: number): boolean {
  const due = leaseDueOf(caller, work, now);
  return due !== "not-due";
}

/** Builds one fresh lease value (content-addressed lease id, E9). */
export function leaseFor(
  caller: OpsWorkerCaller,
  work: WorkRecord,
  attempt: number,
  now: number,
  ttlMs: number,
): LeaseRecord {
  return {
    leaseId: opsLeaseIdOf(opsLeaseDigestOf({ workId: work.workId, workerId: caller.workerId, leasedAt: now, attempt })),
    workerId: caller.workerId,
    attempt,
    leasedAt: now,
    expiresAt: now + ttlMs,
    heartbeats: 0,
    lastHeartbeatAt: now,
  };
}

/** The typed lease-expiry refusal shared by the heartbeat/complete/fail doors. */
export function expiredLeaseRefusal(
  lease: LeaseRecord,
  workId: string,
  now: number,
): { readonly ok: false; readonly code: "lease-expired"; readonly detail: string } {
  return {
    ok: false,
    code: "lease-expired",
    detail: `lease ${lease.leaseId} of work ${workId} expired at ${String(lease.expiresAt)} (now ${String(now)}) — reclaim and re-drive (idempotent effects make this safe)`,
  };
}

/** One heartbeat's renewed lease value (a pure derivation, E9). */
export function renewedLease(lease: LeaseRecord, now: number, ttlMs: number): LeaseRecord {
  return { ...lease, heartbeats: lease.heartbeats + 1, lastHeartbeatAt: now, expiresAt: now + ttlMs };
}

/** The result of checking that `caller` holds the lease of `workId`. */
export type HeldLeaseCheck =
  | { readonly ok: true; readonly work: WorkRecord }
  | { readonly ok: false; readonly code: WorkerDoorRefusalCode; readonly detail: string };

/**
 * Checks the caller's standing over one work item (pure): the work must
 * exist, belong to the caller's tenant (R20 — the platform tenancy oracle,
 * consumed never re-implemented), and not be leased by a DIFFERENT worker.
 * Expiry is checked separately by the doors that need it (the holder of an
 * expired own lease may still be refused downstream).
 */
export function heldLeaseCheck(
  caller: OpsWorkerCaller,
  workId: string,
  stored: WorkRecord | undefined,
): HeldLeaseCheck {
  if (stored === undefined) {
    return { ok: false, code: "unknown-work", detail: `no work ${workId} was ever enqueued` };
  }
  const isolation = checkTenantIsolation(caller, stored);
  if (!isolation.ok) {
    return {
      ok: false,
      code: "cross-tenant",
      detail: `subject ${String(caller.subject)} of tenant ${String(isolation.requestTenant)} cannot drive work of tenant ${String(isolation.resourceTenant)} (R20)`,
    };
  }
  if (stored.state === "leased" && stored.lease !== undefined && stored.lease.workerId !== caller.workerId) {
    return {
      ok: false,
      code: "lease-holder",
      detail: `work ${workId} is leased by worker ${stored.lease.workerId}, not ${caller.workerId}`,
    };
  }
  return { ok: true, work: stored };
}
