/**
 * Module role: the TYPED Unreal engine binding — the composition point
 * between the neutral Adapter seam and the build pipeline's
 * engine-binding vocabulary (target-profiles frozen taxonomy +
 * build-contracts request inputs). The binding declares the
 * DESKTOP-CLASS target profiles this adapter can serve (`windows`,
 * `macos`, `linux` — the desktop-class subset of the frozen target
 * taxonomy, matching the cook/package capability's build-platform
 * vocabulary); compatibility with a target profile record is a TYPED
 * predicate result ({ compatible: true } or a typed refusal), never a
 * thrown exception, mirroring target-profiles'
 * checkEngineBindingCompatibility discipline. The binding carries a
 * content digest over its canonical form so build inputs can pin it
 * (build-contracts EngineBindingRef wire format: `sha256:<64 hex>` —
 * no format conversion).
 *
 * A pure predicate composes the typed binding with the build-contracts
 * engine-binding vocabulary (asBuildTargetId/asEngineId), so an Unreal
 * binding can be cited in BuildInputs without any engine-specific types
 * leaking into build contracts (E3/E4: the Unreal-specific definition
 * lives ONLY here).
 *
 * Implements: PL-022 typed engine binding + desktop-class target
 * compatibility predicate (typed refusals, never exceptions).
 */

import { asBuildTargetId, asEngineId as asBuildEngineId, isEngineBindingRef, type EngineBindingRef } from "@playliquid/build-contracts";
import {
  asEngineBindingDigest,
  asEngineId,
  checkEngineBindingCompatibility,
  type EngineBindingDigest,
  type EngineId,
  type TargetProfileRecord,
} from "@playliquid/target-profiles";
import { contentDigestOf } from "./digest.ts";

/** Engine family id this binding declares (engine-specific ONLY here; E4). */
export const UNREAL_ENGINE_ID = "unreal" as const;

/**
 * The desktop-class target set this adapter can serve. Frozen subset of
 * the target-profiles taxonomy: `windows` (the canonical Unreal dev and
 * package platform), `macos` (supported editor platform and runtime
 * target) and `linux` (supported cook/package runtime target). Mobile,
 * XR, steamdeck, dedicated-server and console profiles are deliberately
 * NOT declared: mobile/XR packaging requires host-side vendor SDK and
 * signing evidence this pure adapter cannot verify; the server build
 * target type (headless) is not modeled in the cook/package payload
 * surface yet; console is SDK-gated and must be proven (lock rule 24);
 * web/spark are not Unreal targets at all (HTML5 platform support was
 * removed from the engine family; streaming arrangements are host-side).
 */
export const UNREAL_SUPPORTED_TARGETS: readonly ("windows" | "macos" | "linux")[] = Object.freeze(["windows", "macos", "linux"]);

/**
 * Typed compatibility refusal codes for the desktop-class binding
 * predicate. Typed refusals, never thrown exceptions (E8 discipline).
 */
export type UnrealBindingRefusalCode =
  | "unreal-binding/profile-target-unsupported"
  | "unreal-binding/profile-engine-not-declared"
  | "unreal-binding/profile-binding-not-pinned"
  | "unreal-binding/invalid-binding-ref";

/** The typed compatibility predicate result. */
export type UnrealTargetCompatibility =
  | { readonly compatible: true; readonly target: "windows" | "macos" | "linux" }
  | {
      readonly compatible: false;
      readonly code: UnrealBindingRefusalCode;
      readonly message: string;
      /** The incompatible target as observed (opaque text for evidence). */
      readonly target: string;
    };

/**
 * The typed Unreal engine binding — engine family id, a content digest
 * sealing its canonical form, and the desktop-class supported-target
 * declaration. The digest format matches target-profiles'
 * EngineBindingDigest wire format (`sha256:<64 hex>`) so build inputs can
 * pin the binding without conversion; target-profiles remains the
 * taxonomy authority (never a second authority here).
 */
export interface UnrealEngineBinding {
  readonly kind: "unreal-engine-binding";
  readonly engineId: EngineId;
  /** Content digest sealing this binding's canonical form. */
  readonly bindingDigest: EngineBindingDigest;
  /** Desktop-class targets this binding declares support for. */
  readonly supportedTargets: readonly ("windows" | "macos" | "linux")[];
}

/**
 * Builds the typed binding with a derived, content-addressed digest
 * (E9: the digest is computed from the binding content — engine family,
 * supported target set — never supplied by the caller, never random).
 */
export function createUnrealEngineBinding(): UnrealEngineBinding {
  const hex = contentDigestOf({
    kind: "unreal-engine-binding",
    engineId: UNREAL_ENGINE_ID,
    supportedTargets: [...UNREAL_SUPPORTED_TARGETS],
  });
  return Object.freeze({
    kind: "unreal-engine-binding",
    engineId: asEngineId(UNREAL_ENGINE_ID),
    bindingDigest: asEngineBindingDigest(`sha256:${hex}`),
    supportedTargets: Object.freeze([...UNREAL_SUPPORTED_TARGETS]),
  });
}

/**
 * Typed compatibility predicate: can this desktop-class binding serve the
 * given sealed target profile record? Composes target-profiles'
 * checkEngineBindingCompatibility (mutual consent: the profile's engine
 * declaration must accept `unreal` AND the binding must declare support
 * for the profile's target) and re-exposes the verdict in this package's
 * typed refusal vocabulary. PURE; never throws.
 */
export function unrealCanServeTargetProfile(
  binding: UnrealEngineBinding,
  profile: TargetProfileRecord,
): UnrealTargetCompatibility {
  const verdict = checkEngineBindingCompatibility(profile, {
    engineId: binding.engineId,
    bindingDigest: binding.bindingDigest,
    supportedTargets: binding.supportedTargets,
  });
  if (verdict.ok) {
    return { compatible: true, target: profile.target as "windows" | "macos" | "linux" };
  }
  const code: UnrealBindingRefusalCode =
    verdict.code === "target-not-supported"
      ? "unreal-binding/profile-target-unsupported"
      : verdict.code === "engine-not-declared"
        ? "unreal-binding/profile-engine-not-declared"
        : verdict.code === "binding-not-pinned"
          ? "unreal-binding/profile-binding-not-pinned"
          : "unreal-binding/invalid-binding-ref";
  return {
    compatible: false,
    code,
    message: verdict.message,
    target: String(profile.target),
  };
}

/**
 * Projects the typed binding into the build-contracts
 * {@link EngineBindingRef} wire shape (the digest-pinned engine binding
 * build inputs cite). Pure projection — no vocabulary is redefined, the
 * build-contracts seam stays authoritative for its own shape.
 */
export function toBuildContractsEngineBindingRef(binding: UnrealEngineBinding): EngineBindingRef {
  return {
    engineId: asBuildEngineId(UNREAL_ENGINE_ID),
    bindingDigest: binding.bindingDigest as EngineBindingRef["bindingDigest"],
    supportedTargets: binding.supportedTargets.map((target) => asBuildTargetId(target)),
  };
}

/** Type guard mirroring build-contracts' structural check over a projection. */
export function isProjectedEngineBindingRef(value: unknown): boolean {
  return isEngineBindingRef(value);
}
