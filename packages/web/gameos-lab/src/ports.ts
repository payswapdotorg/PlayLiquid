/**
 * LAB WORKBENCH PORTS (pure seams): how the Lab UI obtains authoritative
 * read models and how user actions LEAVE the UI. The UI never imports
 * implementation modules (matrix rule) and never performs IO itself —
 * the HOST wires a `LabDataPort` (pulls read models from the
 * authoritative Lab services) and a `LabCommandPort` (translates typed
 * command intents into authoritative service doors). Everything crossing
 * these seams is already typed authoritative contract data (E5).
 *
 * COMMAND INTENTS, NOT STORE WRITES (E13 of the house discipline, "AI
 * emits typed intents; authoritative systems own state mutation"): a
 * user action like "request a search" or "advance a gap rung" is a TYPED
 * INTENT dispatched through the command port; the port's outcome is a
 * typed receipt or a typed REFUSAL carrying the authoritative package's
 * own refusal-code vocabulary (E8 — imported verbatim, never forked).
 * The UI never writes Lab state directly and never mutates recorded
 * evidence (E10).
 *
 * Async/stateful documentation (spec/worker-contract.md), this seam set:
 * - Mutable state owner: the authoritative services own ALL domain
 *   state; the workbench store owns only its projected UI state.
 * - Command admission: the HOST decides — the port either forwards the
 *   intent to the authoritative door or refuses it (invalid intents are
 *   refused before any domain call).
 * - Event order: command receipts append to the UI's command log in
 *   dispatch order (append-only, E10).
 * - Idempotency: the authoritative doors are content-addressed; a
 *   replayed intent returns the recorded receipt (E10), surfaced as a
 *   `duplicate: true` receipt the UI renders.
 * - Stale results: a refreshed snapshot replaces the read model
 *   wholesale; nothing is dropped silently (E11).
 * - Retry/cancellation: no hidden retries. A refused command stays
 *   refused until the user dispatches a corrected intent.
 */

import type { GapLadderRung } from "../../../lab-contracts/src/index.ts";
import type {
  GapDoorRefusalCode,
  SearchOpenRefusalCode,
} from "../../../lab-organization/src/index.ts";
import type { TenantId, SubjectId } from "../../../platform-contracts/src/index.ts";
import type { LabDataSnapshot, LabViewer } from "./view/lab-view.ts";

// ---------------------------------------------------------------------------
// The data seam (read models)
// ---------------------------------------------------------------------------

/** Result of pulling one authoritative Lab read-model snapshot. */
export type LabLoadResult =
  | { readonly ok: true; readonly data: LabDataSnapshot }
  | { readonly ok: false; readonly code: "load-failed"; readonly detail: string };

/** The read-model seam of the Lab workbench. */
export interface LabDataPort {
  load(): LabLoadResult;
}

// ---------------------------------------------------------------------------
// The command seam (typed intents → authoritative doors)
// ---------------------------------------------------------------------------

/** The typed refusal code of a malformed command intent (E8, UI seam). */
export type LabIntentRefusalCode = "invalid-intent";

/**
 * One user action as a typed intent. Intents are deliberately SMALL: the
 * host (which owns the catalogs) expands them into full authoritative
 * requests — the UI never fabricates model catalogs or evidence bundles.
 */
export type LabCommandIntent =
  | {
      readonly kind: "request-search";
      readonly tenant: TenantId;
      readonly subject: SubjectId;
      readonly cycleId: string;
      readonly seed: string;
      readonly maxAgents: number;
    }
  | {
      readonly kind: "advance-gap-rung";
      readonly tenant: TenantId;
      readonly subject: SubjectId;
      readonly gapId: string;
      readonly rung: GapLadderRung;
      readonly disposition: "attempted" | "unavailable" | "declined";
      readonly outcome?: "resolved" | "unresolved";
    };

/** The typed receipt of an accepted intent (E10: duplicates surface). */
export type LabCommandReceiptOk =
  | {
      readonly ok: true;
      readonly kind: "search-opened";
      readonly searchId: string;
      readonly size: number;
      readonly spaceDigest: string;
      readonly position: number;
      readonly duplicate: boolean;
    }
  | {
      readonly ok: true;
      readonly kind: "gap-advanced";
      readonly gapId: string;
      readonly rung: GapLadderRung;
      readonly duplicate: boolean;
    };

/** The typed refusal of a command intent: authoritative codes, verbatim. */
export type LabCommandReceiptRefused =
  | {
      readonly ok: false;
      readonly code: SearchOpenRefusalCode | LabIntentRefusalCode;
      readonly detail: string;
    }
  | {
      readonly ok: false;
      readonly code: GapDoorRefusalCode | LabIntentRefusalCode;
      readonly detail: string;
    };

/** The outcome of one dispatched intent: a receipt or a typed refusal. */
export type LabCommandReceipt = LabCommandReceiptOk | LabCommandReceiptRefused;

/** The command seam of the Lab workbench. */
export interface LabCommandPort {
  dispatch(intent: LabCommandIntent): LabCommandReceipt;
}

/** One command-log entry (intent + its outcome; append-only, E10). */
export interface LabCommandLogEntry {
  readonly intent: LabCommandIntent;
  readonly receipt: LabCommandReceipt;
}

/** Re-export for component/test convenience. */
export type { LabViewer };
