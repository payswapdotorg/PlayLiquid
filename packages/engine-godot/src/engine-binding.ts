/**
 * Module role: the TYPED Godot engine binding — the composition point
 * between the neutral Adapter seam and the build pipeline's
 * engine-binding vocabulary (target-profiles frozen taxonomy +
 * build-contracts request inputs). The binding declares the target
 * profiles this adapter can serve: `web` (the Godot HTML5 export target)
 * plus the desktop-class set `windows`, `macos`, `linux` — matching the
 * build.export capability's export-platform vocabulary. Compatibility
 * with a target profile record is a TYPED predicate result
 * ({ compatible: true } or a typed refusal), never a thrown exception,
 * mirroring target-profiles' checkEngineBindingCompatibility discipline.
 * The binding carries a content digest over its canonical form so build
 * inputs can pin it (build-contracts EngineBindingRef wire format:
 * `sha256:<64 hex>` — no format conversion).
 *
 * A pure predicate composes the typed binding with the build-contracts
 * engine-binding vocabulary (asBuildTargetId/asEngineId), so a Godot
 * binding can be cited in BuildInputs without any engine-specific types
 * leaking into build contracts (E3/E4: the Godot-specific definition
 * lives ONLY here).
 *
 * Implements: PL-024 typed engine binding + web/desktop-class target
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
export const GODOT_ENGINE_ID = "godot" as const;

/**
 * The target set this adapter can serve. Frozen subset of the
 * target-profiles taxonomy: `web` (the Godot HTML5 export target —
 * first-class in the engine family) plus the desktop-class trio
 * `windows`, `macos`, `linux` (the engine family's documented desktop
 * export targets). Mobile (`android`, `ios`, `spark`), `xr`,
 * `steamdeck`, `dedicated-server` and `console` profiles are
 * deliberately NOT declared: mobile export additionally requires
 * host-side vendor SDK, keystore/signing and store evidence this pure
 * adapter cannot verify; `spark` is a mobile-first fast-start profile
 * outside the declared set; XR export requires headset vendor
 * runtimes; `steamdeck` additionally pins Steam distribution/packaging
 * requirements (a Linux build alone is not a Steam Deck target
 * profile); the server build target type is not modeled in the
 * build.export payload surface yet; console is SDK-gated and must be
 * proven (lock rule 24).
 */
export const GODOT_SUPPORTED_TARGETS: readonly ("web" | "windows" | "macos" | "linux")[] = Object.freeze(["web", "windows", "macos", "linux"]);

/**
 * Typed compatibility refusal codes for the web + desktop-class binding
 * predicate. Typed refusals, never thrown exceptions (E8 discipline).
 */
export type GodotBindingRefusalCode =
  | "godot-binding/profile-target-unsupported"
  | "godot-binding/profile-engine-not-declared"
  | "godot-binding/profile-binding-not-pinned"
  | "godot-binding/invalid-binding-ref";

/** The typed compatibility predicate result. */
export type GodotTargetCompatibility =
  | { readonly compatible: true; readonly target: "web" | "windows" | "macos" | "linux" }
  | {
      readonly compatible: false;
      readonly code: GodotBindingRefusalCode;
      readonly message: string;
      /** The incompatible target as observed (opaque text for evidence). */
      readonly target: string;
    };

/**
 * The typed Godot engine binding — engine family id, a content digest
 * sealing its canonical form, and the web + desktop-class
 * supported-target declaration. The digest format matches
 * target-profiles' EngineBindingDigest wire format
 * (`sha256:<64 hex>`) so build inputs can pin the binding without
 * conversion; target-profiles remains the taxonomy authority (never a
 * second authority here).
 */
export interface GodotEngineBinding {
  readonly kind: "godot-engine-binding";
  readonly engineId: EngineId;
  /** Content digest sealing this binding's canonical form. */
  readonly bindingDigest: EngineBindingDigest;
  /** Web + desktop-class targets this binding declares support for. */
  readonly supportedTargets: readonly ("web" | "windows" | "macos" | "linux")[];
}

/**
 * Builds the typed binding with a derived, content-addressed digest
 * (E9: the digest is computed from the binding content — engine family,
 * supported target set — never supplied by the caller, never random).
 */
export function createGodotEngineBinding(): GodotEngineBinding {
  const hex = contentDigestOf({
    kind: "godot-engine-binding",
    engineId: GODOT_ENGINE_ID,
    supportedTargets: [...GODOT_SUPPORTED_TARGETS],
  });
  return Object.freeze({
    kind: "godot-engine-binding",
    engineId: asEngineId(GODOT_ENGINE_ID),
    bindingDigest: asEngineBindingDigest(`sha256:${hex}`),
    supportedTargets: Object.freeze([...GODOT_SUPPORTED_TARGETS]),
  });
}

/**
 * Typed compatibility predicate: can this web + desktop-class binding
 * serve the given sealed target profile record? Composes
 * target-profiles' checkEngineBindingCompatibility (mutual consent: the
 * profile's engine declaration must accept `godot` AND the binding must
 * declare support for the profile's target) and re-exposes the verdict
 * in this package's typed refusal vocabulary. PURE; never throws.
 */
export function godotCanServeTargetProfile(
  binding: GodotEngineBinding,
  profile: TargetProfileRecord,
): GodotTargetCompatibility {
  const verdict = checkEngineBindingCompatibility(profile, {
    engineId: binding.engineId,
    bindingDigest: binding.bindingDigest,
    supportedTargets: binding.supportedTargets,
  });
  if (verdict.ok) {
    return { compatible: true, target: profile.target as "web" | "windows" | "macos" | "linux" };
  }
  const code: GodotBindingRefusalCode =
    verdict.code === "target-not-supported"
      ? "godot-binding/profile-target-unsupported"
      : verdict.code === "engine-not-declared"
        ? "godot-binding/profile-engine-not-declared"
        : verdict.code === "binding-not-pinned"
          ? "godot-binding/profile-binding-not-pinned"
          : "godot-binding/invalid-binding-ref";
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
export function toBuildContractsEngineBindingRef(binding: GodotEngineBinding): EngineBindingRef {
  return {
    engineId: asBuildEngineId(GODOT_ENGINE_ID),
    bindingDigest: binding.bindingDigest as EngineBindingRef["bindingDigest"],
    supportedTargets: binding.supportedTargets.map((target) => asBuildTargetId(target)),
  };
}

/** Type guard mirroring build-contracts' structural check over a projection. */
export function isProjectedEngineBindingRef(value: unknown): boolean {
  return isEngineBindingRef(value);
}
