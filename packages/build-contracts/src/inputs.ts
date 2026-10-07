/**
 * Build inputs — the typed record layer for spec/architecture.md "Build":
 *
 *   Inputs: GameIR digest + package lock + target profile + engine binding
 *   + toolchain/environment profile.
 *
 * Vocabulary reuse (one authority per concern):
 * - GameIR digest, package-lock fingerprint and every other digest use the
 *   `@playliquid/package-system` content-digest vocabulary — package-system
 *   is the digest/CAS authority (E7). This package never re-implements
 *   hashing: {@link computeBuildInputsDigest} delegates to package-system's
 *   `computeDigest`.
 * - The engine binding rides the PL-005 seam (`adapter-seam.ts`), opaque
 *   and digest-pinned.
 * - The toolchain/environment profile is a TYPED descriptor whose CONTENT
 *   is opaque to contracts (pinned by digest).
 *
 * Pure module: structural validators and one digest computation only.
 */

import { computeDigest, isContentDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { BuildTargetId, ProfileInputId, ToolchainProfileId, VendorId } from "./primitives.ts";
import { isNonEmptyIdText } from "./primitives.ts";
import type { EngineBindingRef, ToolOperationId } from "./adapter-seam.ts";
import { isEngineBindingRef, isValidToolOperationId } from "./adapter-seam.ts";

/**
 * Vendor/toolchain gate a target profile declares (data-driven R12). The
 * console taxonomy lives in `@playliquid/target-profiles`; build contracts
 * enforce the gate the PROFILE declares, so console builds cannot bypass
 * vendor evidence by naming.
 */
export type VendorGateRequirement =
  | { readonly kind: "none" }
  | { readonly kind: "authorized-vendor-sdk"; readonly vendorId: VendorId };

/** Type guard: a well-formed vendor gate requirement. */
export function isVendorGateRequirement(value: unknown): value is VendorGateRequirement {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<VendorGateRequirement> & { kind?: unknown };
  if (candidate.kind === "none") {
    return true;
  }
  if (candidate.kind !== "authorized-vendor-sdk") {
    return false;
  }
  return isNonEmptyIdText((candidate as { vendorId?: unknown }).vendorId);
}

/** The pinned GameIR composition digest (kernel digest discipline; format per package-system). */
export interface GameIrInputRef {
  readonly digest: ContentDigest;
}

/** A digest-pinned reference to the game's package lock (package-system lockfile vocabulary). */
export interface PackageLockInputRef {
  /** `computeLockFingerprint` output from `@playliquid/package-system`. */
  readonly lockFingerprint: ContentDigest;
  /** Number of packages pinned by the lock. */
  readonly pinnedPackageCount: number;
}

/** A content-addressed reference to a target profile record. */
export interface TargetProfileInputRef {
  readonly profileId: ProfileInputId;
  /** Content digest of the sealed target-profile record. */
  readonly profileDigest: ContentDigest;
  /** The target this profile builds for (taxonomy owned by target-profiles). */
  readonly target: BuildTargetId;
  /** Vendor gate declared by the profile (drives console evidence rules). */
  readonly vendorGate: VendorGateRequirement;
}

/** A typed toolchain/environment profile descriptor; the profile CONTENT is opaque. */
export interface ToolchainProfileRef {
  readonly profileId: ToolchainProfileId;
  /** Content digest pinning the opaque toolchain/environment profile content. */
  readonly profileDigest: ContentDigest;
  /** Tool Fabric operations this profile cites (seam vocabulary, opaque ids). */
  readonly citesToolOperations: readonly ToolOperationId[];
}

/** The five build inputs, exactly as the architecture lists them. */
export interface BuildInputs {
  readonly gameIr: GameIrInputRef;
  readonly packageLock: PackageLockInputRef;
  readonly targetProfile: TargetProfileInputRef;
  readonly engineBinding: EngineBindingRef;
  readonly toolchain: ToolchainProfileRef;
}

/** Frozen input names — the canonical order used in violations and digests. */
export const BUILD_INPUT_NAMES: readonly [
  "gameIr",
  "packageLock",
  "targetProfile",
  "engineBinding",
  "toolchain",
] = Object.freeze(["gameIr", "packageLock", "targetProfile", "engineBinding", "toolchain"]);

/** A build input name. */
export type BuildInputName = (typeof BUILD_INPUT_NAMES)[number];

/** Stable violation codes for {@link validateBuildInputs}. */
export type BuildInputViolationCode =
  | "invalid-game-ir-digest"
  | "invalid-package-lock"
  | "invalid-target-profile"
  | "invalid-engine-binding"
  | "invalid-toolchain";

/** One structural violation of the build inputs. */
export interface BuildInputViolation {
  readonly code: BuildInputViolationCode;
  readonly message: string;
  readonly input: BuildInputName;
}

/** Result of {@link validateBuildInputs}. Fails closed; aggregates reasons. */
export type BuildInputsValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly BuildInputViolation[] };

/** Pure structural validation of the five build inputs. */
export function validateBuildInputs(inputs: BuildInputs): BuildInputsValidation {
  const reasons: BuildInputViolation[] = [];
  if (!isContentDigest(inputs.gameIr?.digest)) {
    reasons.push({
      code: "invalid-game-ir-digest",
      input: "gameIr",
      message: "GameIR input digest is not a well-formed content digest",
    });
  }
  const lock = inputs.packageLock;
  if (
    !isContentDigest(lock?.lockFingerprint) ||
    typeof lock?.pinnedPackageCount !== "number" ||
    !Number.isSafeInteger(lock?.pinnedPackageCount) ||
    (lock?.pinnedPackageCount ?? -1) < 0
  ) {
    reasons.push({
      code: "invalid-package-lock",
      input: "packageLock",
      message: "package lock reference is structurally invalid",
    });
  }
  const profile = inputs.targetProfile;
  if (
    !isNonEmptyIdText(profile?.profileId) ||
    !isContentDigest(profile?.profileDigest) ||
    !isNonEmptyIdText(profile?.target) ||
    !isVendorGateRequirement(profile?.vendorGate)
  ) {
    reasons.push({
      code: "invalid-target-profile",
      input: "targetProfile",
      message: "target profile reference is structurally invalid",
    });
  }
  if (!isEngineBindingRef(inputs.engineBinding)) {
    reasons.push({
      code: "invalid-engine-binding",
      input: "engineBinding",
      message: "engine binding reference is structurally invalid",
    });
  }
  const toolchain = inputs.toolchain;
  if (
    !isNonEmptyIdText(toolchain?.profileId) ||
    !isContentDigest(toolchain?.profileDigest) ||
    !Array.isArray(toolchain?.citesToolOperations) ||
    !toolchain?.citesToolOperations.every((operation) => isValidToolOperationId(operation))
  ) {
    reasons.push({
      code: "invalid-toolchain",
      input: "toolchain",
      message: "toolchain/environment profile reference is structurally invalid",
    });
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * The content digest of the five build inputs (E9). Deterministic:
 * declaration order inside lists never matters (lists are sorted), key
 * order never matters (package-system canonicalizes), and equal input
 * values always produce the equal digests. Delegates to package-system's
 * `computeDigest` — build contracts never re-implement hashing (E7).
 */
export function computeBuildInputsDigest(inputs: BuildInputs): ContentDigest {
  return computeDigest({
    gameIr: inputs.gameIr.digest,
    packageLock: {
      lockFingerprint: inputs.packageLock.lockFingerprint,
      pinnedPackageCount: inputs.packageLock.pinnedPackageCount,
    },
    targetProfile: {
      profileId: inputs.targetProfile.profileId,
      profileDigest: inputs.targetProfile.profileDigest,
      target: inputs.targetProfile.target,
      vendorGate: inputs.targetProfile.vendorGate.kind,
    },
    engineBinding: {
      engineId: inputs.engineBinding.engineId,
      bindingDigest: inputs.engineBinding.bindingDigest,
      supportedTargets: [...inputs.engineBinding.supportedTargets].sort(),
    },
    toolchain: {
      profileId: inputs.toolchain.profileId,
      profileDigest: inputs.toolchain.profileDigest,
      citesToolOperations: [...inputs.toolchain.citesToolOperations].sort(),
    },
  });
}
