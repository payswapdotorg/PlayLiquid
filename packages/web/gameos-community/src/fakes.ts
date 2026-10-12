/**
 * gameos-community LOCAL TEST DOUBLES (TEST SUPPORT ONLY — lock rule 44:
 * no hidden mocks presented as production).
 *
 * - {@link StaticCommunityDataPort}: a port over one fixed snapshot (or a
 *   fixed failure) — the demo mount and store tests use it.
 * - {@link ScriptedCommunityDataPort}: returns scripted results in
 *   order, then sticks on the last one (success/failure sequences for
 *   the store).
 * - {@link ScriptedCommunityCommandPort}: a command seam that FIRST
 *   validates the intent's shape against the community package's own
 *   FROZEN vocabularies (refusing malformed intents with the typed
 *   `invalid-intent` code — E8: an invalid intent never reaches a domain
 *   door), then returns scripted receipts. Everything is deterministic;
 *   no IO, no timers, no globals.
 *
 * No production integration is implied by anything in this file.
 */

import {
  CONTRIBUTION_KINDS,
  MAX_REASON_LENGTH,
  TRANSITION_COMMANDS,
} from "../../../community/src/index.ts";
import type {
  CommunityCommandIntent,
  CommunityCommandPort,
  CommunityCommandReceipt,
  CommunityDataPort,
  CommunityLoadResult,
} from "./ports.ts";
import type { CommunityDataSnapshot } from "./view/community-view.ts";

// ---------------------------------------------------------------------------
// Data-port doubles
// ---------------------------------------------------------------------------

/** A port over one fixed snapshot (or a fixed failure). */
export class StaticCommunityDataPort implements CommunityDataPort {
  readonly #result: CommunityLoadResult;

  constructor(data: CommunityDataSnapshot, options?: { readonly failWith?: string }) {
    this.#result =
      options?.failWith === undefined
        ? { ok: true, data }
        : { ok: false, code: "load-failed", detail: options.failWith };
  }

  load(): CommunityLoadResult {
    return this.#result;
  }
}

/**
 * A scripted port: returns the script results in order, then sticks on
 * the last one. An empty script always fails (typed, never a throw).
 */
export class ScriptedCommunityDataPort implements CommunityDataPort {
  readonly #script: readonly CommunityLoadResult[];
  #next = 0;

  constructor(script: readonly CommunityLoadResult[]) {
    this.#script = [...script];
  }

  load(): CommunityLoadResult {
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
 * Structural validation of one intent against the community package's
 * FROZEN vocabularies (imported, never re-declared) — mirrors the type,
 * enforces E8.
 */
function intentProblem(intent: CommunityCommandIntent): string | null {
  switch (intent.kind) {
    case "submit-contribution":
      if (!(CONTRIBUTION_KINDS as readonly string[]).includes(intent.contributionKind)) {
        return "contributionKind is not a member of the frozen contribution-kind vocabulary";
      }
      if (intent.label.length === 0) return "label is empty";
      return null;
    case "advance-contribution":
      if (intent.contributionId.length === 0) return "contributionId is empty";
      if (!(TRANSITION_COMMANDS as readonly string[]).includes(intent.command)) {
        return "command is not a member of the frozen transition-command vocabulary";
      }
      if (intent.reason !== undefined && intent.reason.length > MAX_REASON_LENGTH) {
        return `reason exceeds ${MAX_REASON_LENGTH} characters`;
      }
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
export class ScriptedCommunityCommandPort implements CommunityCommandPort {
  readonly #script: readonly CommunityCommandReceipt[];
  #next = 0;
  readonly #received: readonly CommunityCommandIntent[] = [];

  constructor(script: readonly CommunityCommandReceipt[]) {
    this.#script = [...script];
  }

  /** Every intent received, in dispatch order (evidence for tests). */
  get received(): readonly CommunityCommandIntent[] {
    return [...this.#received];
  }

  dispatch(intent: CommunityCommandIntent): CommunityCommandReceipt {
    (this.#received as CommunityCommandIntent[]).push(intent);
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
