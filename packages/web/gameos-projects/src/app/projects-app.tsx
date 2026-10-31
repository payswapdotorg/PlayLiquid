/**
 * PROJECTS WORKBENCH APP (the mountable composition): connects the ONE
 * projects workbench store to the presentational shell — every user
 * intent becomes a typed action dispatched to the store; refresh pulls
 * one authoritative snapshot through the host-wired `ProjectsDataPort`;
 * review commands are dispatched as typed intents through the host-wired
 * `ProjectsCommandPort` (async, serialized by the store). This component
 * owns NO state of its own (E1: the store is the single UI-state owner)
 * and performs no IO (the port seams own sourcing; nothing is fetched
 * here).
 */

import { useCallback } from "react";
import type { ReactNode } from "react";
import { ProjectsShell } from "../components/projects-shell.tsx";
import { useProjectsStore } from "./use-projects-store.ts";
import type { ProjectsStore } from "../projects-store.ts";
import type { ProjectsCommandIntent } from "../ports.ts";
import type { ProjectsTab } from "../view/projects-view.ts";

export interface ProjectsAppProps {
  /** The one projects workbench store (created by the host from a first snapshot). */
  readonly store: ProjectsStore;
}

/** The projects workbench application: store → shell, intents → actions/ports. */
export function ProjectsApp({ store }: ProjectsAppProps): ReactNode {
  const { state, view, dispatch, refresh } = useProjectsStore(store);
  const onSelectTab = useCallback((tab: ProjectsTab) => dispatch({ type: "select-tab", tab }), [dispatch]);
  const onSelectProject = useCallback(
    (projectId: string) => dispatch({ type: "select-project", projectId }),
    [dispatch],
  );
  const onSelectPullRequest = useCallback(
    (prId: string) => dispatch({ type: "select-pull-request", prId }),
    [dispatch],
  );
  const onDispatchCommand = useCallback(
    (intent: ProjectsCommandIntent) => {
      // Fire-and-forget by design: the append-only command log renders the
      // typed outcome (or the rejection) — no hidden retries (E8/E10).
      void store.dispatchCommand(intent);
    },
    [store],
  );
  const onRefresh = useCallback(() => refresh(), [refresh]);
  return (
    <ProjectsShell
      view={view}
      viewer={state.data.viewer}
      loadError={state.loadError}
      selectionRefusal={state.selectionRefusal}
      commandLog={state.commandLog}
      onSelectTab={onSelectTab}
      onSelectProject={onSelectProject}
      onSelectPullRequest={onSelectPullRequest}
      onDispatchCommand={onDispatchCommand}
      onRefresh={onRefresh}
    />
  );
}
