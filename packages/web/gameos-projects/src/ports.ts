/**
 * WORLD PROJECTS WORKBENCH PORTS (pure seams): how the projects UI
 * obtains authoritative read models and how user actions LEAVE the UI.
 * The UI never imports implementation modules (matrix rule) and never
 * performs IO itself — the HOST wires a `ProjectsDataPort` (pulls read
 * models from the authoritative services' read doors: the project
 * registry, the package-registry composition/gate doors and the
 * community pull-request doors) and a `ProjectsCommandPort` (translates
 * typed command intents into the community package's transition doors).
 * Everything crossing these seams is already typed authoritative
 * contract data (E5).
 *
 * COMMAND INTENTS, NOT STORE WRITES: a review action like "triage this
 * pull request" is a TYPED INTENT dispatched through the command port;
 * the port's outcome is a typed receipt or a typed REFUSAL carrying the
 * community package's own refusal vocabulary where it applies (E8 —
 * imported verbatim, never forked). The UI never writes pull-request
 * state directly and never rewrites recorded transitions (E10). The
 * host expands the small intent (prId + command) into the full
 * authoritative transition command (tenant, actor, reason).
 *
 * Async/stateful documentation (spec/worker-contract.md), this seam set:
 * - Mutable state owner: the authoritative services own ALL domain
 *   state; the workbench store owns only its projected UI state.
 * - Command admission: the STORE refuses malformed intents and
 *   cross-tenant transitions BEFORE any domain call (R20/E8); everything
 *   else is the port's — the host either forwards the intent to the
 *   authoritative door or refuses it typed.
 * - Event order: command receipts append to the UI's command log in
 *   dispatch order (append-only, E10); the store serializes concurrent
 *   dispatches so no outcome interleaves.
 * - Stale results: a refreshed snapshot replaces the read model
 *   wholesale; nothing is dropped silently (E11).
 * - Retry/cancellation: no hidden retries. A refused command stays
 *   refused until the user dispatches a corrected intent.
 */

import { TRANSITION_COMMANDS } from "../../../community/src/index.ts";
import type {
  ContributionId,
  TransitionCommandKind,
  TransitionRefusalCode,
} from "../../../community/src/index.ts";
import type { ProjectsDataSnapshot } from "./view/projects-view.ts";

// ---------------------------------------------------------------------------
// The data seam (read models)
// ---------------------------------------------------------------------------

/** Result of pulling one authoritative World Projects read-model snapshot. */
export type ProjectsLoadResult =
  | { readonly ok: true; readonly data: ProjectsDataSnapshot }
  | { readonly ok: false; readonly code: "load-failed"; readonly detail: string };

/** The read-model seam of the projects workbench. */
export interface ProjectsDataPort {
  load(): ProjectsLoadResult;
}

// ---------------------------------------------------------------------------
// The command seam (typed intents → authoritative community doors)
// ---------------------------------------------------------------------------

/** The typed refusal code of a malformed command intent (E8, UI seam). */
export type ProjectsIntentRefusalCode = "invalid-intent";

/**
 * The UI-seam transition refusal codes: the store refuses BEFORE any
 * domain call when the pull request belongs to another tenant (R20), or
 * with the generic transition-refused code when a host cannot map its
 * own refusal onto the community vocabulary.
 */
export type ProjectsTransitionRefusalCode = "transition-refused" | "cross-tenant";

/**
 * One user action as a typed intent: advance one semantic pull request
 * through community's frozen lifecycle. The host expands it into the
 * full authoritative transition command — the UI never fabricates
 * tenants, actors or reasons.
 */
export type ProjectsCommandIntent = {
  readonly kind: "transition-pull-request";
  /** The pull request to advance (its content-addressed contribution id). */
  readonly prId: ContributionId;
  /** The review command (community's frozen vocabulary). */
  readonly command: TransitionCommandKind;
};

/** The typed receipt of an accepted intent (E10). */
export type ProjectsCommandReceiptOk = {
  readonly ok: true;
  readonly prId: ContributionId;
  readonly command: TransitionCommandKind;
  /** When the authoritative door recorded the transition (epoch ms). */
  readonly at: number;
};

/**
 * The typed refusal of a command intent: the UI seam's own codes plus
 * the community package's transition refusal vocabulary, verbatim (E8).
 */
export type ProjectsCommandReceiptRefused = {
  readonly ok: false;
  readonly code: ProjectsIntentRefusalCode | ProjectsTransitionRefusalCode | TransitionRefusalCode;
  readonly detail: string;
};

/** The outcome of one dispatched intent: a receipt or a typed refusal. */
export type ProjectsCommandReceipt = ProjectsCommandReceiptOk | ProjectsCommandReceiptRefused;

/** The command seam of the projects workbench (async: crosses a service). */
export interface ProjectsCommandPort {
  dispatch(intent: ProjectsCommandIntent): Promise<ProjectsCommandReceipt>;
}

/** One command-log entry (intent + its outcome; append-only, E10). */
export interface ProjectsCommandLogEntry {
  readonly intent: ProjectsCommandIntent;
  readonly receipt: ProjectsCommandReceipt;
}

// ---------------------------------------------------------------------------
// Intent shape admission (E8 — the ONE owner; store and fakes share it)
// ---------------------------------------------------------------------------

/**
 * Structural validation of one intent against the community package's
 * FROZEN transition-command vocabulary (imported, never re-declared):
 * returns the typed refusal detail when the intent is malformed, null
 * when it is well-formed. An invalid intent is refused BEFORE any
 * domain call — it never reaches the command port.
 */
export function projectsIntentProblem(intent: ProjectsCommandIntent): string | null {
  if (intent.kind !== "transition-pull-request") {
    return `unknown intent kind: ${String(intent.kind)}`;
  }
  if (typeof intent.prId !== "string" || intent.prId.length === 0) {
    return "prId is empty";
  }
  if (!(TRANSITION_COMMANDS as readonly string[]).includes(intent.command)) {
    return "command is not a member of the frozen transition-command vocabulary";
  }
  return null;
}
