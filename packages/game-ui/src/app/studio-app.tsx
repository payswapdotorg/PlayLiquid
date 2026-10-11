/**
 * STUDIO APP (the mountable composition): connects the ONE studio store to
 * the presentational shell — every user intent becomes a typed action
 * dispatched to the store; refresh pulls one authoritative snapshot
 * through the host-wired `StudioDataPort`. This component owns NO state of
 * its own (E1: the store is the single UI-state owner) and performs no IO
 * (the port seam owns sourcing; nothing is fetched here).
 *
 * Async/stateful documentation (spec/worker-contract.md), this component:
 * - Mutable state owner: the `StudioStore` handed in as a prop; the app
 *   only dispatches. Event order is the store's (serialized dispatches).
 * - No hidden retries: the Refresh control performs exactly one port
 *   load; a failure lands in the visible E11 banner until the next pull.
 */

import { useCallback } from "react";
import type { ReactNode } from "react";
import { StudioShell } from "../components/studio-shell.tsx";
import { useStudioStore } from "./use-studio-store.ts";
import type { StudioStore } from "../studio-store.ts";
import type { StudioTab } from "../view/studio-view.ts";

export interface StudioAppProps {
  /** The one studio store (created by the host from a first snapshot). */
  readonly store: StudioStore;
}

/** The Game Studio application: store → shell, intents → actions. */
export function StudioApp({ store }: StudioAppProps): ReactNode {
  const { state, view, dispatch, refresh } = useStudioStore(store);
  const onSelectTab = useCallback((tab: StudioTab) => dispatch({ type: "select-tab", tab }), [dispatch]);
  const onSelectPackage = useCallback(
    (packageId: string) => dispatch({ type: "select-package", packageId }),
    [dispatch],
  );
  const onSelectAvatar = useCallback(
    (avatarId: string) => dispatch({ type: "select-avatar", avatarId }),
    [dispatch],
  );
  const onSelectJob = useCallback((jobId: string) => dispatch({ type: "select-job", jobId }), [dispatch]);
  const onRefresh = useCallback(() => refresh(), [refresh]);
  return (
    <StudioShell
      view={view}
      loadError={state.loadError}
      onSelectTab={onSelectTab}
      onSelectPackage={onSelectPackage}
      onSelectAvatar={onSelectAvatar}
      onSelectJob={onSelectJob}
      onRefresh={onRefresh}
    />
  );
}
