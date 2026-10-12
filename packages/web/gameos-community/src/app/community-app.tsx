/**
 * COMMUNITY WORKBENCH APP (the mountable composition): connects the ONE
 * Community workbench store to the presentational shell — every user
 * intent becomes a typed action dispatched to the store; refresh pulls
 * one authoritative snapshot through the host-wired
 * `CommunityDataPort`; command intents are dispatched through the
 * host-wired `CommunityCommandPort`. This component owns NO state of its
 * own (E1: the store is the single UI-state owner) and performs no IO
 * (the port seams own sourcing; nothing is fetched here).
 */

import { useCallback } from "react";
import type { ReactNode } from "react";
import { CommunityShell } from "../components/community-shell.tsx";
import { useCommunityStore } from "./use-community-store.ts";
import type { CommunityStore } from "../community-store.ts";
import type { CommunityCommandIntent } from "../ports.ts";
import type { CommunityTab } from "../view/community-view.ts";

export interface CommunityAppProps {
  /** The one Community workbench store (created by the host from a first snapshot). */
  readonly store: CommunityStore;
}

/** The Community workbench application: store → shell, intents → actions/ports. */
export function CommunityApp({ store }: CommunityAppProps): ReactNode {
  const { state, view, dispatch, refresh } = useCommunityStore(store);
  const onSelectTab = useCallback((tab: CommunityTab) => dispatch({ type: "select-tab", tab }), [dispatch]);
  const onSelectKind = useCallback(
    (kind: string | null) => dispatch({ type: "select-kind", kind }),
    [dispatch],
  );
  const onSelectContribution = useCallback(
    (contributionId: string) => dispatch({ type: "select-contribution", contributionId }),
    [dispatch],
  );
  const onDispatchCommand = useCallback(
    (intent: CommunityCommandIntent) => {
      store.dispatchCommand(intent);
    },
    [store],
  );
  const onRefresh = useCallback(() => refresh(), [refresh]);
  return (
    <CommunityShell
      view={view}
      viewer={state.data.viewer}
      loadError={state.loadError}
      selectionRefusal={state.selectionRefusal}
      commandLog={state.commandLog}
      onSelectTab={onSelectTab}
      onSelectKind={onSelectKind}
      onSelectContribution={onSelectContribution}
      onDispatchCommand={onDispatchCommand}
      onRefresh={onRefresh}
    />
  );
}
