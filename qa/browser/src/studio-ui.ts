/**
 * GAME-UI NODE SURFACE (PL-043) — the ONE file of the browser-journey
 * suite that touches `@playliquid/game-ui` sources beneath its entrypoint.
 *
 * WHY THIS ADAPTER EXISTS (the promotion-time decision point, stated
 * honestly): game-ui's public entrypoint (`src/index.ts`) re-exports its
 * presentational component set, which lives in `.tsx` JSX modules for the
 * browser mount (PL-033 vite host). This gate set runs under plain
 * `node --test` (E11: no browser, no bundler), and Node's type-stripping
 * loader REFUSES `.tsx` files outright (`ERR_UNKNOWN_FILE_EXTENSION` — JSX
 * needs a real transform). Importing `src/index.ts` from Node is therefore
 * structurally impossible, and importing it under tsc would drag the whole
 * component surface (plus `--jsx` and the DOM lib) into this pure-Node
 * program — precisely what the E11 honesty of this suite forbids.
 *
 * So the journeys reach ONLY the Node-loadable public surface the browser
 * mount itself renders from — the store, the ports, the doubles and the
 * pure view-model projections (all plain `.ts`, all exported from the
 * package entrypoint) — and every one of those imports is CONCENTRATED in
 * this single adapter so the deep-import surface is explicit, minimal and
 * auditable. When a Node-loadable entrypoint exists (or an exception is
 * recorded), redirecting these re-exports to it is a one-file change.
 *
 * TEST-SUPPORT SEAM (lock rule 44): no production integration implied.
 */

export { createStudioStore } from "../../../packages/game-ui/src/studio-store.ts";
export type { StudioStore } from "../../../packages/game-ui/src/studio-store.ts";
export {
  LocalAdapter,
  ScriptedStudioDataPort,
  StaticStudioDataPort,
} from "../../../packages/game-ui/src/fakes.ts";
export { studioSummary } from "../../../packages/game-ui/src/view/studio-view.ts";
export type { StudioDataSnapshot } from "../../../packages/game-ui/src/view/studio-view.ts";
export type { SessionOperation } from "../../../packages/game-ui/src/view/runtime-view.ts";
export type { JobEventLike } from "../../../packages/game-ui/src/view/tools-view.ts";
