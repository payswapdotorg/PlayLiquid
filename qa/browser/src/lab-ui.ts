/**
 * GAMEOS-LAB NODE SURFACE (PL-043) — the ONE file of the browser-journey
 * suite that touches `@playliquid/gameos-lab` sources beneath its
 * entrypoint.
 *
 * WHY THIS ADAPTER EXISTS (see studio-ui.ts for the full statement): the
 * gameos-lab public entrypoint (`src/index.ts`) re-exports its presentational
 * `.tsx` component set for the browser mount; plain `node --test` (this
 * suite's runner — E11: no browser, no bundler) refuses `.tsx` files
 * outright, so the entrypoint cannot be imported here. The journeys reach
 * ONLY the Node-loadable public surface the browser mount renders from —
 * the store, the two ports and the pure view-model snapshot types (all
 * plain `.ts`, all exported from the package entrypoint) — and every one
 * of those imports is CONCENTRATED in this single adapter so the
 * deep-import surface is explicit, minimal and auditable.
 *
 * TEST-SUPPORT SEAM (lock rule 44): no production integration implied.
 */

export { createLabStore } from "../../../packages/web/gameos-lab/src/lab-store.ts";
export type { LabStore } from "../../../packages/web/gameos-lab/src/lab-store.ts";
export type {
  LabCommandIntent,
  LabCommandPort,
  LabCommandReceipt,
  LabDataPort,
} from "../../../packages/web/gameos-lab/src/ports.ts";
export type {
  LabDataSnapshot,
  LabTab,
  LabViewer,
} from "../../../packages/web/gameos-lab/src/view/lab-view.ts";
