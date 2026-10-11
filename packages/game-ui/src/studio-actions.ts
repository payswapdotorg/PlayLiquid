/**
 * STUDIO ACTIONS + REDUCER (pure): every state transition of the Game
 * Studio UI is a typed action reduced by ONE pure function — the store
 * applies it, components dispatch it, tests exhaustively cover it. No
 * second state mutation path exists (E1/E2 applied to UI state).
 *
 * Async/stateful documentation (spec/worker-contract.md):
 * - Mutable state owner: `StudioStore` (studio-store.ts) owns the single
 *   `StudioState` instance; only `reduce` produces the next state.
 * - History: `record-operations` APPENDS to the timeline (E10 — the
 *   timeline is never rewritten or reordered).
 * - Stale results: operation results carry their producing epoch; the
 *   projection marks them stale when the session epoch advanced
 *   (`stale-result` rule surfaced, never silently dropped).
 * - Refresh: `refreshed` replaces the DATA snapshot wholesale (latest
 *   authoritative read wins) while PRESERVING selection + timeline.
 */

import type { SessionOperation } from "./view/runtime-view.ts";
import type {
  GameStudioViewModel,
  StudioDataSnapshot,
  StudioSelection,
} from "./view/studio-view.ts";
import { INITIAL_SELECTION, projectStudio } from "./view/studio-view.ts";

/** The complete studio UI state (data snapshot + selection + timeline). */
export interface StudioState {
  /** Latest authoritative data snapshot (from the StudioDataPort). */
  readonly data: StudioDataSnapshot;
  /** UI selection (active tab + picked entities). */
  readonly selection: StudioSelection;
  /** Append-only session operation timeline (E10). */
  readonly operations: readonly SessionOperation[];
  /** Last load failure, recorded verbatim (never retried silently). */
  readonly loadError: string | null;
}

/** Every studio UI action. */
export type StudioAction =
  | { readonly type: "select-tab"; readonly tab: StudioSelection["tab"] }
  | { readonly type: "select-package"; readonly packageId: string }
  | { readonly type: "select-avatar"; readonly avatarId: string }
  | { readonly type: "select-job"; readonly jobId: string }
  | { readonly type: "clear-selection" }
  | { readonly type: "refreshed"; readonly data: StudioDataSnapshot }
  | { readonly type: "load-failed"; readonly detail: string }
  | { readonly type: "record-operations"; readonly operations: readonly SessionOperation[] };

/** Initial state from a first authoritative snapshot. */
export function initialStudioState(data: StudioDataSnapshot): StudioState {
  return { data, selection: INITIAL_SELECTION, operations: [...data.operations], loadError: null };
}

/**
 * The ONE state transition function. Pure: same state + action → same
 * next state; no IO, no clock, no randomness.
 */
export function reduce(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case "select-tab":
      return { ...state, selection: { ...state.selection, tab: action.tab } };
    case "select-package":
      return {
        ...state,
        selection: { ...state.selection, tab: "packages", packageId: action.packageId },
      };
    case "select-avatar":
      return {
        ...state,
        selection: { ...state.selection, tab: "avatars", avatarId: action.avatarId },
      };
    case "select-job":
      return { ...state, selection: { ...state.selection, tab: "tools", jobId: action.jobId } };
    case "clear-selection":
      return { ...state, selection: INITIAL_SELECTION };
    case "refreshed":
      return {
        ...state,
        data: action.data,
        // The refreshed snapshot's own operations seed the timeline head;
        // previously recorded operations remain appended in order (E10).
        operations: [...state.operations, ...action.data.operations],
        loadError: null,
      };
    case "load-failed":
      return { ...state, loadError: action.detail };
    case "record-operations":
      return { ...state, operations: [...state.operations, ...action.operations] };
    default:
      return state;
  }
}

/** Project the state into the view model the components render. */
export function projectState(state: StudioState): GameStudioViewModel {
  const data: StudioDataSnapshot = { ...state.data, operations: state.operations };
  return projectStudio(data, state.selection);
}
