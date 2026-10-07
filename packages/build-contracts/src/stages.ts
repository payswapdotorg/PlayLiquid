/**
 * The frozen build-stage vocabulary and the build phase state machine
 * (spec/architecture.md "Build": resolve → plan → emit → verify → package).
 *
 * House pattern: a frozen vocabulary (`Object.freeze`), a frozen transition
 * table and pure validators over it. The build ORCHESTRATOR (PL-020) owns
 * mutable build state; everything here is the pure transition oracle the
 * orchestrator applies. No stage execution happens in this package —
 * stages are vocabulary, not engines.
 */

/** The frozen build-stage vocabulary (architecture "Build" stages). */
export const BUILD_STAGES = Object.freeze([
  "resolve",
  "plan",
  "emit",
  "verify",
  "package",
] as const);

/** One build stage. */
export type BuildStage = (typeof BUILD_STAGES)[number];

/** Type guard: a known build stage. */
export function isBuildStage(value: unknown): value is BuildStage {
  return typeof value === "string" && (BUILD_STAGES as readonly string[]).includes(value);
}

/**
 * Build lifecycle phases: the bookends (`queued`, and the terminal
 * `succeeded`/`failed`/`cancelled`) around the five frozen stages.
 */
export const BUILD_PHASES = Object.freeze([
  "queued",
  "resolve",
  "plan",
  "emit",
  "verify",
  "package",
  "succeeded",
  "failed",
  "cancelled",
] as const);

/** One build lifecycle phase. */
export type BuildPhase = (typeof BUILD_PHASES)[number];

/** Type guard: a known build phase. */
export function isBuildPhase(value: unknown): value is BuildPhase {
  return typeof value === "string" && (BUILD_PHASES as readonly string[]).includes(value);
}

/** The frozen phase transition table. Terminal phases transition nowhere. */
export const BUILD_PHASE_TRANSITIONS: Readonly<Record<BuildPhase, readonly BuildPhase[]>> =
  Object.freeze({
    queued: Object.freeze(["resolve", "cancelled"] as const),
    resolve: Object.freeze(["plan", "failed", "cancelled"] as const),
    plan: Object.freeze(["emit", "failed", "cancelled"] as const),
    emit: Object.freeze(["verify", "failed", "cancelled"] as const),
    verify: Object.freeze(["package", "failed", "cancelled"] as const),
    package: Object.freeze(["succeeded", "failed", "cancelled"] as const),
    succeeded: Object.freeze([] as const),
    failed: Object.freeze([] as const),
    cancelled: Object.freeze([] as const),
  });

/** True iff `phase` accepts no further transitions. */
export function isTerminalBuildPhase(phase: BuildPhase): boolean {
  return BUILD_PHASE_TRANSITIONS[phase].length === 0;
}

/** True iff `from -> to` is a legal phase transition. */
export function canTransitionBuildPhase(from: BuildPhase, to: BuildPhase): boolean {
  return BUILD_PHASE_TRANSITIONS[from].includes(to);
}

/** Result of {@link checkBuildPhaseTransition}. */
export type BuildPhaseTransitionResult =
  | { readonly ok: true; readonly from: BuildPhase; readonly to: BuildPhase }
  | {
      readonly ok: false;
      readonly code: "illegal-phase-transition";
      readonly from: BuildPhase;
      readonly to: BuildPhase;
      /** The legal successors of `from` (empty for terminal phases). */
      readonly legal: readonly BuildPhase[];
    };

/** Pure transition validator against the frozen table. */
export function checkBuildPhaseTransition(from: BuildPhase, to: BuildPhase): BuildPhaseTransitionResult {
  const legal = BUILD_PHASE_TRANSITIONS[from];
  if (legal.includes(to)) {
    return { ok: true, from, to };
  }
  return { ok: false, code: "illegal-phase-transition", from, to, legal };
}

/** The canonical complete stage sequence (frozen order, all five stages). */
export const COMPLETE_STAGE_SEQUENCE: readonly BuildStage[] = BUILD_STAGES;

/**
 * True iff `stages` is exactly the complete stage sequence — every stage,
 * in the frozen order, with no repeats, gaps or reordering. Build
 * manifests must record exactly this sequence for a successful build.
 */
export function isCompleteStageSequence(stages: readonly BuildStage[]): boolean {
  if (stages.length !== COMPLETE_STAGE_SEQUENCE.length) {
    return false;
  }
  return COMPLETE_STAGE_SEQUENCE.every((stage, index) => stages[index] === stage);
}
