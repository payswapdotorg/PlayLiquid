/**
 * COMMUNITY WORKBENCH PORTS (pure seams): how the Community UI obtains
 * authoritative read models and how user actions LEAVE the UI. The UI
 * never imports implementation modules (matrix rule) and never performs
 * IO itself — the HOST wires a `CommunityDataPort` (pulls read models
 * from the authoritative community service's read doors) and a
 * `CommunityCommandPort` (translates typed command intents into the
 * service's submit/transition doors). Everything crossing these seams is
 * already typed authoritative contract data (E5).
 *
 * COMMAND INTENTS, NOT STORE WRITES: a user action like "submit a
 * contribution" or "triage this contribution" is a TYPED INTENT dispatched
 * through the command port; the port's outcome is a typed receipt or a
 * typed REFUSAL carrying the community package's own refusal-code
 * vocabularies (E8 — imported verbatim, never forked). The UI never
 * writes contribution state directly and never rewrites recorded
 * transitions (E10).
 *
 * Intents are deliberately SMALL: the host (which owns the payload
 * pipeline and the identity facts) expands them into full authoritative
 * commands — the UI never fabricates game-ir payloads, lineage nodes or
 * model-provenance entries.
 *
 * Async/stateful documentation (spec/worker-contract.md), this seam set:
 * - Mutable state owner: the community service owns ALL domain state;
 *   the workbench store owns only its projected UI state.
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

import type {
  ContributionId,
  ContributionKind,
  ContributionRefusalCode,
  TransitionCommandKind,
  TransitionRefusalCode,
} from "../../../community/src/index.ts";
import type { TenantId, SubjectId } from "../../../platform-contracts/src/index.ts";
import type { CommunityDataSnapshot, CommunityViewer } from "./view/community-view.ts";

// ---------------------------------------------------------------------------
// The data seam (read models)
// ---------------------------------------------------------------------------

/** Result of pulling one authoritative Community read-model snapshot. */
export type CommunityLoadResult =
  | { readonly ok: true; readonly data: CommunityDataSnapshot }
  | { readonly ok: false; readonly code: "load-failed"; readonly detail: string };

/** The read-model seam of the Community workbench. */
export interface CommunityDataPort {
  load(): CommunityLoadResult;
}

// ---------------------------------------------------------------------------
// The command seam (typed intents → authoritative doors)
// ---------------------------------------------------------------------------

/** The typed refusal code of a malformed command intent (E8, UI seam). */
export type CommunityIntentRefusalCode = "invalid-intent";

/**
 * One user action as a typed intent. The submit intent names the
 * contribution KIND and the disclosure/lineage flags; the host expands it
 * into a full SubmitContributionCommand (payload, provenance entries,
 * gap link resolution).
 */
export type CommunityCommandIntent =
  | {
      readonly kind: "submit-contribution";
      readonly tenant: TenantId;
      readonly subject: SubjectId;
      /** The contribution kind (community's frozen vocabulary). */
      readonly contributionKind: ContributionKind;
      /** A short display label for the artifact the host titles the payload with. */
      readonly label: string;
      /** Honest AI disclosure (lock 11) — the host attaches model entries when true. */
      readonly aiGenerated: boolean;
      /** Whether the artifact derives from a lineage base (host resolves the node). */
      readonly lineageDerived: boolean;
      /** The R18 gap link, when this contribution addresses a Lab-recorded gap. */
      readonly gapId?: string;
    }
  | {
      readonly kind: "advance-contribution";
      readonly tenant: TenantId;
      /** The acting subject (maintainer for verdicts; contributor for withdraw). */
      readonly actor: SubjectId;
      /** The contribution to advance (full content address). */
      readonly contributionId: string;
      /** The workflow command (community's frozen vocabulary). */
      readonly command: TransitionCommandKind;
      readonly reason?: string;
    };

/** The typed receipt of an accepted intent (E10: duplicates surface). */
export type CommunityCommandReceiptOk =
  | {
      readonly ok: true;
      readonly kind: "contribution-submitted";
      readonly contributionId: ContributionId;
      readonly duplicate: boolean;
    }
  | {
      readonly ok: true;
      readonly kind: "contribution-advanced";
      readonly contributionId: ContributionId;
      readonly to: string;
      readonly duplicate: boolean;
    };

/** The typed refusal of a command intent: authoritative codes, verbatim. */
export type CommunityCommandReceiptRefused =
  | {
      readonly ok: false;
      readonly code: ContributionRefusalCode | CommunityIntentRefusalCode;
      readonly detail: string;
    }
  | {
      readonly ok: false;
      readonly code: TransitionRefusalCode | CommunityIntentRefusalCode;
      readonly detail: string;
    };

/** The outcome of one dispatched intent: a receipt or a typed refusal. */
export type CommunityCommandReceipt = CommunityCommandReceiptOk | CommunityCommandReceiptRefused;

/** The command seam of the Community workbench. */
export interface CommunityCommandPort {
  dispatch(intent: CommunityCommandIntent): CommunityCommandReceipt;
}

/** One command-log entry (intent + its outcome; append-only, E10). */
export interface CommunityCommandLogEntry {
  readonly intent: CommunityCommandIntent;
  readonly receipt: CommunityCommandReceipt;
}

/** Re-export for component/test convenience. */
export type { CommunityViewer };
