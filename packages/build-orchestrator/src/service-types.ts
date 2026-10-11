/**
 * Door result shapes of the build orchestrator service (the service
 *itself lives in service.ts). Typed results only — refused commands are
 * typed refusals, never exceptions (house contract style).
 */

import type {
  BuildAdmissionErrorCode,
  BuildId,
  BuildPhase,
  BuildRequestCommand,
  CancelBuildCommand,
} from "@playliquid/build-contracts";
import type { BuildArtifact, BuildOutputs, VerificationEvidence } from "@playliquid/build-contracts";
import type { EnvironmentLimitation } from "./document.ts";
import type { BuildEvent } from "./events.ts";
import type { TenantId } from "./tenancy.ts";

/** Why a build request was refused at intake (E1). */
export type BuildIntakeRefusalCode =
  | "invalid-tenant"
  | BuildAdmissionErrorCode
  | "unknown-target"
  | "duplicate-payload";

/** A refused build intake. */
export interface BuildIntakeRefusal {
  readonly ok: false;
  readonly code: BuildIntakeRefusalCode;
  readonly message: string;
  /** The unresolvable input, when the code is `unresolvable-input`. */
  readonly input?: "gameIr" | "packageLock" | "targetProfile" | "engineBinding" | "toolchain";
}

/** An accepted build intake: first execution or idempotent duplicate (E6). */
export type BuildIntakeResult =
  | { readonly ok: true; readonly classification: "first"; readonly buildId: BuildId }
  | { readonly ok: true; readonly classification: "duplicate"; readonly buildId: BuildId }
  | BuildIntakeRefusal;

/** The result of one drive step (one phase arc of the frozen machine). */
export interface DriveStepResult {
  readonly ok: true;
  readonly buildId: BuildId;
  /** The build's phase after this step. */
  readonly phase: BuildPhase;
  /** True when the phase is terminal (succeeded | failed | cancelled). */
  readonly terminal: boolean;
  /**
   * The failure reason. Terminal when the step failed the build; on a
   * vendor-gated package arc it is the RETRYABLE wait for out-of-band
   * vendor evidence (`vendor-evidence-required`: the build is NOT failed,
   * stays drivable, and `manifestDigest` names what must be verified).
   */
  readonly failure?: { readonly code: string; readonly message: string };
  /** The manifest digest, once the package stage completed (console on-target material). */
  readonly manifestDigest?: string;
}

/** Why a drive step was refused (no state change). */
export type DriveRefusalCode =
  | "invalid-tenant"
  | "unknown-build"
  | "wrong-tenant"
  | "build-terminal"
  | "invalid-evidence";

/** A refused drive step. */
export interface DriveRefusal {
  readonly ok: false;
  readonly code: DriveRefusalCode;
  readonly message: string;
}

/** Optional per-drive inputs (vendor evidence is out-of-band, never fabricated). */
export interface DriveOptions {
  /** Vendor-SDK authorization records (console-class builds; lock rule 24). */
  readonly vendorEvidence?: readonly VerificationEvidence[];
}

/** The result of a cancel command. */
export type CancelResult =
  | { readonly ok: true; readonly buildId: BuildId; readonly phase: BuildPhase }
  | { readonly ok: false; readonly code: "invalid-tenant" | "invalid-command" | "unknown-build" | "wrong-tenant" | "build-not-cancellable"; readonly message: string };

/** The tenant-scoped read model of one build. */
export interface BuildStatusView {
  readonly ok: true;
  readonly buildId: BuildId;
  readonly tenant: TenantId;
  readonly phase: BuildPhase;
  readonly admittedAt: number;
  readonly target: string;
  readonly requester: string;
  /** Terminal failure reason, when phase is `failed`. */
  readonly failure?: { readonly code: string; readonly message: string };
  /** Manifest digest, once the package stage completed. */
  readonly manifestDigest?: string;
  /** The recorded outputs, once the build succeeded (immutable, E10). */
  readonly outputs?: BuildOutputs;
  readonly artifactCount: number;
  readonly stepCount: number;
}

/** A refused status read. */
export interface StatusRefusal {
  readonly ok: false;
  readonly code: "invalid-tenant" | "unknown-build" | "wrong-tenant";
  readonly message: string;
}

/** The options of the build orchestrator service constructor. */
export interface BuildOrchestratorServiceOptions {
  /** The registry/CAS read seam (PL-011 wiring; see registry-adapter.ts). */
  readonly sources: import("./ports.ts").BuildSourcePort;
  /** The Tool Fabric runtime seam (PL-019 wiring; see tool-fabric-adapter.ts). */
  readonly fabric: import("./ports.ts").ToolFabricPort;
  /** The only time source (E3). */
  readonly clock: import("./ports.ts").ServiceClock;
  /** The durable append-only event store (E6; in-memory fake is a test double). */
  readonly store: import("./ports.ts").BuildStore;
}

/** Convenience re-export used by the service doors. */
export type { BuildArtifact, BuildEvent, BuildRequestCommand, CancelBuildCommand, EnvironmentLimitation };

/** The result of restoring a service from a stored snapshot (E6). */
export type BuildServiceRestoreResult =
  | { readonly ok: true; readonly service: import("./service.ts").BuildOrchestratorService }
  | {
      readonly ok: false;
      readonly code: "snapshot-malformed" | "snapshot-digest-mismatch" | "event-log-corrupt" | "store-divergence";
      readonly message: string;
    };

/** A refused event-log read. */
export interface EventLogRefusal {
  readonly ok: false;
  readonly code: "invalid-tenant" | "unknown-build" | "wrong-tenant";
  readonly message: string;
}

/** The tenant-scoped, append-only event log of one build (E10 audit view). */
export type EventLogView = { readonly ok: true; readonly events: readonly BuildEvent[] } | EventLogRefusal;
