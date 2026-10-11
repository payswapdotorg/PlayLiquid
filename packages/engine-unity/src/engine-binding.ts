/**
 * Module role: the TYPED Unity engine binding — the composition point
 * between the neutral Adapter seam and the build pipeline's
 * engine-binding vocabulary (target-profiles frozen taxonomy +
 * build-contracts request inputs). The binding declares the target
 * profiles this adapter can serve (`web`, `windows`, `macos`, `linux`,
 * `android`, `ios` — the web (WebGL) + desktop + mobile subset of the
 * frozen target taxonomy, matching the build.player capability's
 * build-platform vocabulary); compatibility with a target profile record
 * is a TYPED predicate result ({ compatible: true } or a typed refusal),
 * never a thrown exception, mirroring target-profiles'
 * checkEngineBindingCompatibility discipline. The binding carries a
 * content digest over its canonical form so build inputs can pin it
 * (build-contracts EngineBindingRef wire format: `sha256:<64 hex>` —
 * no format conversion).
 *
 * A pure predicate composes the typed binding with the build-contracts
 * engine-binding vocabulary (asBuildTargetId/asEngineId), so a Unity
 * binding can be cited in BuildInputs without any engine-specific types
 * leaking into build contracts (E3/E4: the Unity-specific definition
 * lives ONLY here).
 *
 * Implements: PL-023 typed engine binding + web/desktop/mobile target
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
export const UNITY_ENGINE_ID = "unity" as const;

/**
 * The target set this adapter can serve. Frozen subset of the
 * target-profiles taxonomy: `web` (WebGL is a real Unity build target),
 * `windows`/`macos`/`linux` (the Unity standalone desktop targets) and
 * `android`/`ios` (Unity's first-class mobile build targets — the build
 * step itself is engine-native; vendor SDK, signing and device
 * deployment are HOST-side, E11). Deliberately NOT declared: `spark`
 * (Unity WebGL output cannot honestly meet the 9:16 mobile-first
 * minimal-boot/first-interaction constraints without host-side evidence
 * — the profile deserves a purpose-built web runtime); `steamdeck`
 * (Unity has no distinct deck build target — a Linux build running on
 * the deck is host-deployment evidence, not an adapter declaration);
 * `xr` (Unity XR needs XR plugin packages + vendor SDKs the payload
 * surface does not model); `dedicated-server` (the server build target
 * type is not modeled in the build.player payload surface yet);
 * `console` (SDK-gated and must be proven — lock rule 24).
 */
export const UNITY_SUPPORTED_TARGETS: readonly ("web" | "windows" | "macos" | "linux" | "android" | "ios")[] = Object.freeze([
  "web",
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
]);

/**
 * Typed compatibility refusal codes for the binding predicate. Typed
 * refusals, never thrown exceptions (E8 discipline).
 */
export type UnityBindingRefusalCode =
  | "unity-binding/profile-target-unsupported"
  | "unity-binding/profile-engine-not-declared"
  | "unity-binding/profile-binding-not-pinned"
  | "unity-binding/invalid-binding-ref";

/** The typed compatibility predicate result. */
export type UnityTargetCompatibility =
  | { readonly compatible: true; readonly target: "web" | "windows" | "macos" | "linux" | "android" | "ios" }
  | {
      readonly compatible: false;
      readonly code: UnityBindingRefusalCode;
      readonly message: string;
      /** The incompatible target as observed (opaque text for evidence). */
      readonly target: string;
    };

/**
 * The typed Unity engine binding — engine family id, a content digest
 * sealing its canonical form, and the supported-target declaration. The
 * digest format matches target-profiles' EngineBindingDigest wire format
 * (`sha256:<64 hex>`) so build inputs can pin the binding without
 * conversion; target-profiles remains the taxonomy authority (never a
 * second authority here).
 */
export interface UnityEngineBinding {
  readonly kind: "unity-engine-binding";
  readonly engineId: EngineId;
  /** Content digest sealing this binding's canonical form. */
  readonly bindingDigest: EngineBindingDigest;
  /** Targets this binding declares support for. */
  readonly supportedTargets: readonly ("web" | "windows" | "macos" | "linux" | "android" | "ios")[];
}

/**
 * Builds the typed binding with a derived, content-addressed digest
 * (E9: the digest is computed from the binding content — engine family,
 * supported target set — never supplied by the caller, never random).
 */
export function createUnityEngineBinding(): UnityEngineBinding {
  const hex = contentDigestOf({
    kind: "unity-engine-binding",
    engineId: UNITY_ENGINE_ID,
    supportedTargets: [...UNITY_SUPPORTED_TARGETS],
  });
  return Object.freeze({
    kind: "unity-engine-binding",
    engineId: asEngineId(UNITY_ENGINE_ID),
    bindingDigest: asEngineBindingDigest(`sha256:${hex}`),
    supportedTargets: Object.freeze([...UNITY_SUPPORTED_TARGETS]),
  });
}

/**
 * Typed compatibility predicate: can this binding serve the given sealed
 * target profile record? Composes target-profiles'
 * checkEngineBindingCompatibility (mutual consent: the profile's engine
 * declaration must accept `unity` AND the binding must declare support
 * for the profile's target) and re-exposes the verdict in this package's
 * typed refusal vocabulary. PURE; never throws.
 */
export function unityCanServeTargetProfile(
  binding: UnityEngineBinding,
  profile: TargetProfileRecord,
): UnityTargetCompatibility {
  const verdict = checkEngineBindingCompatibility(profile, {
    engineId: binding.engineId,
    bindingDigest: binding.bindingDigest,
    supportedTargets: binding.supportedTargets,
  });
  if (verdict.ok) {
    return { compatible: true, target: profile.target as "web" | "windows" | "macos" | "linux" | "android" | "ios" };
  }
  const code: UnityBindingRefusalCode =
    verdict.code === "target-not-supported"
      ? "unity-binding/profile-target-unsupported"
      : verdict.code === "engine-not-declared"
        ? "unity-binding/profile-engine-not-declared"
        : verdict.code === "binding-not-pinned"
          ? "unity-binding/profile-binding-not-pinned"
          : "unity-binding/invalid-binding-ref";
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
export function toBuildContractsEngineBindingRef(binding: UnityEngineBinding): EngineBindingRef {
  return {
    engineId: asBuildEngineId(UNITY_ENGINE_ID),
    bindingDigest: binding.bindingDigest as EngineBindingRef["bindingDigest"],
    supportedTargets: binding.supportedTargets.map((target) => asBuildTargetId(target)),
  };
}

/** Type guard mirroring build-contracts' structural check over a projection. */
export function isProjectedEngineBindingRef(value: unknown): boolean {
  return isEngineBindingRef(value);
}
