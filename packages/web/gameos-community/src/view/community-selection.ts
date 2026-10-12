/**
 * COMMUNITY WORKBENCH SELECTION (pure): the UI's selection state — which
 * tab is active, which contribution is picked and which kind filter is
 * applied. Data lives in the snapshot and its projections only; selection
 * carries NO data (game-ui/gameos-lab precedent).
 *
 * Pure module: no IO, no React.
 */

import type { TenantId, SubjectId } from "../../../../platform-contracts/src/index.ts";

/** The Community workbench's navigation tabs. */
export type CommunityTab = "contributions" | "lifecycle" | "provenance";

/** Who is reading (the read model's tenant scope, R20). */
export interface CommunityViewer {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}

/**
 * A typed selection refusal (R20): the viewer tried to open an entity
 * that belongs to another tenant. Rendered as a visible state — never
 * silent, never a crash (E8 applied to the UI boundary; the code is the
 * house `cross-tenant` vocabulary, never re-invented).
 */
export interface CommunitySelectionRefusal {
  readonly code: "cross-tenant";
  readonly detail: string;
}

/** The Community workbench UI state (selections only; data lives in view models). */
export interface CommunitySelection {
  readonly tab: CommunityTab;
  /** The selected contribution id (full content address), or null. */
  readonly contributionId: string | null;
  /** The applied contribution-kind filter, or null (all kinds). */
  readonly kindFilter: string | null;
}

/** The default selection (Contributions tab, nothing picked, no filter). */
export const INITIAL_COMMUNITY_SELECTION: CommunitySelection = {
  tab: "contributions",
  contributionId: null,
  kindFilter: null,
};
