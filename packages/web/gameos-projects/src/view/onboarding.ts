/**
 * PROJECTS ONBOARDING COPY + CONTEXTUAL NEXT STEPS (pure, UX-002): the
 * ONE owner of the first-run empty-state wording and the honest "what
 * just happened / what next" lines of the World Projects workbench
 * surfaces. Pure vocabulary module — same shape as status.ts (no IO, no
 * React, no clock), so the wording is testable at the view layer and the
 * panels render it verbatim (E1 applied to copy).
 *
 * Honesty rules (spec/ux/work-items.md frozen contract): every surface's
 * copy explains what the World Projects workbench does in plain product
 * language and names a REAL next step — `Refresh read models` performs
 * one authoritative pull through the `ProjectsDataPort`. Cross-workspace
 * suggestions are PROSE (navigation belongs to the desktop shell), and
 * operations this module does not own (creating projects, pushing
 * branches) are named as prose with their real home stated — never a
 * fake button.
 */

import type { ProjectsCommandLogEntry } from "../ports.ts";

/** The projects workbench surfaces that render a first-run empty state. */
export type ProjectsEmptySurfaceId = "projects" | "overview" | "composition" | "pull-requests";

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
 * The frozen empty-state copy per projects surface. The next step is
 * always a REAL operation of this module: one authoritative read-model
 * pull through the data port (this workbench reviews projects; creating
 * them belongs to the Studio workspace, named in prose only).
 */
export const PROJECTS_EMPTY_STATE_COPY: Readonly<Record<ProjectsEmptySurfaceId, EmptySurfaceCopy>> =
  Object.freeze({
    projects: Object.freeze({
      title: "No world projects yet",
      explanation:
        "World Projects is where each game — a Git repository with a world declaration — is inspected: its branches and recent commits, its board tasks, the exact package composition it pins (with release-gate verdicts), and its semantic pull requests under community review. No project read models reached this workbench yet.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Projects are created and pushed in the Studio workspace (navigation belongs to the host shell); this workbench reviews what the authoritative services already record.",
        "Each project row resolves its world kind through the ACR-001 read model — a project with no world declaration is a pre-ACR project and renders as `game`.",
      ]),
    }),
    overview: Object.freeze({
      title: "No project open",
      explanation:
        "The Overview surface shows one project's Git shape — branches with their last commits, the recent commit history and the board tasks. Open a project on the projects list to inspect it.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Pick a project on the projects list (left column) and choose open project.",
        "Every game is a Git repository (R1): branch and commit identity render from the game-contracts git vocabulary.",
      ]),
    }),
    composition: Object.freeze({
      title: "No package composition to show",
      explanation:
        "The Composition surface shows the exact packages the open project pins — kind, id, semantic version, content digest and the release-gate verdict of each pin. Either no project is open, or the open project pins no packages yet.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Pins are exact package coordinates; publication gates fail closed on provenance and licensing (R19), and blocked pins render their failure summaries verbatim.",
        "Composing packages happens in the Studio workspace; this surface is the read model of what the project already pins.",
      ]),
    }),
    "pull-requests": Object.freeze({
      title: "No semantic pull requests to review",
      explanation:
        "The Pull Requests surface shows the open project's semantic pull requests: the change kinds git-lineage classified for each change set, the subjects they touch, and the community lifecycle every review action drives (submitted → triaged → under-review → accepted/rejected/withdrawn). Either no project is open, or the open project has no pull requests.",
      nextStepLabel: "Refresh read models",
      guidance: Object.freeze([
        "Open a pull request's review to see its change-kind counts and dispatch typed review intents; verdicts are terminal and corrected work is a new pull request (E10).",
        "Review actions are typed intents through the command port — the community service owns admission, and refusals surface verbatim (E8).",
      ]),
    }),
  } satisfies Record<ProjectsEmptySurfaceId, EmptySurfaceCopy>);

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
export function commandLogNextHint(log: readonly ProjectsCommandLogEntry[]): string | null {
  const last = log[log.length - 1];
  if (last === undefined) return null;
  if (last.receipt.ok) {
    return `What just happened: ${last.intent.kind} → ${last.intent.command} accepted at ${last.receipt.at}. What next: choose Refresh read models to pull the updated pull-request states (append-only lifecycle, E10).`;
  }
  return `What just happened: ${last.intent.kind} (${last.intent.command}) was refused (${last.receipt.code}) — the refusal is recorded verbatim in the log (E8). What next: correct the intent and dispatch it again; there are no hidden retries.`;
}
