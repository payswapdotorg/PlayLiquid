/**
 * STUDIO PORTS (pure seams): how the Game Studio obtains authoritative
 * data. The UI never imports implementation modules (matrix rule) and
 * never performs IO itself — the HOST wires a `StudioDataPort` that pulls
 * read models from the authoritative systems (package registry, runtime
 * kernel, broker, tool fabric runtime). Everything crossing these seams
 * is already typed authoritative contract data (E5).
 *
 * Async/stateful documentation (spec/worker-contract.md), this seam set:
 * - Mutable state owner: the port IMPLEMENTATION owns its sourcing; the
 *   studio store owns the projected UI state. Neither rewrites history:
 *   timelines are append-only (E10).
 * - Data flow: pull-only `load()` snapshots; there is no second command
 *   path — user actions that mutate game state go through the
 *   authoritative runtimes, never through this UI package.
 * - Long-running work: tool jobs are durable/queued/resumable in the Tool
 *   Fabric runtime (E6); the studio only READS their snapshots.
 * - Retry/cancellation: a failed `load()` surfaces as a typed failure the
 *   store records verbatim; the host decides retry policy. Nothing here
 *   retries silently.
 */

import type { StudioDataSnapshot } from "./view/studio-view.ts";

/** Result of pulling one authoritative snapshot. */
export type StudioDataResult =
  | { readonly ok: true; readonly data: StudioDataSnapshot }
  | { readonly ok: false; readonly code: "load-failed"; readonly detail: string };

/**
 * The one data seam of the Game Studio foundation. Synchronous pull: the
 * host returns already-materialized read models (its kernels/registries
 * are in-memory today; a remote host would resolve the same shapes before
 * answering — the UI contract does not change).
 */
export interface StudioDataPort {
  load(): StudioDataResult;
}
