/**
 * PROJECTS WORKBENCH SELECTION (pure): the UI's selection state — which
 * detail tab is active (Overview / Composition / Pull Requests), which
 * project is open and which semantic pull request is picked for review.
 * Data lives in the snapshot and its projections only; selection carries
 * NO data (game-ui/gameos-lab/gameos-community precedent).
 *
 * Pure module: no IO, no React.
 */

import type { TenantId, SubjectId } from "../../../../platform-contracts/src/index.ts";

/** The projects workbench's detail tabs (navigation order). */
export type ProjectsTab = "overview" | "composition" | "pull-requests";

/** Who is reading (the read model's tenant scope, R20). */
export interface ProjectsViewer {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  /** Display name the host resolved for the viewer subject. */
  readonly displayName: string;
}

/**
 * A typed selection refusal (R20): the viewer tried to open an entity
 * (a project, or a pull request for transition) that belongs to another
 * tenant. Rendered as a visible state — never silent, never a crash
 * (E8 applied to the UI boundary; the code is the house `cross-tenant`
 * vocabulary, never re-invented).
 */
export interface ProjectsSelectionRefusal {
  readonly code: "cross-tenant";
  readonly detail: string;
}

/** The projects workbench UI state (selections only; data lives in view models). */
export interface ProjectsSelection {
  readonly tab: ProjectsTab;
  /** The open project id, or null (no project open). */
  readonly projectId: string | null;
  /** The picked semantic pull request id (full content address), or null. */
  readonly prId: string | null;
}

/** The default selection (Overview tab, nothing open, nothing picked). */
export const INITIAL_PROJECTS_SELECTION: ProjectsSelection = {
  tab: "overview",
  projectId: null,
  prId: null,
};
