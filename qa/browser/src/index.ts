/**
 * qa/browser PUBLIC ENTRYPOINT (PL-043) — the browser-journey suite.
 *
 * The journeys run the REAL public surfaces of the web workbenches (the
 * stores, ports and pure view models of game-ui / gameos-lab /
 * gameos-community), the REAL Lab loop engines, the REAL community
 * service and the LUMEN RUN canonical playthrough under `node --test`,
 * with an executable E11 honesty header (no DOM, no rendering, no
 * network — stated plainly, never faked) and an E9 determinism walk
 * (run twice, identical traces).
 *
 * The three Node-surface adapters (studio-ui.ts / lab-ui.ts /
 * community-ui.ts) document WHY the web packages are not reached
 * through their index.ts entrypoints here: those entrypoints re-export
 * presentational .tsx components, which plain Node cannot load.
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// Module manifest (PL-010 governance format)
export { qaBrowserModule } from "./module.ts";

// The shared, dependency-free evidence helpers (E9 trace/digest kit).
export * from "./journey-kit.ts";

// The host-composed journey rigs (the real engines + the real ports).
export {
  JOURNEY_RESTRICTION,
  JOURNEY_STUDIO_SESSION_ID,
  composeStudioJourneySnapshot,
} from "./studio-rig.ts";
export {
  JOURNEY_LAB_FOREIGN_SUBJECT,
  JOURNEY_LAB_FOREIGN_TENANT,
  JOURNEY_LAB_SUBJECT,
  JOURNEY_LAB_TENANT,
  createLabJourneyRig,
  openForeignSearch,
} from "./lab-rig.ts";
export {
  JOURNEY_COMMUNITY_CONTRIBUTOR,
  JOURNEY_COMMUNITY_CYCLE,
  JOURNEY_COMMUNITY_FOREIGN_CONTRIBUTOR,
  JOURNEY_COMMUNITY_FOREIGN_TENANT,
  JOURNEY_COMMUNITY_GAP,
  JOURNEY_COMMUNITY_MOVED_CONTRIBUTOR,
  JOURNEY_COMMUNITY_TENANT,
  JOURNEY_COMMUNITY_VIEWER,
  createCommunityJourneyRig,
} from "./community-rig.ts";
