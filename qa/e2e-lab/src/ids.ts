/**
 * THE HOSTILE WORLD'S FROZEN IDENTITY + SEED VOCABULARY (PL-040 qa/e2e-lab).
 *
 * Every id, seed and clock constant the adversarial journey-scale suite uses
 * lives here, fixed at authoring time: the hostile runs are DETERMINISTIC
 * documents (E9 — run twice, identical trail + digests), so nothing below
 * may ever be derived from a wall clock, a random source or object-identity
 * order.
 *
 * Deliberately DIFFERENT fixtures from every sibling suite, per the
 * qa/browser lab-journey precedent (same public surfaces, independently
 * seeded proof): examples/lab-journey walks tenant-lab-arena-community with
 * the "lab-thesis-*" seeds, a rendering capability and the 3-record "std"
 * evidence ledger; qa/browser walks tenant-lab-journey with
 * "lab-journey-*" seeds. THIS suite walks a DIFFERENT hostile world — a
 * different tenant, a netcode capability, a 4-record "qa-hostile" evidence
 * ledger, different cycle ids/seeds/observations and a DIFFERENT gap-ladder
 * route (attempted rungs, not unavailable/declined ones) — so a shared
 * fixture bug can never pass both suites at once.
 */

import { asAgentRoleId, asCapabilityId, asEvaluationSeed, asLabCycleId, asZCodeModelRouteId } from "../../../packages/lab-contracts/src/index.ts";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";

// ---------------------------------------------------------------------------
// Tenancy + actors (R20: one owning tenant, one foreign tenant, one MOVED subject)
// ---------------------------------------------------------------------------

/** The tenant that owns the hostile world. */
export const HOSTILE_TENANT = asTenantId("tenant-qa-e2e-hostile")!;
/** The hostile world's operator: Lab lead, Arena decider, contributor. */
export const HOSTILE_SUBJECT = asSubjectId("subject-qa-hostile-lead")!;
/** The hostile world's community maintainer (the verdict authority). */
export const HOSTILE_MAINTAINER = asSubjectId("subject-qa-hostile-maintainer")!;
/** The confused foreign tenant (R20 guard rows). */
export const HOSTILE_FOREIGN_TENANT = asTenantId("tenant-qa-e2e-foreign")!;
/** A subject of the foreign tenant. */
export const HOSTILE_FOREIGN_SUBJECT = asSubjectId("subject-qa-hostile-foreign")!;
/**
 * A subject MEMBER of the hostile tenant whose OWNERSHIP moved to the
 * foreign tenant (the moved-contributor hostile row: submitting into the
 * hostile tenant with this identity is a cross-tenant-contributor attempt,
 * refused typed — hostile-tenant membership + foreign-tenant ownership).
 */
export const HOSTILE_MOVED_SUBJECT = asSubjectId("subject-qa-hostile-moved")!;

// ---------------------------------------------------------------------------
// Lab cycles + seeds (the hostile loop walks two cycles: strike, then recur)
// ---------------------------------------------------------------------------

/** The discovery cycle (search → evaluate → calibrate → learn → gap). */
export const CYCLE_ONE = asLabCycleId("qa-e2e-cycle-one")!;
/** The recurrence cycle (R18: the gap is never silently skipped). */
export const CYCLE_TWO = asLabCycleId("qa-e2e-cycle-two")!;

/** The seeded search of cycle one (through the typed port). */
export const SEARCH_SEED_ONE = asEvaluationSeed("seed-qa-e2e-strike")!;
/** The seeded search of cycle two (the recurrence probe). */
export const SEARCH_SEED_TWO = asEvaluationSeed("seed-qa-e2e-recur")!;
/** The seeded evaluation parameters of every hostile loop cycle. */
export const EVALUATION_SEED = asEvaluationSeed("seed-qa-e2e-evaluation")!;
/** The tick budget every hostile evaluation run gets (≠ the example's 12). */
export const EVALUATION_TICK_BUDGET = 16;

// ---------------------------------------------------------------------------
// Candidate-space bounds of the hostile searches (≠ the example's fixtures)
// ---------------------------------------------------------------------------

/** The role vocabulary the hostile searches admit. */
export const HOSTILE_ROLE_VOCABULARY = [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!] as const;
/** The capability the hostile candidate organizations spread into. */
export const HOSTILE_CAPABILITY = asCapabilityId("lab-cap-qa-netcode")!;
/** The single model route the hostile bounds admit. */
export const HOSTILE_MODEL_ROUTE = asZCodeModelRouteId("route-qa-e2e-alpha")!;

// ---------------------------------------------------------------------------
// The evidence + observation ledgers (a DIFFERENT fixture set, E9)
// ---------------------------------------------------------------------------

/** The evidence fixture variant the hostile world's ledger holds. */
export const HOSTILE_EVIDENCE_VARIANT = "qa-hostile";
/** The evidence record count of the hostile ledger (≠ the example's 3). */
export const HOSTILE_EVIDENCE_COUNT = 4;
/** The observation backing cycle one's calibration. */
export const OBSERVATION_ONE = "observation-qa-e2e-strike";
/** The observation backing cycle two's calibration. */
export const OBSERVATION_TWO = "observation-qa-e2e-recur";

// ---------------------------------------------------------------------------
// Injected clock anchors (fixed starts, fixed advances — E9)
// ---------------------------------------------------------------------------

/** The Arena runtime's stepping clock starts here (ms; steps by 3). */
export const ARENA_CLOCK_START = 40_000;
/** The Arena host decision timestamp (a hostile-world fact, not a clock read). */
export const ARENA_DECIDED_AT = 41_000;
/** The stepping clock's fixed step (ms; ≠ the example's 5). */
export const ARENA_CLOCK_STEP = 3;
/** The Community service's clock starts here (ms). */
export const COMMUNITY_CLOCK_START = 60_000;
/** The hostile journal's sequence-derived clock starts here (ms). */
export const JOURNAL_CLOCK_START = 2_000;
/** Every recorded hostile step advances the journal clock by this much. */
export const JOURNAL_CLOCK_STEP_MS = 7;
