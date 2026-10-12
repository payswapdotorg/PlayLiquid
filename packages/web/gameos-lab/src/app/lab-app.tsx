/**
 * LAB WORKBENCH APP (the mountable composition): connects the ONE Lab
 * workbench store to the presentational shell — every user intent becomes
 * a typed action dispatched to the store; refresh pulls one authoritative
 * snapshot through the host-wired `LabDataPort`; command intents are
 * dispatched through the host-wired `LabCommandPort`. This component owns
 * NO state of its own (E1: the store is the single UI-state owner) and
 * performs no IO (the port seams own sourcing; nothing is fetched here).
 */

import { useCallback } from "react";
import type { ReactNode } from "react";
import { LabShell } from "../components/lab-shell.tsx";
import { useLabStore } from "./use-lab-store.ts";
import type { LabStore } from "../lab-store.ts";
import type { LabCommandIntent } from "../ports.ts";
import type { LabTab } from "../view/lab-view.ts";

export interface LabAppProps {
  /** The one Lab workbench store (created by the host from a first snapshot). */
  readonly store: LabStore;
}

/** The Lab workbench application: store → shell, intents → actions/ports. */
export function LabApp({ store }: LabAppProps): ReactNode {
  const { state, view, dispatch, refresh } = useLabStore(store);
  const onSelectTab = useCallback((tab: LabTab) => dispatch({ type: "select-tab", tab }), [dispatch]);
  const onSelectSearch = useCallback(
    (searchId: string) => dispatch({ type: "select-search", searchId }),
    [dispatch],
  );
  const onDispatchCommand = useCallback(
    (intent: LabCommandIntent) => {
      store.dispatchCommand(intent);
    },
    [store],
  );
  const onRefresh = useCallback(() => refresh(), [refresh]);
  return (
    <LabShell
      view={view}
      viewer={state.data.viewer}
      loadError={state.loadError}
      selectionRefusal={state.selectionRefusal}
      commandLog={state.commandLog}
      onSelectTab={onSelectTab}
      onSelectSearch={onSelectSearch}
      onDispatchCommand={onDispatchCommand}
      onRefresh={onRefresh}
    />
  );
}
