/**
 * PROJECTS WORKBENCH ACTIONS + REDUCER (pure): every state transition of
 * the World Projects UI is a typed action reduced by ONE pure function —
 * the store applies it, components dispatch it, tests exhaustively cover
 * it. No second UI state mutation path exists (E1/E2 applied to UI
 * state).
 *
 * Async/stateful documentation (spec/worker-contract.md):
 * - Mutable state owner: `ProjectsStore` (projects-store.ts) owns the
 *   single `ProjectsState` instance; only `reduce` produces the next
 *   state.
 * - History: `command-receipt` APPENDS to the command log (E10 — the
 *   log is never rewritten or reordered).
 * - Tenancy (R20): `select-project` checks the project's owner tenant
 *   against the snapshot's viewer; a cross-tenant selection is refused
 *   with the typed `cross-tenant` code and rendered — never silent,
 *   never a crash. `select-pull-request` applies the same guard to the
 *   picked pull request's owner tenant.
 * - Refresh: `refreshed` replaces the DATA snapshot wholesale (latest
 *   authoritative read wins) while preserving selection + command log.
 */

import type { ProjectsCommandLogEntry } from "./ports.ts";
import type { ProjectsDataSnapshot, ProjectsTab } from "./view/projects-view.ts";
import type {
  ProjectsSelection,
  ProjectsSelectionRefusal,
} from "./view/projects-selection.ts";
import { INITIAL_PROJECTS_SELECTION } from "./view/projects-selection.ts";
import { projectWorkbench } from "./view/projects-view.ts";
import type { ProjectsWorkbenchViewModel } from "./view/projects-view.ts";

/** The complete projects workbench UI state. */
export interface ProjectsState {
  /** Latest authoritative read-model snapshot (from the ProjectsDataPort). */
  readonly data: ProjectsDataSnapshot;
  /** UI selection (active detail tab + open project + picked pull request). */
  readonly selection: ProjectsSelection;
  /** Append-only command log: every dispatched intent + outcome (E10). */
  readonly commandLog: readonly ProjectsCommandLogEntry[];
  /** Last cross-tenant selection refusal, rendered verbatim (R20/E8). */
  readonly selectionRefusal: ProjectsSelectionRefusal | null;
  /** Last load failure, recorded verbatim (never retried silently). */
  readonly loadError: string | null;
}

/** Every projects workbench UI action. */
export type ProjectsAction =
  | { readonly type: "select-tab"; readonly tab: ProjectsTab }
  | { readonly type: "select-project"; readonly projectId: string }
  | { readonly type: "select-pull-request"; readonly prId: string }
  | { readonly type: "clear-selection" }
  | { readonly type: "refreshed"; readonly data: ProjectsDataSnapshot }
  | { readonly type: "load-failed"; readonly detail: string }
  | { readonly type: "command-receipt"; readonly entry: ProjectsCommandLogEntry };

/** Initial state from a first authoritative snapshot. */
export function initialProjectsState(data: ProjectsDataSnapshot): ProjectsState {
  return {
    data,
    selection: INITIAL_PROJECTS_SELECTION,
    commandLog: [],
    selectionRefusal: null,
    loadError: null,
  };
}

/**
 * The ONE state transition function. Pure: same state + action → same
 * next state; no IO, no clock, no randomness.
 */
export function reduce(state: ProjectsState, action: ProjectsAction): ProjectsState {
  switch (action.type) {
    case "select-tab":
      return { ...state, selection: { ...state.selection, tab: action.tab } };
    case "select-project": {
      const project = state.data.projects.find(
        (candidate) => candidate.projectId === action.projectId,
      );
      if (project === undefined) return state;
      if (project.ownerTenant !== state.data.viewer.tenantId) {
        // R20: the viewer may not open another tenant's project.
        return {
          ...state,
          selectionRefusal: {
            code: "cross-tenant",
            detail: `project ${action.projectId} belongs to tenant ${String(project.ownerTenant)}; viewer is ${String(state.data.viewer.tenantId)}`,
          },
        };
      }
      return {
        ...state,
        selection: {
          tab: "overview",
          projectId: action.projectId,
          prId: null,
        },
        selectionRefusal: null,
      };
    }
    case "select-pull-request": {
      if (state.selection.projectId === null) return state;
      const detail = state.data.details.get(state.selection.projectId);
      const pr = detail?.pullRequests.find(
        (candidate) => String(candidate.prId) === action.prId,
      );
      if (pr === undefined) return state;
      if (pr.updatedByOwnerTenant !== state.data.viewer.tenantId) {
        // R20: the viewer may not review another tenant's pull request.
        return {
          ...state,
          selectionRefusal: {
            code: "cross-tenant",
            detail: `pull request ${action.prId.slice(0, "sha256:".length + 8)}… belongs to tenant ${String(pr.updatedByOwnerTenant)}; viewer is ${String(state.data.viewer.tenantId)}`,
          },
        };
      }
      return {
        ...state,
        selection: { ...state.selection, tab: "pull-requests", prId: action.prId },
        selectionRefusal: null,
      };
    }
    case "clear-selection":
      return { ...state, selection: INITIAL_PROJECTS_SELECTION, selectionRefusal: null };
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
export function projectState(state: ProjectsState): ProjectsWorkbenchViewModel {
  return projectWorkbench(state.data, state.selection);
}
