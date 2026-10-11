/**
 * REACT STORE HOOK (the app-side store binding): subscribes the component
 * tree to the `StudioStore` through `useSyncExternalStore` and hands back
 * the CURRENT state plus its projected view.
 *
 * Projection stability rule (why the WeakMap cache exists):
 * `store.view()` re-projects on EVERY call, producing a fresh view-model
 * object each time. `useSyncExternalStore` requires `getSnapshot` to return
 * a referentially-stable value between commits — a fresh object every call
 * would look like an infinite state change (render loop). The module-level
 * cache keys projections by the STATE object identity: one projection per
 * committed state, shared by every consumer, so the snapshot is stable
 * until the store actually commits a transition (E1: the store is the one
 * state owner; this hook adds no second state path).
 */

import { useSyncExternalStore } from "react";
import type { StudioStore } from "../studio-store.ts";
import type { StudioAction, StudioState } from "../studio-actions.ts";
import { projectState } from "../studio-actions.ts";
import type { GameStudioViewModel } from "../view/studio-view.ts";

/** One committed state → one shared view projection (identity-stable). */
const projectionCache = new WeakMap<StudioState, GameStudioViewModel>();

/** Project (or fetch the cached projection of) one committed state. */
export function projectStateCached(state: StudioState): GameStudioViewModel {
  const cached = projectionCache.get(state);
  if (cached !== undefined) return cached;
  const view = projectState(state);
  projectionCache.set(state, view);
  return view;
}

/** What `useStudioStore` hands the component tree. */
export interface UseStudioStore {
  /** The store itself (dispatch/refresh stay first-class citizens). */
  readonly store: StudioStore;
  /** The current committed state (stable identity per transition). */
  readonly state: StudioState;
  /** The shared projection of `state` (stable identity per transition). */
  readonly view: GameStudioViewModel;
  /** Dispatch one typed action. */
  readonly dispatch: (action: StudioAction) => void;
  /** Pull one authoritative snapshot through the port. */
  readonly refresh: () => void;
}

/**
 * Subscribe to the studio store. The hook re-renders on every committed
 * transition; `state` and `view` keep stable identities between commits.
 */
export function useStudioStore(store: StudioStore): UseStudioStore {
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
