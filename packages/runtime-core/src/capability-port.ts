/**
 * THE CAPABILITY PORT — the runtime core's ONLY window onto the Capability
 * Broker (lock rule 4: the broker is THE runtime authorization boundary).
 *
 * SEAM STATUS (frozen architecture, do not widen from inside a Work Order):
 *
 * - The Capability Broker itself is Work Order PL-026 (avatar-runtime +
 *   capability-broker) and is NOT implemented here. This module defines
 *   only the pure CLIENT-SIDE port the kernel calls; it deliberately ships
 *   no broker implementation, no grant minting, no ledger authority, and no
 *   second permission path. Building any of those here would create a
 *   PARALLEL AUTHORITY and violate the architecture lock.
 * - The port consumes `@playliquid/runtime-contracts` types exclusively
 *   (ActionRequest / ActionResolution — capability.ts), so the seam is
 *   typed by the already-frozen protocol, not by a local re-definition.
 *   When PL-026 lands, its broker implements this port (or the kernel is
 *   bound to the broker's equivalent surface through the contracts) with
 *   zero protocol change.
 *
 * Async/stateful documentation (spec/worker-contract.md), this seam:
 *
 * - Mutable state owner: the BROKER owns grants, the budget ledger and
 *   revocation. The kernel passes a read-only {@link CapabilityPortContext}
 *   (session id, epoch, tick) and receives an immutable resolution. The
 *   kernel never caches grants and never re-derives broker decisions.
 * - Command admission: a `granted` resolution still has to pass
 *   `admitCommand` (runtime-contracts) inside the kernel — the broker does
 *   not bypass the canonical command path (E2).
 * - Stale-result rule: resolutions produced under an older session epoch
 *   (before a reset/restore) are stale by the epoch rule
 *   (idempotency.ts `applyStaleResultRule`); a compliant broker must
 *   additionally refuse grants whose epoch is not the current one (see
 *   `grant-epoch-stale` in capability.ts).
 * - Idempotency: the idempotency key travels inside the ActionRequest and
 *   is honored by the KERNEL's idempotency table after admission; the
 *   broker-side ledger is budget accounting, not request dedup.
 */

import type {
  ActionRequest,
  ActionResolution,
  SessionEpoch,
  SessionId,
  Tick,
} from "@playliquid/runtime-contracts";

/** Read-only kernel view handed to the broker with each evaluation. */
export interface CapabilityPortContext {
  readonly sessionId: SessionId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
}

/**
 * The port. Synchronous and pure-by-contract: implementations must be
 * deterministic given (request, context) and must not mutate kernel state
 * (they may update their OWN broker-owned tables, e.g. budgets).
 */
export interface CapabilityPort {
  evaluate<P>(request: ActionRequest<P>, context: CapabilityPortContext): ActionResolution<P>;
}
