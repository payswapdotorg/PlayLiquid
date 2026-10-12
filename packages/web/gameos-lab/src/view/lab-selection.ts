/**
 * LAB WORKBENCH SELECTION (pure): the UI's selection state — which tab is
 * active and which entities are picked. Data lives in the snapshot and
 * its projections only; selection carries NO data (game-ui precedent).
 *
 * Pure module: no IO, no React.
 */

import type { TenantId, SubjectId } from "../../../../platform-contracts/src/index.ts";

/** The Lab workbench's navigation tabs. */
export type LabTab = "searches" | "evidence" | "learning" | "guidance" | "gaps" | "arena";

/** Who is reading (the read model's tenant scope, R20). */
export interface LabViewer {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}

/**
 * A typed selection refusal (R20): the viewer tried to open an entity
 * that belongs to another tenant. Rendered as a visible state — never
 * silent, never a crash (E8 applied to the UI boundary; the code is the
 * house `cross-tenant` vocabulary, never re-invented).
 */
export interface LabSelectionRefusal {
  readonly code: "cross-tenant";
  readonly detail: string;
}

/** The Lab workbench UI state (selections only; data lives in view models). */
export interface LabSelection {
  readonly tab: LabTab;
  /** The selected organization search session id, or null. */
  readonly searchId: string | null;
  /** The selected capability-gap summary key (missingCapability), or null. */
  readonly gapCapability: string | null;
}

/** The default selection (Searches tab, nothing picked). */
export const INITIAL_LAB_SELECTION: LabSelection = {
  tab: "searches",
  searchId: null,
  gapCapability: null,
};
