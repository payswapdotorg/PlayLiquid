/**
 * THE COMMUNITY WORKBENCH STORE (the single UI-state owner): wraps the
 * pure reducer with a subscription surface for React. The store instance
 * is the ONE owner of `CommunityState` (E1); components never mutate
 * state, they dispatch actions. `refresh()` pulls one authoritative
 * snapshot through the `CommunityDataPort`; `dispatchCommand()` sends
 * ONE typed intent through the `CommunityCommandPort` and appends the
 * outcome to the command log — accepted receipts AND typed refusals are
 * both visible states, never silent (E8/E11).
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
  CommunityCommandIntent,
  CommunityCommandLogEntry,
  CommunityCommandPort,
  CommunityCommandReceipt,
  CommunityDataPort,
} from "./ports.ts";
import { initialCommunityState, projectState, reduce } from "./community-actions.ts";
import type { CommunityAction, CommunityState } from "./community-actions.ts";
import type { CommunityWorkbenchViewModel } from "./view/community-view.ts";

/** Subscription handle; call to unsubscribe. */
export type Unsubscribe = () => void;

/** The port bundle the workbench needs (host-injected). */
export interface CommunityWorkbenchPorts {
  readonly data: CommunityDataPort;
  readonly command: CommunityCommandPort;
}

export interface CommunityStore {
  /** Current projected view model (fresh projection per call). */
  view(): CommunityWorkbenchViewModel;
  /** Current raw state (for tests/evidence). */
  state(): CommunityState;
  /** Apply one action; notifies listeners exactly once. */
  dispatch(action: CommunityAction): void;
  /** Pull one authoritative snapshot through the data port (typed outcome). */
  refresh(): void;
  /** Dispatch one typed command intent; append its outcome (E8/E10). */
  dispatchCommand(intent: CommunityCommandIntent): CommunityCommandReceipt;
  /** Subscribe to committed transitions. */
  subscribe(listener: () => void): Unsubscribe;
}

/**
 * Create the Community workbench store from the FIRST authoritative
 * snapshot (the caller loads it through the port before constructing;
 * the store never renders an invented state — E11: no fabricated data).
 */
export function createCommunityStore(
  initialData: Parameters<typeof initialCommunityState>[0],
  ports: CommunityWorkbenchPorts,
): CommunityStore {
  let state: CommunityState = initialCommunityState(initialData);
  const listeners = new Set<() => void>();
  let dispatching = false;
  const queued: CommunityAction[] = [];

  function commit(action: CommunityAction): void {
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
      const entry: CommunityCommandLogEntry = { intent, receipt };
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
