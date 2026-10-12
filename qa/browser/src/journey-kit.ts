/**
 * JOURNEY KIT — the shared, dependency-free evidence helpers of the
 * browser-journey suite (PL-043).
 *
 * What these journeys ARE: deterministic, Node-run journeys that drive the
 * REAL public APIs of the web surfaces (the stores, view models, ports and
 * command intents of game-ui / gameos-lab / gameos-community, the planning
 * + build surfaces of runtime-spark + spark, and the LUMEN RUN reference
 * game) through COMPLETE USER JOURNEYS.
 *
 * What these journeys are NOT (E11 — stated plainly, never faked): there
 * is NO browser in this gate set. No DOM, no rendering, no network, no
 * Web APIs. The journeys run the real view models and stores — the same
 * pure projections the browser mounts render — under `node --test`. The
 * browser-shims discipline of packages/web/gameos governs anything
 * browser-API-shaped elsewhere; nothing here pretends a DOM exists.
 *
 * Determinism (E9): every journey records a TRACE — an ordered list of
 * (step, facts) pairs captured at each user-visible step. Running the
 * journey twice must produce the IDENTICAL trace (deep-equal and by
 * digest). A wall clock, a random source, or an unordered object
 * iteration anywhere in the journey would surface here.
 */

import { createHash } from "node:crypto";

/** One recorded step of a journey: a name and its JSON-safe facts. */
export interface JourneyStep {
  readonly step: string;
  readonly facts: unknown;
}

/** An ordered journey trace (the E9 determinism evidence). */
export type JourneyTrace = readonly JourneyStep[];

/**
 * A journey trace recorder. `record()` appends one step (append-only —
 * E10 discipline for evidence); `digestOf()` returns the sha256 over the
 * canonical JSON of the whole trace.
 */
export interface TraceRecorder {
  /** Append one step (append-only; the trace is never rewritten). */
  record(step: string, facts: unknown): void;
  /** The trace so far (frozen copy). */
  trace(): JourneyTrace;
  /** sha256 over the canonical JSON of the trace (E9). */
  digestOf(): string;
}

/** Deterministic JSON: object keys sorted at every depth, no gaps. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** The sha256 content digest of any JSON-safe value (deterministic, E9). */
export function digestOfValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Create a trace recorder for one journey run. */
export function createTrace(): TraceRecorder {
  const steps: JourneyStep[] = [];
  return {
    record(step, facts) {
      steps.push({ step, facts });
    },
    trace() {
      return Object.freeze([...steps]);
    },
    digestOf() {
      return digestOfValue(steps);
    },
  };
}

/**
 * THE E9 journey assertion: two runs of the same journey (same seeds,
 * same wired rigs) must produce the identical trace — same steps, same
 * facts, same digest. Throws (fails the test) with a precise first
 * divergence otherwise.
 */
export function assertSameTrajectory(left: JourneyTrace, right: JourneyTrace): void {
  const firstDivergence = left.findIndex(
    (entry, index) => canonicalJson(entry) !== canonicalJson(right[index]),
  );
  if (firstDivergence === -1 && left.length === right.length) return;
  const at = firstDivergence === -1 ? Math.min(left.length, right.length) : firstDivergence;
  const message =
    firstDivergence === -1
      ? `journey traces diverge in length (${left.length} vs ${right.length}) at step ${at}`
      : `journey traces diverge at step ${at}: ${left[at]?.step} — ${canonicalJson(left[at]?.facts)} vs ${canonicalJson(right[at]?.facts)}`;
  throw new Error(message);
}
