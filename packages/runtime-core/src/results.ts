/**
 * Typed result shapes for every Experience Protocol operation the kernel
 * exposes. Mirrors the discriminated-union style of
 * @playliquid/runtime-contracts: successes and rejections are typed data,
 * never thrown control flow (except invariant violations, which indicate
 * kernel bugs, not caller mistakes).
 *
 * Every result carries the session EPOCH it was produced under
 * (EpochedResult compliance) so consumers can apply the stale-result rule
 * (`applyStaleResultRule`) once the authoritative runtime advances the
 * epoch via reset/restore.
 */

import type {
  ActionDenialReason,
  CommandId,
  CommandRejectionCode,
  EventStreamValidation,
  ExperienceObservation,
  ReplayPlanErrorCode,
  RuntimeEventEnvelope,
  SessionEpoch,
  SessionSnapshot,
} from "@playliquid/runtime-contracts";

/** Union of every typed rejection code the kernel can emit. */
export type KernelErrorCode =
  | "wrong-role"
  | "wrong-phase"
  | "session-terminal"
  | "invalid-load"
  | "invalid-ticks"
  | "invalid-cursor"
  | "capability-denied"
  | "command-rejected"
  | "idempotency-collision"
  | "unknown-snapshot"
  | "snapshot-wrong-session"
  | "snapshot-world-kind-mismatch"
  | "replay-plan-rejected"
  | "driver-failure";

/** Common rejection shape for every operation. */
export interface KernelRejection {
  readonly status: "rejected";
  readonly epoch: SessionEpoch;
  readonly code: KernelErrorCode;
  readonly detail: string;
  /** Present when code is "capability-denied" (broker boundary reason). */
  readonly denial?: ActionDenialReason;
  /** Present when code is "command-rejected" (admission gate reason). */
  readonly commandCode?: CommandRejectionCode;
  /** Present when code is "replay-plan-rejected" (plan oracle reason). */
  readonly planCode?: ReplayPlanErrorCode;
}

/** Driver/codec failure: the session transitioned to `failed`. */
export interface KernelFailure {
  readonly status: "failed";
  readonly epoch: SessionEpoch;
  readonly code: "driver-failure";
  readonly detail: string;
}

/** `load`: provisioning -> loading -> ready, or a typed failure. */
export type LoadResult =
  | {
      readonly status: "loaded";
      readonly epoch: SessionEpoch;
      readonly events: readonly RuntimeEventEnvelope[];
    }
  | KernelRejection
  | KernelFailure;

/** `observe`: read model + events after the cursor. */
export type ObserveResult =
  | { readonly status: "observed"; readonly observation: ExperienceObservation }
  | KernelRejection;

/**
 * `act` outcomes. `duplicate` is a VALID receipt (E8 anti-gaming: replaying
 * a request returns the first outcome, never a second application).
 * `collision` — same idempotency key, different payload — is refused.
 */
export type ActResult =
  | {
      readonly status: "committed";
      readonly epoch: SessionEpoch;
      readonly commandId: CommandId;
      readonly commandSeq: number;
      readonly events: readonly RuntimeEventEnvelope[];
    }
  | {
      readonly status: "duplicate";
      readonly epoch: SessionEpoch;
      readonly commandId: CommandId;
      readonly firstCommandId: CommandId;
    }
  | KernelRejection
  | KernelFailure;

/** `step`: fixed-tick advance; phase moves ready -> running on success. */
export type StepResult =
  | {
      readonly status: "stepped";
      readonly epoch: SessionEpoch;
      readonly fromTick: number;
      readonly toTick: number;
      readonly events: readonly RuntimeEventEnvelope[];
    }
  | KernelRejection
  | KernelFailure;

/** `reset`: epoch advances, world re-instantiates, phase -> ready. */
export type ResetResult =
  | {
      readonly status: "reset";
      readonly epoch: SessionEpoch;
      readonly events: readonly RuntimeEventEnvelope[];
    }
  | KernelRejection
  | KernelFailure;

/** `snapshot`: canonical bytes -> content-addressed boundary. */
export type SnapshotResult =
  | {
      readonly status: "snapshotted";
      readonly epoch: SessionEpoch;
      readonly snapshot: SessionSnapshot;
    }
  | KernelRejection
  | KernelFailure;

/** `restore`: world/tick re-instantiated from a snapshot; epoch advances. */
export type RestoreResult =
  | {
      readonly status: "restored";
      readonly epoch: SessionEpoch;
      readonly restoredTick: number;
      readonly events: readonly RuntimeEventEnvelope[];
    }
  | KernelRejection
  | KernelFailure;

/**
 * `replay` (SEAM ONLY — lock rule 15): validated read access to the
 * immutable event log. Deterministic re-simulation is the Simulation
 * Runtime (PL-014); the Interactive Runtime replays recorded observations.
 */
export type ReplayResult =
  | {
      readonly status: "replayed";
      readonly epoch: SessionEpoch;
      readonly fromSeq: number;
      readonly toSeq: number;
      readonly events: readonly RuntimeEventEnvelope[];
    }
  | KernelRejection;

/** `terminate`: graceful stop; terminal afterwards. */
export type TerminateResult =
  | {
      readonly status: "terminated";
      readonly epoch: SessionEpoch;
      readonly events: readonly RuntimeEventEnvelope[];
    }
  | KernelRejection;

/** Whole-log integrity report (segmented per epoch; see logview.ts). */
export type IntegrityResult = EventStreamValidation;
