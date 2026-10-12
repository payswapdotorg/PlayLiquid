/**
 * THE LAB/ARENA/COMMUNITY JOURNEY'S FROZEN IDENTITY + SEED VOCABULARY
 * (PL-040; examples/lab-journey).
 *
 * Every id, seed and clock constant the canonical journey uses lives here,
 * fixed at authoring time: the journey is a DETERMINISTIC document (E9 —
 * run twice, identical journal + digests), so nothing below may ever be
 * derived from a wall clock, a random source or object-identity order.
 *
 * Deliberately DIFFERENT values from every sibling suite (qa/browser's
 * lab-journey, gameos-lab's demo fixture, qa/e2e-lab's hostile world):
 * same public surfaces, independently seeded proof.
 */

import { asAgentRoleId, asCapabilityId, asEvaluationSeed, asLabCycleId, asZCodeModelRouteId } from "../../../packages/lab-contracts/src/index.ts";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";

// ---------------------------------------------------------------------------
// Tenancy + actors (R20: one owning tenant, one confused foreign tenant)
// ---------------------------------------------------------------------------

/** The tenant that owns the whole canonical journey. */
export const JOURNEY_TENANT = asTenantId("tenant-lab-arena-community")!;
/** The journey's single human operator: Lab lead, Arena decider, contributor. */
export const JOURNEY_SUBJECT = asSubjectId("subject-lab-thesis-lead")!;
/** The community maintainer of record (the workflow/verdict authority). */
export const JOURNEY_MAINTAINER = asSubjectId("subject-lab-thesis-maintainer")!;
/** The confused foreign tenant (the R20 guard rows). */
export const JOURNEY_FOREIGN_TENANT = asTenantId("tenant-lab-thesis-foreign")!;
export const JOURNEY_FOREIGN_SUBJECT = asSubjectId("subject-lab-thesis-foreign")!;

// ---------------------------------------------------------------------------
// Lab cycles + seeds (the loop walks two cycles: discover, then re-observe)
// ---------------------------------------------------------------------------

/** The discovery cycle (search → evaluate → calibrate → learn → gap). */
export const CYCLE_A = asLabCycleId("lab-thesis-cycle-a")!;
/** The re-observation cycle (the gap recurs — R18: never silently skipped). */
export const CYCLE_B = asLabCycleId("lab-thesis-cycle-b")!;

/** The seeded search of cycle A (the typed request-search intent). */
export const SEARCH_SEED_A = asEvaluationSeed("seed-lab-thesis-search-a")!;
/** The seeded evaluation parameters of the loop cycle. */
export const EVALUATION_SEED = asEvaluationSeed("seed-lab-thesis-evaluation")!;
/** The candidate-space bounds of every journey search. */
export const SEARCH_ROLE_VOCABULARY = [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!] as const;
/** The capability the journey's candidate organizations spread into. */
export const JOURNEY_CAPABILITY = asCapabilityId("lab-cap-thesis-rendering")!;
/** The single model route the journey's bounds admit. */
export const JOURNEY_MODEL_ROUTE = asZCodeModelRouteId("route-lab-thesis-a")!;
/** The tick budget every evaluation run gets. */
export const EVALUATION_TICK_BUDGET = 12;
/** The observation backing cycle A's calibration conclusion. */
export const OBSERVATION_A = "observation-lab-thesis-1";
/** The observation backing cycle B's calibration conclusion. */
export const OBSERVATION_B = "observation-lab-thesis-2";

// ---------------------------------------------------------------------------
// Injected clock anchors (fixed starts, fixed advances — E9)
// ---------------------------------------------------------------------------

/** The Lab stack's clock starts here (ms). */
export const LAB_CLOCK_START = 1_000;
/** The Arena runtime's stepping clock starts here (ms). */
export const ARENA_CLOCK_START = 20_000;
/** The Arena host decision timestamp (a journey fact, not a clock read). */
export const ARENA_DECIDED_AT = 21_000;
/** The Community service's clock starts here (ms). */
export const COMMUNITY_CLOCK_START = 30_000;
/** The journey journal's sequence-derived clock starts here (ms). */
export const JOURNAL_CLOCK_START = 1_000;
/** Every recorded journal step advances the journey clock by this much. */
export const JOURNAL_CLOCK_STEP_MS = 10;
