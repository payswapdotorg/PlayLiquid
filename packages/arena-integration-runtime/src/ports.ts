/**
 * INJECTED PORTS of the Arena runtime service (PL-031).
 *
 * The service owns mutable domain state (E1): the tenant-scoped escalation
 * registry, the case table, the send/ingest receipt ledgers (the runtime is
 * the receipt-store owner arena-integration's oracles expect — PL-031 named
 * there) and the authorization audit log. EVERYTHING it must NOT own as
 * ambient authority arrives through these seams, each with a deterministic
 * in-memory fake (fakes.ts):
 *
 * - {@link ArenaRuntimeClockPort} — caller-programmed time (never Date.now);
 * - {@link ArenaRuntimeStore} — whole-document persistence (E6: the durable
 *   store is the host's to wire);
 * - {@link ArenaRuntimePorts.policy} — the Lab usage-rule policy (reused
 *   AS-IS from arena-integration's `ArenaAuthorizationPolicy` port; the
 *   runtime never invents a second policy authority);
 * - {@link ArenaRuntimePorts.transport} — the provider-neutral wire port
 *   (reused AS-IS from arena-integration's `ArenaTransport`; the
 *   deterministic in-memory fake is the only implementation in repo — real
 *   providers are host-side, E11).
 *
 * Async/stateful discipline (spec/worker-contract.md), binding for this
 * package: mutable state owner = the ArenaRuntimeService instance
 * (service.ts) — persisted through {@link ArenaRuntimeStore} snapshots;
 * command admission = the pure intake oracle (intake.ts) over caller-supplied
 * time + owned state; event order = append-only, admission order; idempotency
 * keys = the case content key (E10 duplicate receipts), the send key
 * (endpoint + request payload digest) and the ingest key (request payload +
 * response digest) — all arena-integration oracles; stale-result rule = the
 * first effective receipt stands, collisions are typed refusals (E8);
 * replay/resume = the content-addressed service document (restore refuses
 * tampered content); retry/cancellation = wire retries re-submit the SAME
 * envelope (the Arena side dedupes by content key) and refused drives mutate
 * nothing.
 *
 * Pure types only.
 */

import type { ArenaAuthorizationPolicy, ArenaTransport } from "@playliquid/arena-integration";
import type { ArenaAuthorizationAuditLog, ArenaSendReceipt } from "@playliquid/arena-integration";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import type { ArenaEscalationCase, RegisteredEscalationSource } from "./records.ts";

/** Service-level time authority (mirrors the house ClockPort shape). */
export interface ArenaRuntimeClockPort {
  now(): number;
}

/** One persisted, content-addressed snapshot of the whole service state (E6). */
export interface ArenaRuntimeDocument {
  /** Content address of this document (digest.ts discipline). */
  readonly stateDigest: string;
  readonly sources: readonly RegisteredEscalationSource[];
  readonly cases: readonly ArenaEscalationCase[];
  readonly sendLedger: readonly ArenaSendReceipt[];
  readonly auditLog: ArenaAuthorizationAuditLog;
}

/** Write/read port for service-document persistence (E6). */
export interface ArenaRuntimeStore {
  save(document: ArenaRuntimeDocument): void;
  load(): ArenaRuntimeDocument | undefined;
}

/** The port bundle the Arena runtime service needs (host-injected). */
export interface ArenaRuntimePorts {
  readonly clock: ArenaRuntimeClockPort;
  readonly store: ArenaRuntimeStore;
  readonly policy: ArenaAuthorizationPolicy;
  readonly transport: ArenaTransport;
}

/** Who is calling (tenant + subject claim; identity authority is elsewhere). */
export interface ArenaRuntimeCaller {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}
