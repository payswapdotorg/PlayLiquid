/**
 * gameos-projects LOCAL TEST DOUBLES (TEST SUPPORT ONLY — lock rule 44:
 * no hidden mocks presented as production).
 *
 * - {@link StaticProjectsDataPort}: a port over one fixed snapshot (or a
 *   fixed failure) — the demo mount and store tests use it.
 * - {@link ScriptedProjectsDataPort}: returns scripted results in
 *   order, then sticks on the last one (success/failure sequences for
 *   the store).
 * - {@link ScriptedProjectsCommandPort}: an ASYNC command seam that
 *   FIRST validates the intent's shape against the community package's
 *   own FROZEN transition-command vocabulary through the shared
 *   `projectsIntentProblem` seam rule (refusing malformed intents with
 *   the typed `invalid-intent` code — E8: an invalid intent never
 *   reaches a domain door), then returns scripted receipts. Everything
 *   is deterministic; no IO, no timers, no globals.
 *
 * No production integration is implied by anything in this file.
 */

import { projectsIntentProblem } from "./ports.ts";
import type {
  ProjectsCommandIntent,
  ProjectsCommandPort,
  ProjectsCommandReceipt,
  ProjectsDataPort,
  ProjectsLoadResult,
} from "./ports.ts";
import type { ProjectsDataSnapshot } from "./view/projects-view.ts";

// ---------------------------------------------------------------------------
// Data-port doubles
// ---------------------------------------------------------------------------

/** A port over one fixed snapshot (or a fixed failure). */
export class StaticProjectsDataPort implements ProjectsDataPort {
  readonly #result: ProjectsLoadResult;

  constructor(data: ProjectsDataSnapshot, options?: { readonly failWith?: string }) {
    this.#result =
      options?.failWith === undefined
        ? { ok: true, data }
        : { ok: false, code: "load-failed", detail: options.failWith };
  }

  load(): ProjectsLoadResult {
    return this.#result;
  }
}

/**
 * A scripted port: returns the script results in order, then sticks on
 * the last one. An empty script always fails (typed, never a throw).
 */
export class ScriptedProjectsDataPort implements ProjectsDataPort {
  readonly #script: readonly ProjectsLoadResult[];
  #next = 0;

  constructor(script: readonly ProjectsLoadResult[]) {
    this.#script = [...script];
  }

  load(): ProjectsLoadResult {
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

/**
 * A scripted ASYNC command port: malformed intents are refused with the
 * typed `invalid-intent` code BEFORE any script is consulted (E8 — the
 * same shared seam rule the store applies); well-formed intents return
 * the scripted receipts in order, then stick on the last. Every received
 * intent is recorded for evidence.
 */
export class ScriptedProjectsCommandPort implements ProjectsCommandPort {
  readonly #script: readonly ProjectsCommandReceipt[];
  #next = 0;
  readonly #received: readonly ProjectsCommandIntent[] = [];

  constructor(script: readonly ProjectsCommandReceipt[]) {
    this.#script = [...script];
  }

  /** Every intent received, in dispatch order (evidence for tests). */
  get received(): readonly ProjectsCommandIntent[] {
    return [...this.#received];
  }

  dispatch(intent: ProjectsCommandIntent): Promise<ProjectsCommandReceipt> {
    (this.#received as ProjectsCommandIntent[]).push(intent);
    const problem = projectsIntentProblem(intent);
    if (problem !== null) {
      return Promise.resolve({ ok: false, code: "invalid-intent", detail: problem });
    }
    if (this.#script.length === 0) {
      return Promise.resolve({
        ok: false,
        code: "invalid-intent",
        detail: "scripted command port has no receipts",
      });
    }
    const index = Math.min(this.#next, this.#script.length - 1);
    this.#next += 1;
    return Promise.resolve(this.#script[index]!);
  }
}
