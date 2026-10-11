/**
 * COMPOSITE STUDIO VIEW (pure): the whole Game Studio read model — the
 * four surfaces (Packages, Session, Avatars, Capabilities, Tools) plus the
 * UI selection state — assembled from one authoritative data snapshot.
 * The studio components render THIS model and nothing else (E5).
 *
 * Pure module: no IO, no React.
 */

import type { HostRestriction } from "@playliquid/game-contracts";
import type {
  ActionResolution,
  ExperienceObservation,
  IntentKind,
  RuntimeSessionSnapshotView,
} from "@playliquid/runtime-contracts";
import type {
  AvatarDefinition,
} from "@playliquid/avatar-runtime";
import type {
  BrokerPolicy,
  CapabilityBroker,
} from "@playliquid/capability-broker";
import type {
  PackageRecord,
  PackageLock,
  ReleaseGateResult,
} from "@playliquid/package-system";
import type {
  ToolRegistration,
  ToolJobSnapshot,
} from "@playliquid/tool-fabric-runtime";
import type { SessionOperation } from "./runtime-view.ts";
import type { JobEventLike } from "./tools-view.ts";
import { projectAvatars, type AvatarsView } from "./avatar-view.ts";
import { projectBroker, type BrokerView } from "./broker-view.ts";
import { projectPackages, type PackagesView } from "./package-view.ts";
import { projectSession, type SessionView } from "./runtime-view.ts";
import { projectTools, type ToolsView } from "./tools-view.ts";

/** The studio's navigation tabs. */
export type StudioTab = "packages" | "session" | "avatars" | "capabilities" | "tools";

/** The studio UI state (selections only; data lives in the view models). */
export interface StudioSelection {
  readonly tab: StudioTab;
  readonly packageId: string | null;
  readonly avatarId: string | null;
  readonly jobId: string | null;
}

/** The authoritative data snapshot a host hands the studio (read models). */
export interface StudioDataSnapshot {
  /** Package records + release gate verdicts + owning lockfile (PL-011). */
  readonly packages: readonly PackageRecord[];
  readonly gateResults: Readonly<Record<string, ReleaseGateResult>>;
  readonly lock?: PackageLock;
  /** Runtime session read model + tracked operation results (PL-013). */
  readonly session?: RuntimeSessionSnapshotView;
  readonly operations: readonly SessionOperation[];
  readonly observation?: ExperienceObservation;
  /** Composed avatar definitions + host restriction (PL-026). */
  readonly avatars: readonly AvatarDefinition[];
  readonly restriction?: HostRestriction;
  /** Broker policy + live broker + tracked evaluations (PL-026). */
  readonly policy: BrokerPolicy;
  readonly broker?: CapabilityBroker;
  readonly evaluations?: readonly {
    readonly intentKind: IntentKind;
    readonly resolution: ActionResolution;
  }[];
  /** Tool fabric registrations + jobs + events (PL-019). */
  readonly registrations: readonly ToolRegistration[];
  readonly jobs: readonly ToolJobSnapshot[];
  readonly events?: readonly JobEventLike[];
}

/** The whole Game Studio view model. */
export interface GameStudioViewModel {
  readonly selection: StudioSelection;
  readonly packages: PackagesView;
  readonly session: SessionView;
  readonly avatars: AvatarsView;
  readonly broker: BrokerView;
  readonly tools: ToolsView;
}

/** The default selection (Packages tab, nothing picked). */
export const INITIAL_SELECTION: StudioSelection = {
  tab: "packages",
  packageId: null,
  avatarId: null,
  jobId: null,
};

/**
 * Project one authoritative data snapshot + UI selection into the whole
 * studio view model. Deterministic: same inputs → same view.
 */
export function projectStudio(
  data: StudioDataSnapshot,
  selection: StudioSelection = INITIAL_SELECTION,
): GameStudioViewModel {
  return {
    selection,
    packages: projectPackages(data.packages, data.gateResults, data.lock),
    session: projectSession(data.session, data.operations, data.observation),
    avatars: projectAvatars(data.avatars, data.restriction),
    broker: projectBroker(data.policy, data.broker, data.evaluations),
    tools: projectTools(data.registrations, data.jobs, data.events),
  };
}

/** Deterministic header line for the whole studio. */
export function studioSummary(view: GameStudioViewModel): string {
  const gateBlocked = view.packages.blockedCount;
  const phase = view.session.card?.phase.label ?? "no session";
  const activeJobs = view.tools.activeCount;
  return `Game Studio · ${phase} · ${gateBlocked} gate-blocked · ${activeJobs} active tool job${activeJobs === 1 ? "" : "s"}`;
}
