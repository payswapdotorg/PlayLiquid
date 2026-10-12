/**
 * gameos-lab LOCAL TEST DOUBLES (TEST SUPPORT ONLY — lock rule 44: no
 * hidden mocks presented as production).
 *
 * - {@link StaticLabDataPort}: a port over one fixed snapshot (or a
 *   fixed failure) — the demo mount and store tests use it.
 * - {@link ScriptedLabDataPort}: returns scripted results in order, then
 *   sticks on the last one (success/failure sequences for the store).
 * - {@link ScriptedLabCommandPort}: a command seam that FIRST validates
 *   the intent's shape (refusing malformed intents with the typed
 *   `invalid-intent` code — E8: an invalid intent never reaches a domain
 *   door), then returns scripted receipts. Everything is deterministic;
 *   no IO, no timers, no globals.
 *
 * No production integration is implied by anything in this file.
 */

import type {
  LabCommandIntent,
  LabCommandReceipt,
  LabCommandPort,
  LabDataPort,
  LabLoadResult,
} from "./ports.ts";
import type { LabDataSnapshot } from "./view/lab-view.ts";

// ---------------------------------------------------------------------------
// Data-port doubles
// ---------------------------------------------------------------------------

/** A port over one fixed snapshot (or a fixed failure). */
export class StaticLabDataPort implements LabDataPort {
  readonly #result: LabLoadResult;

  constructor(data: LabDataSnapshot, options?: { readonly failWith?: string }) {
    this.#result =
      options?.failWith === undefined
        ? { ok: true, data }
        : { ok: false, code: "load-failed", detail: options.failWith };
  }

  load(): LabLoadResult {
    return this.#result;
  }
}

/**
 * A scripted port: returns the script results in order, then sticks on
 * the last one. An empty script always fails (typed, never a throw).
 */
export class ScriptedLabDataPort implements LabDataPort {
  readonly #script: readonly LabLoadResult[];
  #next = 0;

  constructor(script: readonly LabLoadResult[]) {
    this.#script = [...script];
  }

  load(): LabLoadResult {
    if (this.#script.length === 0) {
      return { ok: false, code: "load-failed", detail: "scripted port has no results" };
    }
    const index = Math.min(this.#next, this.#script.length - 1);
    this.#next += 1;
    return (
      this.#script[index] ?? { ok: false, code: "load-failed", detail: "scripted port has no results" }
    );
  }
}

// ---------------------------------------------------------------------------
// Command-port double
// ---------------------------------------------------------------------------

/** Structural validation of one intent (mirrors the type, enforces E8). */
function intentProblem(intent: LabCommandIntent): string | null {
  switch (intent.kind) {
    case "request-search":
      if (intent.cycleId.length === 0) return "cycleId is empty";
      if (intent.seed.length === 0) return "seed is empty";
      if (!Number.isSafeInteger(intent.maxAgents) || intent.maxAgents < 1) {
        return "maxAgents must be a positive integer";
      }
      return null;
    case "advance-gap-rung":
      if (intent.gapId.length === 0) return "gapId is empty";
      if (intent.rung === "blocked") return "blocked is terminal; no rung may be requested";
      return null;
    default:
      return "unknown intent kind";
  }
}

/**
 * A scripted command port: malformed intents are refused with the typed
 * `invalid-intent` code BEFORE any script is consulted (E8); well-formed
 * intents return the scripted receipts in order, then stick on the last.
 * Every received intent is recorded for evidence.
 */
export class ScriptedLabCommandPort implements LabCommandPort {
  readonly #script: readonly LabCommandReceipt[];
  #next = 0;
  readonly #received: readonly LabCommandIntent[] = [];

  constructor(script: readonly LabCommandReceipt[]) {
    this.#script = [...script];
  }

  /** Every intent received, in dispatch order (evidence for tests). */
  get received(): readonly LabCommandIntent[] {
    return [...this.#received];
  }

  dispatch(intent: LabCommandIntent): LabCommandReceipt {
    (this.#received as LabCommandIntent[]).push(intent);
    const problem = intentProblem(intent);
    if (problem !== null) {
      return { ok: false, code: "invalid-intent", detail: problem };
    }
    if (this.#script.length === 0) {
      return { ok: false, code: "invalid-intent", detail: "scripted command port has no receipts" };
    }
    const index = Math.min(this.#next, this.#script.length - 1);
    this.#next += 1;
    return this.#script[index]!;
  }
}
