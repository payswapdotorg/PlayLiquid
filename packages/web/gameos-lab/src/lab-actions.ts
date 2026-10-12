/**
 * LAB WORKBENCH ACTIONS + REDUCER (pure): every state transition of the
 * Lab UI is a typed action reduced by ONE pure function — the store
 * applies it, components dispatch it, tests exhaustively cover it. No
 * second UI state mutation path exists (E1/E2 applied to UI state).
 *
 * Async/stateful documentation (spec/worker-contract.md):
 * - Mutable state owner: `LabStore` (lab-store.ts) owns the single
 *   `LabState` instance; only `reduce` produces the next state.
 * - History: `command-receipt` APPENDS to the command log (E10 — the
 *   log is never rewritten or reordered).
 * - Tenancy (R20): `select-search` / `select-gap` check the entity's
 *   tenant against the snapshot's viewer; a cross-tenant selection is
 *   refused with the typed `cross-tenant` code and rendered — never
 *   silent, never a crash.
 * - Refresh: `refreshed` replaces the DATA snapshot wholesale (latest
 *   authoritative read wins) while preserving selection + command log.
 */

import type { LabCommandLogEntry } from "./ports.ts";
import type { LabDataSnapshot, LabTab } from "./view/lab-view.ts";
import type { LabSelection, LabSelectionRefusal } from "./view/lab-selection.ts";
import { INITIAL_LAB_SELECTION } from "./view/lab-selection.ts";
import { projectLab } from "./view/lab-view.ts";
import type { LabWorkbenchViewModel } from "./view/lab-view.ts";

/** The complete Lab workbench UI state. */
export interface LabState {
  /** Latest authoritative read-model snapshot (from the LabDataPort). */
  readonly data: LabDataSnapshot;
  /** UI selection (active tab + picked entities). */
  readonly selection: LabSelection;
  /** Append-only command log: every dispatched intent + outcome (E10). */
  readonly commandLog: readonly LabCommandLogEntry[];
  /** Last cross-tenant selection refusal, rendered verbatim (R20/E8). */
  readonly selectionRefusal: LabSelectionRefusal | null;
  /** Last load failure, recorded verbatim (never retried silently). */
  readonly loadError: string | null;
}

/** Every Lab workbench UI action. */
export type LabAction =
  | { readonly type: "select-tab"; readonly tab: LabTab }
  | { readonly type: "select-search"; readonly searchId: string }
  | { readonly type: "select-gap"; readonly capability: string }
  | { readonly type: "clear-selection" }
  | { readonly type: "refreshed"; readonly data: LabDataSnapshot }
  | { readonly type: "load-failed"; readonly detail: string }
  | { readonly type: "command-receipt"; readonly entry: LabCommandLogEntry };

/** Initial state from a first authoritative snapshot. */
export function initialLabState(data: LabDataSnapshot): LabState {
  return {
    data,
    selection: INITIAL_LAB_SELECTION,
    commandLog: [],
    selectionRefusal: null,
    loadError: null,
  };
}

/** Find a search row's tenant scope for the tenancy guard (R20). */
function searchTenant(data: LabDataSnapshot, searchId: string): string | null {
  const search = data.searches.find((candidate) => candidate.searchId === searchId);
  return search === undefined ? null : String(search.tenant);
}

/**
 * The ONE state transition function. Pure: same state + action → same
 * next state; no IO, no clock, no randomness.
 */
export function reduce(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case "select-tab":
      return { ...state, selection: { ...state.selection, tab: action.tab } };
    case "select-search": {
      const tenant = searchTenant(state.data, action.searchId);
      if (tenant === null) return state;
      if (tenant !== String(state.data.viewer.tenant)) {
        // R20: the viewer may not open another tenant's search session.
        return {
          ...state,
          selectionRefusal: {
            code: "cross-tenant",
            detail: `search ${action.searchId} belongs to tenant ${tenant}; viewer is ${String(state.data.viewer.tenant)}`,
          },
        };
      }
      return {
        ...state,
        selection: { ...state.selection, tab: "searches", searchId: action.searchId },
        selectionRefusal: null,
      };
    }
    case "select-gap": {
      const summary = state.data.gapSummaries.find(
        (candidate) => candidate.missingCapability === action.capability,
      );
      const owner = state.data.learningRecords.find((record) =>
        record.gaps.some((gap) => gap.missingCapability === action.capability),
      );
      const tenant =
        owner === undefined
          ? summary === undefined
            ? null
            : String(state.data.viewer.tenant)
          : String(owner.tenant);
      if (tenant === null) return state;
      if (tenant !== String(state.data.viewer.tenant)) {
        return {
          ...state,
          selectionRefusal: {
            code: "cross-tenant",
            detail: `gap ${action.capability} belongs to tenant ${tenant}; viewer is ${String(state.data.viewer.tenant)}`,
          },
        };
      }
      return {
        ...state,
        selection: { ...state.selection, tab: "gaps", gapCapability: action.capability },
        selectionRefusal: null,
      };
    }
    case "clear-selection":
      return { ...state, selection: INITIAL_LAB_SELECTION, selectionRefusal: null };
    case "refreshed":
      return { ...state, data: action.data, loadError: null };
    case "load-failed":
      return { ...state, loadError: action.detail };
    case "command-receipt":
      return { ...state, commandLog: [...state.commandLog, action.entry] };
    default:
      return state;
  }
}

/** Project the state into the view model the components render. */
export function projectState(state: LabState): LabWorkbenchViewModel {
  return projectLab(state.data, state.selection);
}
