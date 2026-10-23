/**
 * @playliquid/game-ui PUBLIC ENTRYPOINT (PL-033).
 *
 * Everything the host needs to mount the Game Studio foundation:
 * - ports (the one data seam), the store and the typed action set;
 * - the pure read-model projections (five surfaces + status vocabulary);
 * - the presentational component set (shell, panels, chips, primitives,
 *   style tokens) — zero data fetching;
 * - the app composition (StudioApp + the useSyncExternalStore binding);
 * - the labeled TEST-SUPPORT doubles and the demo fixture (lock rule 44:
 *   clearly marked, never presented as production integrations).
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// The data seam.
export type { StudioDataPort, StudioDataResult } from "./ports.ts";

// The one UI-state owner + its vocabulary.
export type { StudioStore, Unsubscribe } from "./studio-store.ts";
export { createStudioStore } from "./studio-store.ts";
export type { StudioAction, StudioState } from "./studio-actions.ts";
export {
  initialStudioState,
  projectState,
  reduce,
} from "./studio-actions.ts";

// Read-model projections (pure).
export type { GameStudioViewModel, StudioDataSnapshot, StudioSelection, StudioTab } from "./view/studio-view.ts";
export { INITIAL_SELECTION, projectStudio, studioSummary } from "./view/studio-view.ts";
export type {
  LockPinRow,
  PackageCardView,
  PackageDependencyRow,
  PackagesView,
} from "./view/package-view.ts";
export { packagesSummary, projectPackages } from "./view/package-view.ts";
export type { Digest } from "./view/package-view.ts";
export type {
  SessionCardView,
  SessionOperation,
  SessionTimelineRow,
  SessionView,
} from "./view/runtime-view.ts";
export { operationLabel, projectSession, sessionSummary } from "./view/runtime-view.ts";
export type {
  AvatarCardView,
  AvatarsView,
  CapabilityChip,
  IntentChip,
  PackageRefRow,
  SubRecordRow,
} from "./view/avatar-view.ts";
export { avatarsSummary, projectAvatar, projectAvatars, UNRESTRICTED } from "./view/avatar-view.ts";
export type { IntentKind } from "./view/avatar-view.ts";
export type {
  BrokerView,
  CoverageRow,
  EvaluationRow,
  GrantRow,
  RestrictionChip,
} from "./view/broker-view.ts";
export { brokerSummary, projectBroker } from "./view/broker-view.ts";
export type { CapabilityId } from "./view/broker-view.ts";
export type { JobEventLike, JobEventRow, JobRow, RegistrationRow, ToolsView } from "./view/tools-view.ts";
export { projectTools, surfaceText, toolIdText, toolsSummary } from "./view/tools-view.ts";
export type { UiStatus, UiTone } from "./view/status.ts";
export {
  adapterStatus,
  grantStatus,
  licenseStatus,
  outcomeStatus,
  phaseStatus,
  releaseGateStatus,
  toolJobStatus,
} from "./view/status.ts";

// Onboarding copy + contextual next-step hints (pure; UX-002).
export type { EmptySurfaceCopy, StudioEmptySurfaceId } from "./view/onboarding.ts";
export {
  STUDIO_EMPTY_STATE_COPY,
  refreshFailureNextStep,
  timelineNextHint,
} from "./view/onboarding.ts";

// Presentational components (zero data fetching).
export { StudioShell } from "./components/studio-shell.tsx";
export type { StudioShellProps } from "./components/studio-shell.tsx";
export { AvatarsPanel } from "./components/avatars-panel.tsx";
export { BrokerPanel } from "./components/broker-panel.tsx";
export { PackagesPanel } from "./components/packages-panel.tsx";
export { SessionPanel } from "./components/session-panel.tsx";
export { ToolsPanel } from "./components/tools-panel.tsx";
export type { ToolsPanelProps } from "./components/tools-panel.tsx";
export { CountPill, StatusChip } from "./components/status-chip.tsx";
export type { StatusChipProps } from "./components/status-chip.tsx";
export { Banner, ChipList, DataTable, EmptyState, KeyValue, Mono, Panel } from "./components/primitives.tsx";
export type { DataTableColumn, DataTableProps } from "./components/primitives.tsx";
export { EmptySurface } from "./components/empty-surface.tsx";
export type { EmptySurfaceProps } from "./components/empty-surface.tsx";
export { FONT, STYLE, SURFACE, TONE_STYLE } from "./components/tokens.ts";
export type { ToneStyle } from "./components/tokens.ts";

// The app composition.
export { StudioApp } from "./app/studio-app.tsx";
export type { StudioAppProps } from "./app/studio-app.tsx";
export { projectStateCached, useStudioStore } from "./app/use-studio-store.ts";
export type { UseStudioStore } from "./app/use-studio-store.ts";

// TEST-SUPPORT doubles (lock rule 44) + demo fixture.
export {
  LocalAdapter,
  ScriptedStudioDataPort,
  StaticStudioDataPort,
} from "./fakes.ts";
export type {
  LocalAdapterCommandOk,
  LocalAdapterDispatch,
  LocalAdapterState,
  LocalLifecycleCheck,
} from "./fakes.ts";
export { DEMO_RESTRICTION, DEMO_STUDIO_SESSION_ID, demoStudioSnapshot } from "./fixtures/demo.ts";
