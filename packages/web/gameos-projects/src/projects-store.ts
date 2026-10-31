/**
 * THE PROJECTS WORKBENCH STORE (the single UI-state owner): wraps the
 * pure reducer with a subscription surface for React. The store instance
 * is the ONE owner of `ProjectsState` (E1); components never mutate
 * state, they dispatch actions. `refresh()` pulls one authoritative
 * snapshot through the `ProjectsDataPort`; `dispatchCommand()` sends
 * ONE typed intent through the `ProjectsCommandPort` and appends the
 * outcome to the command log — accepted receipts AND typed refusals are
 * both visible states, never silent (E8/E11).
 *
 * Async/stateful documentation (spec/worker-contract.md), this store:
 * - Mutable state owner: THIS store instance (single `#state`).
 * - Event order: listeners fire after each committed transition, in
 *   subscription order; a dispatch during a listener is queued
 *   (re-entrancy is serialized, so no transition is lost or
 *   interleaved).
 * - Command order: `dispatchCommand` is ASYNC (the command port crosses
 *   a service); concurrent dispatches serialize through one queue, so
 *   receipts append to the log in DISPATCH order — the log stays
 *   append-only and ordered (E10).
 * - Admission (E8/R20): malformed intents and cross-tenant transitions
 *   are refused by the STORE, typed, BEFORE the command port is called.
 * - Idempotency: actions are values; `refreshed` replaces the snapshot
 *   wholesale, `command-receipt` appends.
 * - Retry/cancellation: no hidden retries. A refused command stays
 *   refused until a corrected intent is dispatched; a `load-failed`
 *   stays until the host pulls again.
 */

import type {
  ProjectsCommandIntent,
  ProjectsCommandLogEntry,
  ProjectsCommandPort,
  ProjectsCommandReceipt,
  ProjectsDataPort,
  ProjectsLoadResult,
} from "./ports.ts";
import { projectsIntentProblem } from "./ports.ts";
import { initialProjectsState, projectState, reduce } from "./projects-actions.ts";
import type { ProjectsAction, ProjectsState } from "./projects-actions.ts";
import type {
  ProjectsDataSnapshot,
  ProjectsWorkbenchViewModel,
} from "./view/projects-view.ts";

/** Subscription handle; call to unsubscribe. */
export type Unsubscribe = () => void;

/** The port bundle the workbench needs (host-injected). */
export interface ProjectsWorkbenchPorts {
  readonly data: ProjectsDataPort;
  readonly command: ProjectsCommandPort;
}

export interface ProjectsStore {
  /** Current projected view model (fresh projection per call). */
  view(): ProjectsWorkbenchViewModel;
  /** Current raw state (for tests/evidence). */
  state(): ProjectsState;
  /** Apply one action; notifies listeners exactly once. */
  dispatch(action: ProjectsAction): void;
  /** Pull one authoritative snapshot through the data port (typed outcome). */
  refresh(): void;
  /**
   * Dispatch one typed command intent (serialized, async); append its
   * outcome to the append-only log (E8/E10). Refuses malformed intents
   * and cross-tenant transitions BEFORE any domain call.
   */
  dispatchCommand(intent: ProjectsCommandIntent): Promise<ProjectsCommandReceipt>;
  /** Subscribe to committed transitions. */
  subscribe(listener: () => void): Unsubscribe;
}

/**
 * The store-side R20 guard: when the intent's pull request is visible in
 * the snapshot AND belongs to another tenant, the typed cross-tenant
 * refusal the store returns instead of calling the domain (the guard
 * mirrors the selection refusal vocabulary, R20/E8). Unknown pull
 * requests are forwarded — the authoritative door owns their admission.
 */
function crossTenantTransitionRefusal(
  data: ProjectsDataSnapshot,
  intent: ProjectsCommandIntent,
): ProjectsCommandReceipt | null {
  for (const detail of data.details.values()) {
    for (const pr of detail.pullRequests) {
      if (String(pr.prId) !== String(intent.prId)) continue;
      if (pr.updatedByOwnerTenant === data.viewer.tenantId) return null;
      return {
        ok: false,
        code: "cross-tenant",
        detail: `pull request ${String(intent.prId).slice(0, "sha256:".length + 8)}… belongs to tenant ${String(pr.updatedByOwnerTenant)}; viewer is ${String(data.viewer.tenantId)}`,
      };
    }
  }
  return null;
}

/**
 * Create the projects workbench store from the FIRST authoritative
 * snapshot (the caller loads it through the port before constructing;
 * the store never renders an invented state — E11: no fabricated data).
 */
export function createProjectsStore(
  initialData: ProjectsDataSnapshot,
  ports: ProjectsWorkbenchPorts,
): ProjectsStore {
  let state: ProjectsState = initialProjectsState(initialData);
  const listeners = new Set<() => void>();
  let dispatching = false;
  const queued: ProjectsAction[] = [];
  // The serialized async command queue: one in-flight port call at a
  // time, outcomes appended in dispatch order.
  let commandTail: Promise<unknown> = Promise.resolve();

  function commit(action: ProjectsAction): void {
    const next = reduce(state, action);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function dispatch(action: ProjectsAction): void {
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
  }

  function appendOutcome(intent: ProjectsCommandIntent, receipt: ProjectsCommandReceipt): void {
    const entry: ProjectsCommandLogEntry = { intent, receipt };
    dispatch({ type: "command-receipt", entry });
  }

  function refresh(): void {
    const result: ProjectsLoadResult = ports.data.load();
    if (result.ok) {
      dispatch({ type: "refreshed", data: result.data });
    } else {
      dispatch({ type: "load-failed", detail: result.detail });
    }
  }

  function dispatchCommand(intent: ProjectsCommandIntent): Promise<ProjectsCommandReceipt> {
    const run = async (): Promise<ProjectsCommandReceipt> => {
      // E8: a malformed intent never reaches the domain seam.
      const problem = projectsIntentProblem(intent);
      if (problem !== null) {
        const receipt: ProjectsCommandReceipt = { ok: false, code: "invalid-intent", detail: problem };
        appendOutcome(intent, receipt);
        return receipt;
      }
      // R20: a cross-tenant transition is refused before any domain call.
      const refusal = crossTenantTransitionRefusal(state.data, intent);
      if (refusal !== null) {
        appendOutcome(intent, refusal);
        return refusal;
      }
      const receipt = await ports.command.dispatch(intent);
      appendOutcome(intent, receipt);
      return receipt;
    };
    const outcome = commandTail.then(run, run);
    commandTail = outcome.then(
      () => undefined,
      () => undefined,
    );
    return outcome;
  }

  return {
    view() {
      return projectState(state);
    },
    state() {
      return state;
    },
    dispatch,
    refresh,
    dispatchCommand,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
