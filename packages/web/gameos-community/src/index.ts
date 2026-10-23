/**
 * @playliquid/gameos-community PUBLIC ENTRYPOINT (PL-034).
 *
 * Everything the host needs to mount the Community contribution
 * workbench:
 * - ports (the two seams: read-model data + typed command intents);
 * - the one UI-state owner, its typed action set and the append-only
 *   command log;
 * - the pure read-model projections (three surfaces + status
 *   vocabulary);
 * - the presentational component set (shell, panels, chips, primitives,
 *   style tokens) — zero data fetching;
 * - the app composition (CommunityApp + the useSyncExternalStore
 *   binding);
 * - the labeled TEST-SUPPORT doubles and the demo fixture (lock rule 44:
 *   clearly marked, never presented as production integrations).
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// The two seams.
export type {
  CommunityCommandIntent,
  CommunityCommandLogEntry,
  CommunityCommandPort,
  CommunityCommandReceipt,
  CommunityCommandReceiptOk,
  CommunityCommandReceiptRefused,
  CommunityDataPort,
  CommunityIntentRefusalCode,
  CommunityLoadResult,
} from "./ports.ts";

// The one UI-state owner + its vocabulary.
export type { CommunityStore, CommunityWorkbenchPorts, Unsubscribe } from "./community-store.ts";
export { createCommunityStore } from "./community-store.ts";
export type { CommunityAction, CommunityState } from "./community-actions.ts";
export { initialCommunityState, projectState, reduce } from "./community-actions.ts";

// Read-model projections (pure).
export type {
  CommunityDataSnapshot,
  CommunityTab,
  CommunityViewer,
  CommunityWorkbenchViewModel,
} from "./view/community-view.ts";
export { INITIAL_COMMUNITY_SELECTION } from "./view/community-selection.ts";
export type {
  CommunitySelection,
  CommunitySelectionRefusal,
} from "./view/community-selection.ts";
export { communitySummary, projectCommunity } from "./view/community-view.ts";
export type {
  ContributionRowView,
  ContributionsView,
} from "./view/contributions-view.ts";
export { contributionsSummary, projectContributions } from "./view/contributions-view.ts";
export type {
  TransitionRowView,
  WorkflowView,
} from "./view/workflow-view.ts";
export { projectWorkflow, workflowSummary } from "./view/workflow-view.ts";
export type {
  ContributionTrustView,
  ModelEntryRowView,
  ProvenanceDetailView,
  ProvenanceView,
} from "./view/provenance-view.ts";
export { projectProvenance, provenanceSummary } from "./view/provenance-view.ts";
export type { UiStatus, UiTone } from "./view/status.ts";
export {
  aiDisclosureStatus,
  commandReceiptStatus,
  contributionKindStatus,
  contributionStatusStatus,
  gapLinkStatus,
  originStatus,
  refusalStatus,
  transitionStatus,
  trustStatus,
} from "./view/status.ts";

// Onboarding copy + contextual next-step hints (pure; UX-002).
export type { CommunityEmptySurfaceId, EmptySurfaceCopy } from "./view/onboarding.ts";
export {
  COMMUNITY_EMPTY_STATE_COPY,
  commandLogNextHint,
  refreshFailureNextStep,
} from "./view/onboarding.ts";

// Presentational components (zero data fetching).
export { CommunityShell } from "./components/community-shell.tsx";
export type { CommunityShellProps } from "./components/community-shell.tsx";
export { ContributionsPanel } from "./components/contributions-panel.tsx";
export type { ContributionsPanelProps } from "./components/contributions-panel.tsx";
export { WorkflowPanel } from "./components/workflow-panel.tsx";
export type { WorkflowPanelProps } from "./components/workflow-panel.tsx";
export { ProvenancePanel } from "./components/provenance-panel.tsx";
export type { ProvenancePanelProps } from "./components/provenance-panel.tsx";
export { EmptySurface } from "./components/empty-surface.tsx";
export type { EmptySurfaceProps } from "./components/empty-surface.tsx";
export { CountPill, StatusChip } from "./components/status-chip.tsx";
export type { StatusChipProps } from "./components/status-chip.tsx";
export { Banner, DataTable, EmptyState, KeyValue, Mono, Panel } from "./components/primitives.tsx";
export type { DataTableColumn, DataTableProps } from "./components/primitives.tsx";
export { FONT, STYLE, SURFACE, TONE_STYLE } from "./components/tokens.ts";
export type { ToneStyle } from "./components/tokens.ts";

// The app composition.
export { CommunityApp } from "./app/community-app.tsx";
export type { CommunityAppProps } from "./app/community-app.tsx";
export { projectStateCached, useCommunityStore } from "./app/use-community-store.ts";
export type { UseCommunityStore } from "./app/use-community-store.ts";

// TEST-SUPPORT doubles (lock rule 44) + demo fixture.
export {
  ScriptedCommunityCommandPort,
  ScriptedCommunityDataPort,
  StaticCommunityDataPort,
} from "./fakes.ts";
export {
  DEMO_COMMUNITY_CONTRIBUTOR,
  DEMO_COMMUNITY_CYCLE,
  DEMO_COMMUNITY_FOREIGN_CONTRIBUTOR,
  DEMO_COMMUNITY_FOREIGN_TENANT,
  DEMO_COMMUNITY_GAP,
  DEMO_COMMUNITY_TENANT,
  DEMO_COMMUNITY_VIEWER,
  demoCommunitySnapshot,
} from "./fixtures/demo.ts";
