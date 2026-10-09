/**
 * PUBLIC SESSION TYPES (PL-014) — the Simulation Runtime's port-shaped
 * operation results and the game binding description.
 *
 * Pure types only. These are the structural contract surfaces consumed by
 * drivers, QA tooling and the replay re-execution engine (packages/replay):
 * every session method returns a TYPED result union — success carries the
 * authoritative read model fields; rejection carries a stable machine code
 * plus a human detail — so downstream consumers never need exceptions (E2:
 * one canonical path, typed at every boundary).
 */

import type {
  CapabilityGrant,
  CommandAdmissionPolicy,
  GameIrDigest,
  GameRefSummary,
  IntentKind,
  RuntimeEventEnvelope,
  SessionId,
  TypedIntent,
} from "@playliquid/runtime-contracts";
import type { GameIRValue } from "@playliquid/game-ir";
import type { WorldBlueprint } from "./world.ts";
import type { WorldSystem } from "./kernel.ts";

/** The game binding a simulation session executes. */
export interface SimulationGameBinding {
  /** The pinned game composition reference (validated against `load` ops). */
  readonly game: GameRefSummary;
  /** Static world definition (initial entity states + partitioning). */
  readonly blueprint: WorldBlueprint;
  /** Game mechanics, in declared execution order (unique systemIds). */
  readonly systems: readonly WorldSystem[];
  /** Which session phases admit which command kinds (E2 admission policy). */
  readonly commandPolicy: CommandAdmissionPolicy;
  /** capabilityId -> intent kinds the capability authorizes. */
  readonly capabilityIntentKinds: Readonly<Record<string, readonly IntentKind[]>>;
  /**
   * Initial capability grants (broker-owned read models). Grants are
   * epoch-scoped; after a reset/restore the host re-issues them via
   * `SimulationSession.setGrants`.
   */
  readonly grants: readonly CapabilityGrant[];
}

/**
 * The simulation-role `act` input: an `act` operation whose intent payload
 * is a GameIRValue (the game data language — payloads the kernel, the codec
 * and the canonical event forms all understand).
 */
export interface SimulationActInput {
  readonly op: "act";
  readonly sessionId: SessionId;
  readonly intent: TypedIntent<GameIRValue>;
}

export type LoadResult =
  | { readonly status: "loaded"; readonly sessionId: SessionId; readonly epoch: number; readonly tick: number }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

export type ResetResult =
  | { readonly status: "reset"; readonly epoch: number }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

export type StepResult =
  | { readonly status: "stepped"; readonly fromTick: number; readonly toTick: number; readonly emittedEvents: number }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

export type TerminateResult =
  | { readonly status: "terminated"; readonly finalEventSeq: number }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

export type ReplayWindowResult =
  | {
      readonly status: "replayed";
      readonly events: readonly RuntimeEventEnvelope<GameIRValue>[];
      readonly fromSeq: number;
      readonly toSeq: number | null;
    }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

export type SubmitResult =
  | { readonly status: "submitted"; readonly commandId: string; readonly dueTick: number }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

export type RestoreResult =
  | { readonly status: "restored"; readonly snapshotId: string; readonly epoch: number; readonly tick: number }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

/** Port-shaped result used by the replay re-execution target (packages/replay). */
export type BeginResult =
  | {
      readonly status: "begun";
      readonly epoch: number;
      readonly tick: number;
      readonly afterEventSeq: number;
      readonly gameDigest: GameIrDigest;
    }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

export type AdvanceResult =
  | { readonly status: "advanced"; readonly toTick: number }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };
