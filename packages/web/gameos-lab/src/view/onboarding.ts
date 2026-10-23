/**
 * LAB ONBOARDING COPY + CONTEXTUAL NEXT STEPS (pure, UX-002): the ONE
 * owner of the first-run empty-state wording and the honest "what just
 * happened / what next" lines of the Lab workbench surfaces. Pure
 * vocabulary module — same shape as status.ts (no IO, no React, no
 * clock), so the wording is testable at the view layer and the panels
 * render it verbatim (E1 applied to copy).
 *
 * Honesty rules (spec/ux/work-items.md frozen contract): every surface's
 * copy explains what the Lab does in plain product language and names a
 * REAL next step — `Request a search` dispatches one typed intent through
 * the `LabCommandPort` (the organization service owns admission) and
 * `Refresh read models` performs one authoritative pull through the
 * `LabDataPort`. Cross-workspace suggestions are PROSE (navigation
 * belongs to the desktop shell), and unsupported operations are marked
 * "not yet supported" with the missing prerequisite stated — never a fake
 * button.
 */

import type { LabCommandLogEntry } from "../ports.ts";

/** The Lab surfaces that render a first-run empty state. */
export type LabEmptySurfaceId =
  | "searches"
  | "evidence"
  | "learning"
  | "guidance"
  | "gaps"
  | "arena";

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
 * The frozen empty-state copy per Lab surface. The next step is always a
 * REAL operation: the request-search typed intent (Searches) or one
 * authoritative read-model pull (the other surfaces).
 */
export const LAB_EMPTY_STATE_COPY: Readonly<Record<LabEmptySurfaceId, EmptySurfaceCopy>> = Object.freeze(
  {
    searches: Object.freeze({
      title: "No organization searches yet",
      explanation:
        "The Game Engineering Lab is PlayLiquid's research workbench. A search session explores a deterministic space of engineering organizations for your project — the same seed always yields the same space (E9) — and streams the candidates it finds. No search has been opened in this workspace yet.",
      nextStepLabel: "Request a search",
      guidance: Object.freeze([
        "Requesting a search sends one typed intent through the Lab command port — the organization service owns admission. A build without a pinned project revision is refused honestly with the typed invalid-context code.",
        "As searches run, their results feed the Evidence, Learning and Guidance surfaces.",
      ]),
    }),
    evidence: Object.freeze({
      title: "No evaluation evidence recorded",
      explanation:
        "Evidence rows are immutable, content-addressed records of candidate evaluations — each one a labeled estimate with its method, seed, tick budget and replay id, never an observation (E11). The evidence ledger starts empty because no desktop pipeline feeds it yet.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Recording evaluation evidence from the desktop is not yet supported — the missing prerequisite is a wired evaluation-suite directory in the host.",
        "Run a search on the Searches surface to start the research loop that evidence records.",
      ]),
    }),
    learning: Object.freeze({
      title: "No learning cycles recorded",
      explanation:
        "When a research cycle completes, the Lab seals it into a content-addressed learning record and derives dimension-affinity signals and guidance for the next search. Nothing has been learned yet, so there are no records, signals or guidance to show.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Learning cycles are sealed by the Lab loop itself — this surface is a read model with no manual control.",
      ]),
    }),
    guidance: Object.freeze({
      title: "No guidance derived yet",
      explanation:
        "Guidance tells the next search where to look, in two honestly separate classes: observed-evidence guidance (green) built only from what was observed, and labeled-estimate guidance (teal) that additionally carries its estimate method and content-addressed basis. Guidance appears after the first learning cycles are sealed.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "To start the loop, open the Searches surface (top tab row) and request a search.",
        "Estimates are reviewable, not more true — simulator output is not ground truth (lock 29).",
      ]),
    }),
    gaps: Object.freeze({
      title: "No capability gaps recorded",
      explanation:
        "When the Lab cannot solve something by itself, the recurring capability gap is recorded here and climbs a frozen resolution ladder one rung at a time — existing organization, alternate organization, package platform capability, user community contribution, Arena escalation, then blocked. No gap has recurred yet.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Advancing a rung sends a typed intent through the Lab command port; the authoritative gap door owns admission — rung skips and rule violations surface verbatim (E8).",
      ]),
    }),
    arena: Object.freeze({
      title: "No Arena escalation cases",
      explanation:
        "Arena is an external, optional human-capability provider. A case appears here only when a host-issued, verified decision escalates a capability gap to Arena — this surface never sends anything to Arena. The desktop host configures no external Arena connection, so it honestly shows zero cases.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Connecting an Arena provider from this surface is not yet supported — the missing prerequisite is an external Arena connection configured by the host (R18: escalation is decided, never automatic).",
      ]),
    }),
  } satisfies Record<LabEmptySurfaceId, EmptySurfaceCopy>,
);

/**
 * The honest "what next" line after a read-model refresh failure (rendered
 * under the E11 banner). Null when no failure is recorded.
 */
export function refreshFailureNextStep(loadError: string | null): string | null {
  if (loadError === null) return null;
  return "What next: the last good read models above still render — nothing was dropped. Choose Refresh read models to pull the authoritative snapshot again; the recorded error stays until a pull succeeds.";
}

/** The plain label of one accepted receipt kind (same vocabulary the log renders). */
function receiptLabel(kind: "search-opened" | "gap-advanced"): string {
  return kind === "search-opened" ? "search opened" : "gap advanced";
}

/**
 * The honest "what just happened / what next" line under the append-only
 * command log once at least one intent was dispatched. Null while the log
 * is empty (the log's own empty note covers that case).
 */
export function commandLogNextHint(log: readonly LabCommandLogEntry[]): string | null {
  const last = log[log.length - 1];
  if (last === undefined) return null;
  if (last.receipt.ok) {
    const followUp =
      last.receipt.kind === "search-opened"
        ? "choose Refresh read models to pull the new session, then select it on the Searches surface to inspect its candidate stream"
        : "choose Refresh read models to pull the updated gap summaries";
    return `What just happened: ${last.intent.kind} → ${receiptLabel(last.receipt.kind)}. What next: ${followUp}.`;
  }
  return `What just happened: ${last.intent.kind} was refused (${last.receipt.code}) — the refusal is recorded verbatim in the log (E8). What next: correct the intent and dispatch it again; there are no hidden retries.`;
}
