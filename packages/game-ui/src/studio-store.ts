/**
 * THE STUDIO STORE (the single UI-state owner): wraps the pure reducer
 * with a subscription surface for React. The store instance is the ONE
 * owner of `StudioState` (E1); components never mutate state, they
 * dispatch actions. `refresh()` pulls one authoritative snapshot through
 * the `StudioDataPort` and records the outcome as typed actions — success
 * and failure are both visible states, never silent (E11).
 *
 * Async/stateful documentation (spec/worker-contract.md), this class:
 * - Mutable state owner: THIS store instance (single `#state`).
 * - Event order: listeners fire after each committed transition, in
 *   subscription order; dispatch during a listener is queued (re-entrancy
 *   is serialized, so no transition is lost or interleaved).
 * - Idempotency: actions are values; `refreshed` replaces the snapshot
 *   wholesale (idempotent per snapshot), `record-operations` appends
 *   (timeline is append-only, E10).
 * - Stale results: projected `stale` flags surface epoch-advancement;
 *   nothing is dropped silently.
 * - Retry/cancellation: no hidden retries. A `load-failed` stays until the
 *   host dispatches another `refresh()`.
 */

import type { StudioDataPort } from "./ports.ts";
import {
  initialStudioState,
  projectState,
  reduce,
} from "./studio-actions.ts";
import type {
  GameStudioViewModel,
  StudioDataSnapshot,
} from "./view/studio-view.ts";
import type { StudioAction, StudioState } from "./studio-actions.ts";

/** Subscription handle; call to unsubscribe. */
export type Unsubscribe = () => void;

export interface StudioStore {
  /** Current projected view model (fresh projection per call). */
  view(): GameStudioViewModel;
  /** Current raw state (for tests/evidence). */
  state(): StudioState;
  /** Apply one action; notifies listeners exactly once. */
  dispatch(action: StudioAction): void;
  /** Pull one authoritative snapshot through the port (typed outcome). */
  refresh(): void;
  /** Subscribe to committed transitions. */
  subscribe(listener: () => void): Unsubscribe;
}

/**
 * Create the studio store from the FIRST authoritative snapshot (the
 * caller loads it through the port before constructing; the store never
 * renders an invented state — E11: no fabricated data).
 */
export function createStudioStore(
  initialData: StudioDataSnapshot,
  port: StudioDataPort,
): StudioStore {
  let state: StudioState = initialStudioState(initialData);
  const listeners = new Set<() => void>();
  let dispatching = false;
  const queued: StudioAction[] = [];

  function commit(action: StudioAction): void {
    const next = reduce(state, action);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    view() {
      return projectState(state);
    },
    state() {
      return state;
    },
    dispatch(action) {
      if (dispatching) {
        queued.push(action);
        return;
      }
      dispatching = true;
      try {
        commit(action);
        while (queued.length > 0) {
          const next = queued.shift();
          if (next !== undefined) commit(next);
        }
      } finally {
        dispatching = false;
      }
    },
    refresh() {
      const result = port.load();
      if (result.ok) {
        this.dispatch({ type: "refreshed", data: result.data });
      } else {
        this.dispatch({ type: "load-failed", detail: result.detail });
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
