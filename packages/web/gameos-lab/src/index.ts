/**
 * @playliquid/gameos-lab PUBLIC ENTRYPOINT (PL-034).
 *
 * Everything the host needs to mount the Game Engineering Lab workbench:
 * - ports (the two seams: read-model data + typed command intents);
 * - the one UI-state owner, its typed action set and the append-only
 *   command log;
 * - the pure read-model projections (six surfaces + status vocabulary);
 * - the presentational component set (shell, panels, chips, primitives,
 *   style tokens) — zero data fetching;
 * - the app composition (LabApp + the useSyncExternalStore binding);
 * - the labeled TEST-SUPPORT doubles and the demo fixture (lock rule 44:
 *   clearly marked, never presented as production integrations).
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// The two seams.
export type {
  LabCommandIntent,
  LabCommandLogEntry,
  LabCommandPort,
  LabCommandReceipt,
  LabCommandReceiptOk,
  LabCommandReceiptRefused,
  LabDataPort,
  LabIntentRefusalCode,
  LabLoadResult,
} from "./ports.ts";

// The one UI-state owner + its vocabulary.
export type { LabStore, LabWorkbenchPorts, Unsubscribe } from "./lab-store.ts";
export { createLabStore } from "./lab-store.ts";
export type { LabAction, LabState } from "./lab-actions.ts";
export { initialLabState, projectState, reduce } from "./lab-actions.ts";

// Read-model projections (pure).
export type {
  LabDataSnapshot,
  LabTab,
  LabViewer,
  LabWorkbenchViewModel,
} from "./view/lab-view.ts";
export { INITIAL_LAB_SELECTION } from "./view/lab-selection.ts";
export type { LabSelection, LabSelectionRefusal } from "./view/lab-selection.ts";
export { labSummary, projectLab } from "./view/lab-view.ts";
export type {
  CandidateRowView,
  SearchRowView,
  SearchesView,
} from "./view/search-view.ts";
export { projectSearches, searchesSummary } from "./view/search-view.ts";
export type { EvidenceRowView, EvidenceView } from "./view/evidence-view.ts";
export { evidenceSummary, projectEvidence } from "./view/evidence-view.ts";
export type { LearningRowView, LearningView, SignalRowView } from "./view/learning-view.ts";
export { learningSummary, projectLearning } from "./view/learning-view.ts";
export type {
  EstimateGuidanceView,
  GuidanceAdjustmentRowView,
  GuidanceRefusalView,
  GuidanceSetView,
  ObservedGuidanceView,
} from "./view/guidance-view.ts";
export { guidanceSummary, projectGuidance, projectGuidanceSet } from "./view/guidance-view.ts";
export type { GapRowView, GapsView } from "./view/gaps-view.ts";
export { gapsSummary, projectGaps } from "./view/gaps-view.ts";
export type { ArenaCaseRowView, ArenaView } from "./view/arena-view.ts";
export { arenaSummary, projectArenaCases } from "./view/arena-view.ts";
export type { UiStatus, UiTone } from "./view/status.ts";
export {
  arenaLifecycleStatus,
  commandReceiptStatus,
  estimateMethodStatus,
  evidenceEpistemicStatus,
  gapRungStatus,
  gapSummaryStatus,
  observedEvidenceStatus,
  refusalStatus,
  searchProgressStatus,
} from "./view/status.ts";

// Onboarding copy + contextual next-step hints (pure; UX-002).
export type { EmptySurfaceCopy, LabEmptySurfaceId } from "./view/onboarding.ts";
export {
  LAB_EMPTY_STATE_COPY,
  commandLogNextHint,
  refreshFailureNextStep,
} from "./view/onboarding.ts";

// Presentational components (zero data fetching).
export { LabShell } from "./components/lab-shell.tsx";
export type { LabShellProps } from "./components/lab-shell.tsx";
export { SearchesPanel } from "./components/searches-panel.tsx";
export type { SearchesPanelProps } from "./components/searches-panel.tsx";
export { EvidencePanel } from "./components/evidence-panel.tsx";
export type { EvidencePanelProps } from "./components/evidence-panel.tsx";
export { LearningPanel } from "./components/learning-panel.tsx";
export type { LearningPanelProps } from "./components/learning-panel.tsx";
export { GuidancePanel } from "./components/guidance-panel.tsx";
export { GapsPanel } from "./components/gaps-panel.tsx";
export type { GapsPanelProps } from "./components/gaps-panel.tsx";
export { ArenaPanel } from "./components/arena-panel.tsx";
export type { ArenaPanelProps } from "./components/arena-panel.tsx";
export { EmptySurface } from "./components/empty-surface.tsx";
export type { EmptySurfaceProps } from "./components/empty-surface.tsx";
export { CountPill, StatusChip } from "./components/status-chip.tsx";
export type { StatusChipProps } from "./components/status-chip.tsx";
export { Banner, ChipList, DataTable, EmptyState, KeyValue, Mono, Panel } from "./components/primitives.tsx";
export type { DataTableColumn, DataTableProps } from "./components/primitives.tsx";
export { FONT, STYLE, SURFACE, TONE_STYLE } from "./components/tokens.ts";
export type { ToneStyle } from "./components/tokens.ts";

// The app composition.
export { LabApp } from "./app/lab-app.tsx";
export type { LabAppProps } from "./app/lab-app.tsx";
export { projectStateCached, useLabStore } from "./app/use-lab-store.ts";
export type { UseLabStore } from "./app/use-lab-store.ts";

// TEST-SUPPORT doubles (lock rule 44) + demo fixture.
export { ScriptedLabCommandPort, ScriptedLabDataPort, StaticLabDataPort } from "./fakes.ts";
export {
  DEMO_LAB_FOREIGN_SUBJECT,
  DEMO_LAB_FOREIGN_TENANT,
  DEMO_LAB_SUBJECT,
  DEMO_LAB_TENANT,
  demoLabSnapshot,
} from "./fixtures/demo.ts";
