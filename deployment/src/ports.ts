/**
 * INJECTED DOORS + RESULT TYPES of the deployment verifier (PL-044).
 *
 * The verifier owns NO mutable state and touches NO ambient authority:
 * every dependency arrives through these seams (the services/ops
 * worker-ports discipline):
 *
 * - {@link DeploymentRegistryDoor} — the PL-011 package-registry read seam
 *   (`getByDigest`); satisfied by the pure `RegistryIndex` or the
 *   port-wired `PackageRegistry` facade;
 * - {@link DeploymentCasDoor} — the PL-011 artifact-store CAS (the
 *   `ArtifactStore` interface itself; registry↔CAS record resolution goes
 *   through package-registry's own public `fetchRecordFromCas` binding);
 * - {@link DeploymentProfileDoor} — the PL-036 target-profile source port
 *   (`TargetProfilePort`, target-builds' own seam);
 * - {@link DeploymentClockPort} — caller-programmed time (never Date.now).
 *
 * Refusal codes are FROZEN and typed (E8): the delegated vocabularies
 * (package-system's `ReleaseGateFailureCode`, target-builds'
 * `ProfileRefusalCode`) surface verbatim, never re-implemented.
 *
 * Purity: types + frozen vocabularies only.
 */

import type { PackageRecord, ReleaseGateFailureCode } from "../../packages/package-system/src/index.ts";
import type { ArtifactStore } from "../../packages/artifact-store/src/index.ts";
import type { TargetProfilePort } from "../../packages/target-builds/src/index.ts";
import type { ProfileRefusalCode } from "../../packages/target-builds/src/index.ts";
import type { TargetId } from "../../packages/target-profiles/src/index.ts";

/** Service-level time authority (the house ClockPort shape). */
export interface DeploymentClockPort {
  now(): number;
}

/** The PL-011 registry read seam (index and facade both satisfy it). */
export interface DeploymentRegistryDoor {
  getByDigest(digest: string): PackageRecord | null;
}

/** The PL-011 CAS door (the artifact store itself). */
export type DeploymentCasDoor = ArtifactStore;

/** The PL-036 target-profile source door. */
export type DeploymentProfileDoor = TargetProfilePort;

/** The bundle of host-injected doors the verifier needs. */
export interface DeploymentDoors {
  readonly registry: DeploymentRegistryDoor;
  readonly cas: DeploymentCasDoor;
  readonly profiles: DeploymentProfileDoor;
}

/** The deployment verifier's own frozen id (pinned into every seal, E9). */
export const DEPLOYMENT_VERIFIER_ID = "playliquid/deployment-verifier/1";

/**
 * The deployment verifier's refusal vocabulary (frozen, E8). Delegated
 * vocabularies compose verbatim: R19 release-gate codes
 * (package-system) and PL-036 profile codes (target-builds).
 */
export type DeploymentRefusalCode =
  | "invalid-plan"
  | "invalid-manifest"
  | "invalid-artifact"
  | "unknown-artifact"
  | "tampered-artifact"
  | "artifact-unavailable"
  | "artifact-mismatch"
  | "unknown-target"
  | "unknown-health-door"
  | "duplicate-health-door"
  | "invalid-rights-scope"
  | "cross-tenant-scope"
  | "rights-not-granted"
  | "not-authorized"
  | "cross-tenant-request"
  | "honesty-violation"
  | "seal-mismatch"
  | ReleaseGateFailureCode
  | ProfileRefusalCode;

/** The content-addressed seal of one VERIFIED plan (E9 deterministic). */
export interface DeploymentSeal {
  /** The digest of the plan the seal covers. */
  readonly planDigest: string;
  /** Domain-separated seal digest over {verifier, planDigest, units, verifiedAt}. */
  readonly sealDigest: string;
  /** The injected-clock instant the verification ran at. */
  readonly verifiedAt: number;
  /** The number of verified units. */
  readonly units: number;
  /** The verifier's own pinned id. */
  readonly verifier: string;
}

/**
 * The verifier's result. Refusals name the offending unit when there is
 * one, mutate NOTHING, and are total (the verifier never throws).
 */
export type DeploymentVerification =
  | { readonly ok: true; readonly seal: DeploymentSeal }
  | {
      readonly ok: false;
      readonly code: DeploymentRefusalCode;
      readonly detail: string;
      /** The offending unit's id, when the refusal is unit-scoped. */
      readonly unitId?: string;
    };

/** Construction options of the verifier. */
export interface DeploymentVerifierOptions {
  readonly doors: DeploymentDoors;
  readonly clock: DeploymentClockPort;
}

/** The target the doors' profile source serves — re-anchored for docs. */
export type DeploymentTargetId = TargetId;
