/**
 * THE LAB WORKBENCH STORE (the single UI-state owner): wraps the pure
 * reducer with a subscription surface for React. The store instance is
 * the ONE owner of `LabState` (E1); components never mutate state, they
 * dispatch actions. `refresh()` pulls one authoritative snapshot through
 * the `LabDataPort`; `dispatchCommand()` sends ONE typed intent through
 * the `LabCommandPort` and appends the outcome to the command log —
 * accepted receipts AND typed refusals are both visible states, never
 * silent (E8/E11).
 *
 * Async/stateful documentation (spec/worker-contract.md), this class:
 * - Mutable state owner: THIS store instance (single `#state`).
 * - Event order: listeners fire after each committed transition, in
 *   subscription order; dispatch during a listener is queued (re-entrancy
 *   is serialized, so no transition is lost or interleaved).
 * - Idempotency: actions are values; `refreshed` replaces the snapshot
 *   wholesale, `command-receipt` appends (the log is append-only, E10).
 * - Retry/cancellation: no hidden retries. A refused command stays
 *   refused until a corrected intent is dispatched; a `load-failed` stays
 *   until the host pulls again.
 */

import type {
  LabCommandIntent,
  LabCommandLogEntry,
  LabCommandPort,
  LabCommandReceipt,
  LabDataPort,
} from "./ports.ts";
import { initialLabState, projectState, reduce } from "./lab-actions.ts";
import type { LabAction, LabState } from "./lab-actions.ts";
import type { LabWorkbenchViewModel } from "./view/lab-view.ts";

/** Subscription handle; call to unsubscribe. */
export type Unsubscribe = () => void;

/** The port bundle the workbench needs (host-injected). */
export interface LabWorkbenchPorts {
  readonly data: LabDataPort;
  readonly command: LabCommandPort;
}

export interface LabStore {
  /** Current projected view model (fresh projection per call). */
  view(): LabWorkbenchViewModel;
  /** Current raw state (for tests/evidence). */
  state(): LabState;
  /** Apply one action; notifies listeners exactly once. */
  dispatch(action: LabAction): void;
  /** Pull one authoritative snapshot through the data port (typed outcome). */
  refresh(): void;
  /** Dispatch one typed command intent; append its outcome (E8/E10). */
  dispatchCommand(intent: LabCommandIntent): LabCommandReceipt;
  /** Subscribe to committed transitions. */
  subscribe(listener: () => void): Unsubscribe;
}

/**
 * Create the Lab workbench store from the FIRST authoritative snapshot
 * (the caller loads it through the port before constructing; the store
 * never renders an invented state — E11: no fabricated data).
 */
export function createLabStore(
  initialData: Parameters<typeof initialLabState>[0],
  ports: LabWorkbenchPorts,
): LabStore {
  let state: LabState = initialLabState(initialData);
  const listeners = new Set<() => void>();
  let dispatching = false;
  const queued: LabAction[] = [];

  function commit(action: LabAction): void {
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
      const result = ports.data.load();
      if (result.ok) {
        this.dispatch({ type: "refreshed", data: result.data });
      } else {
        this.dispatch({ type: "load-failed", detail: result.detail });
      }
    },
    dispatchCommand(intent) {
      const receipt = ports.command.dispatch(intent);
      const entry: LabCommandLogEntry = { intent, receipt };
      this.dispatch({ type: "command-receipt", entry });
      return receipt;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
