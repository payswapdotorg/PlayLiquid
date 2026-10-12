/**
 * REACT STORE HOOK (the app-side store binding): subscribes the component
 * tree to the `CommunityStore` through `useSyncExternalStore` and hands
 * back the CURRENT state plus its projected view (game-ui/gameos-lab
 * precedent).
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
import type { CommunityStore } from "../community-store.ts";
import type { CommunityAction, CommunityState } from "../community-actions.ts";
import { projectState } from "../community-actions.ts";
import type { CommunityWorkbenchViewModel } from "../view/community-view.ts";

/** One committed state → one shared view projection (identity-stable). */
const projectionCache = new WeakMap<CommunityState, CommunityWorkbenchViewModel>();

/** Project (or fetch the cached projection of) one committed state. */
export function projectStateCached(state: CommunityState): CommunityWorkbenchViewModel {
  const cached = projectionCache.get(state);
  if (cached !== undefined) return cached;
  const view = projectState(state);
  projectionCache.set(state, view);
  return view;
}

/** What `useCommunityStore` hands the component tree. */
export interface UseCommunityStore {
  /** The store itself (dispatch/refresh/dispatchCommand stay first-class). */
  readonly store: CommunityStore;
  /** The current committed state (stable identity per transition). */
  readonly state: CommunityState;
  /** The shared projection of `state` (stable identity per transition). */
  readonly view: CommunityWorkbenchViewModel;
  /** Dispatch one typed action. */
  readonly dispatch: (action: CommunityAction) => void;
  /** Pull one authoritative snapshot through the port. */
  readonly refresh: () => void;
}

/**
 * Subscribe to the Community workbench store. The hook re-renders on every
 * committed transition; `state` and `view` keep stable identities between
 * commits.
 */
export function useCommunityStore(store: CommunityStore): UseCommunityStore {
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
  };
}
