/**
 * COMMUNITY ONBOARDING COPY + CONTEXTUAL NEXT STEPS (pure, UX-002): the
 * ONE owner of the first-run empty-state wording and the honest "what
 * just happened / what next" lines of the Community workbench surfaces.
 * Pure vocabulary module — same shape as status.ts (no IO, no React, no
 * clock), so the wording is testable at the view layer and the panels
 * render it verbatim (E1 applied to copy).
 *
 * Honesty rules (spec/ux/work-items.md frozen contract): every surface's
 * copy explains what the Community does in plain product language and
 * names a REAL next step — `Submit an issue` dispatches one typed intent
 * through the `CommunityCommandPort` (the community service owns
 * admission) and `Refresh read models` performs one authoritative pull
 * through the `CommunityDataPort`. Cross-workspace suggestions are PROSE
 * (navigation belongs to the desktop shell), and unsupported operations
 * are marked "not yet supported" with the missing prerequisite stated —
 * never a fake button.
 */

import type { CommunityCommandLogEntry } from "../ports.ts";

/** The Community surfaces that render a first-run empty state. */
export type CommunityEmptySurfaceId = "contributions" | "lifecycle" | "provenance";

/** The copy of one empty surface (rendered by components/empty-surface.tsx). */
export interface EmptySurfaceCopy {
  /** What is absent, in one short plain-language line. */
  readonly title: string;
  /** What this surface does (and what PlayLiquid is), plain product language. */
  readonly explanation: string;
  /** The label of the REAL next-step control (performs a supported operation). */
  readonly nextStepLabel: string;
  /** Extra prose lines: cross-surface suggestions, honest limitations. */
  readonly guidance: readonly string[];
}

/**
 * The frozen empty-state copy per Community surface. The next step is
 * always a REAL operation: the submit-contribution typed intent
 * (Contributions) or one authoritative read-model pull (the others).
 */
export const COMMUNITY_EMPTY_STATE_COPY: Readonly<Record<CommunityEmptySurfaceId, EmptySurfaceCopy>> =
  Object.freeze({
    contributions: Object.freeze({
      title: "No contributions yet",
      explanation:
        "Community is where work is contributed, reviewed and qualified. Every submission carries its full provenance — contributor, origin lineage, honest AI disclosure — and moves through a normal Git-style lifecycle: submitted → triaged → under-review → accepted, rejected or withdrawn. Nothing has been contributed in this workspace yet.",
      nextStepLabel: "Submit an issue",
      guidance: Object.freeze([
        "Submitting sends one typed intent through the Community command port — the community service owns admission, and the accepted submission becomes a content-addressed record with provenance.",
        "Verdicts are terminal; corrected work is a new submission (E10).",
      ]),
    }),
    lifecycle: Object.freeze({
      title: "No workflow transitions recorded",
      explanation:
        "The lifecycle ledger is append-only (E10): every triage, review or verdict is recorded with its authority and its reason, and recorded transitions are never rewritten, reordered or dropped. It fills as contributions move through their lifecycle.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Workflow intents (triage, review) act on the contribution selected on the Contributions surface — open one there first.",
      ]),
    }),
    provenance: Object.freeze({
      title: "No contribution selected",
      explanation:
        "The provenance surface shows one contribution's full chain: contributor, origin lineage, content address, honest AI disclosure with every model-provenance entry, its capability-gap link and its trust state. Open a contribution to inspect it.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Pick a contribution on the Contributions surface (top tab row) and choose open provenance.",
        "Provenance is visible on every row (R19); third-party work stays untrusted until qualified at accept (E8).",
      ]),
    }),
  } satisfies Record<CommunityEmptySurfaceId, EmptySurfaceCopy>);

/**
 * The honest "what next" line after a read-model refresh failure (rendered
 * under the E11 banner). Null when no failure is recorded.
 */
export function refreshFailureNextStep(loadError: string | null): string | null {
  if (loadError === null) return null;
  return "What next: the last good read models above still render — nothing was dropped. Choose Refresh read models to pull the authoritative snapshot again; the recorded error stays until a pull succeeds.";
}

/**
 * The honest "what just happened / what next" line under the append-only
 * command log once at least one intent was dispatched. Null while the log
 * is empty (the log's own empty note covers that case).
 */
export function commandLogNextHint(log: readonly CommunityCommandLogEntry[]): string | null {
  const last = log[log.length - 1];
  if (last === undefined) return null;
  if (last.receipt.ok) {
    const followUp =
      last.receipt.kind === "contribution-submitted"
        ? "choose Refresh read models to pull the new record, then open it on the Contributions surface to inspect its provenance"
        : "choose Refresh read models to pull the updated lifecycle ledger (append-only, E10)";
    return `What just happened: ${last.intent.kind} → ${last.receipt.kind}. What next: ${followUp}.`;
  }
  return `What just happened: ${last.intent.kind} was refused (${last.receipt.code}) — the refusal is recorded verbatim in the log (E8). What next: correct the intent and dispatch it again; there are no hidden retries.`;
}
