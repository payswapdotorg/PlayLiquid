/**
 * REACT STORE HOOK (the app-side store binding): subscribes the component
 * tree to the `ProjectsStore` through `useSyncExternalStore` and hands
 * back the CURRENT state plus its projected view (game-ui/gameos-lab/
 * gameos-community precedent).
 *
 * Projection stability rule (why the WeakMap cache exists):
 * `store.view()` re-projects on EVERY call, producing a fresh view-model
 * object each time. `useSyncExternalStore` requires `getSnapshot` to
 * return a referentially-stable value between commits — a fresh object
 * every call would look like an infinite state change (render loop). The
 * module-level cache keys projections by the STATE object identity: one
 * projection per committed state, shared by every consumer, so the
 * snapshot is stable until the store actually commits a transition (E1:
 * the store is the one state owner; this hook adds no second state path).
 */

import { useSyncExternalStore } from "react";
import type { ProjectsStore } from "../projects-store.ts";
import type { ProjectsAction, ProjectsState } from "../projects-actions.ts";
import { projectState } from "../projects-actions.ts";
import type { ProjectsCommandIntent, ProjectsCommandReceipt } from "../ports.ts";
import type { ProjectsWorkbenchViewModel } from "../view/projects-view.ts";

/** One committed state → one shared view projection (identity-stable). */
const projectionCache = new WeakMap<ProjectsState, ProjectsWorkbenchViewModel>();

/** Project (or fetch the cached projection of) one committed state. */
export function projectStateCached(state: ProjectsState): ProjectsWorkbenchViewModel {
  const cached = projectionCache.get(state);
  if (cached !== undefined) return cached;
  const view = projectState(state);
  projectionCache.set(state, view);
  return view;
}

/** What `useProjectsStore` hands the component tree. */
export interface UseProjectsStore {
  /** The store itself (dispatch/refresh/dispatchCommand stay first-class). */
  readonly store: ProjectsStore;
  /** The current committed state (stable identity per transition). */
  readonly state: ProjectsState;
  /** The shared projection of `state` (stable identity per transition). */
  readonly view: ProjectsWorkbenchViewModel;
  /** Dispatch one typed action. */
  readonly dispatch: (action: ProjectsAction) => void;
  /** Pull one authoritative snapshot through the port. */
  readonly refresh: () => void;
  /** Dispatch one typed command intent (serialized; async receipt). */
  readonly dispatchCommand: (intent: ProjectsCommandIntent) => Promise<ProjectsCommandReceipt>;
}

/**
 * Subscribe to the projects workbench store. The hook re-renders on every
 * committed transition; `state` and `view` keep stable identities between
 * commits.
 */
export function useProjectsStore(store: ProjectsStore): UseProjectsStore {
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.state(),
    () => store.state(),
  );
  return {
    store,
    state,
    view: projectStateCached(state),
    dispatch: (action) => store.dispatch(action),
    refresh: () => store.refresh(),
    dispatchCommand: (intent) => store.dispatchCommand(intent),
  };
}
