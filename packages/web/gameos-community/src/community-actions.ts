/**
 * COMMUNITY WORKBENCH ACTIONS + REDUCER (pure): every state transition of
 * the Community UI is a typed action reduced by ONE pure function — the
 * store applies it, components dispatch it, tests exhaustively cover it.
 * No second UI state mutation path exists (E1/E2 applied to UI state).
 *
 * Async/stateful documentation (spec/worker-contract.md):
 * - Mutable state owner: `CommunityStore` (community-store.ts) owns the
 *   single `CommunityState` instance; only `reduce` produces the next
 *   state.
 * - History: `command-receipt` APPENDS to the command log (E10 — the
 *   log is never rewritten or reordered).
 * - Tenancy (R20): `select-contribution` checks the record's tenant
 *   against the snapshot's viewer; a cross-tenant selection is refused
 *   with the typed `cross-tenant` code and rendered — never silent,
 *   never a crash.
 * - Refresh: `refreshed` replaces the DATA snapshot wholesale (latest
 *   authoritative read wins) while preserving selection + command log.
 */

import type { CommunityCommandLogEntry } from "./ports.ts";
import type {
  CommunityDataSnapshot,
  CommunityTab,
} from "./view/community-view.ts";
import type {
  CommunitySelection,
  CommunitySelectionRefusal,
} from "./view/community-selection.ts";
import { INITIAL_COMMUNITY_SELECTION } from "./view/community-selection.ts";
import { projectCommunity } from "./view/community-view.ts";
import type { CommunityWorkbenchViewModel } from "./view/community-view.ts";

/** The complete Community workbench UI state. */
export interface CommunityState {
  /** Latest authoritative read-model snapshot (from the CommunityDataPort). */
  readonly data: CommunityDataSnapshot;
  /** UI selection (active tab + picked entities + kind filter). */
  readonly selection: CommunitySelection;
  /** Append-only command log: every dispatched intent + outcome (E10). */
  readonly commandLog: readonly CommunityCommandLogEntry[];
  /** Last cross-tenant selection refusal, rendered verbatim (R20/E8). */
  readonly selectionRefusal: CommunitySelectionRefusal | null;
  /** Last load failure, recorded verbatim (never retried silently). */
  readonly loadError: string | null;
}

/** Every Community workbench UI action. */
export type CommunityAction =
  | { readonly type: "select-tab"; readonly tab: CommunityTab }
  | { readonly type: "select-contribution"; readonly contributionId: string }
  | { readonly type: "select-kind"; readonly kind: string | null }
  | { readonly type: "clear-selection" }
  | { readonly type: "refreshed"; readonly data: CommunityDataSnapshot }
  | { readonly type: "load-failed"; readonly detail: string }
  | { readonly type: "command-receipt"; readonly entry: CommunityCommandLogEntry };

/** Initial state from a first authoritative snapshot. */
export function initialCommunityState(data: CommunityDataSnapshot): CommunityState {
  return {
    data,
    selection: INITIAL_COMMUNITY_SELECTION,
    commandLog: [],
    selectionRefusal: null,
    loadError: null,
  };
}

/**
 * The ONE state transition function. Pure: same state + action → same
 * next state; no IO, no clock, no randomness.
 */
export function reduce(state: CommunityState, action: CommunityAction): CommunityState {
  switch (action.type) {
    case "select-tab":
      return { ...state, selection: { ...state.selection, tab: action.tab } };
    case "select-contribution": {
      const record = state.data.contributions.find(
        (candidate) => String(candidate.contributionId) === action.contributionId,
      );
      if (record === undefined) return state;
      if (record.tenant !== state.data.viewer.tenant) {
        // R20: the viewer may not open another tenant's contribution.
        return {
          ...state,
          selectionRefusal: {
            code: "cross-tenant",
            detail: `contribution ${action.contributionId.slice(0, "sha256:".length + 8)}… belongs to tenant ${String(record.tenant)}; viewer is ${String(state.data.viewer.tenant)}`,
          },
        };
      }
      return {
        ...state,
        selection: {
          ...state.selection,
          tab: "provenance",
          contributionId: action.contributionId,
        },
        selectionRefusal: null,
      };
    }
    case "select-kind":
      return { ...state, selection: { ...state.selection, kindFilter: action.kind } };
    case "clear-selection":
      return { ...state, selection: INITIAL_COMMUNITY_SELECTION, selectionRefusal: null };
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
export function projectState(state: CommunityState): CommunityWorkbenchViewModel {
  return projectCommunity(state.data, state.selection);
}
