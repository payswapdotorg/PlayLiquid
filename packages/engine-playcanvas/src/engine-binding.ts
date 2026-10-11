/**
 * Module role: the TYPED PlayCanvas engine binding — the composition point
 * between the neutral Adapter seam and the build pipeline's engine-binding
 * vocabulary (target-profiles frozen taxonomy + build-contracts request
 * inputs). The binding declares the WEB-FIRST target profiles this
 * adapter can serve (`web`, `spark` — the web-first target profile
 * set); compatibility with a target profile record is a TYPED predicate
 * result ({ compatible: true } or a typed refusal), never a thrown
 * exception, mirroring target-profiles' checkEngineBindingCompatibility
 * discipline. The binding carries a content digest over its canonical
 * form so build inputs can pin it (build-contracts EngineBindingRef wire
 * format: `sha256:<64 hex>` — no format conversion).
 *
 * A pure predicate composes the typed binding with the build-contracts
 * engine-binding vocabulary (asBuildTargetId/asEngineId), so a
 * PlayCanvas binding can be cited in BuildInputs without any
 * engine-specific types leaking into build contracts (E3/E4: the
 * PlayCanvas-specific definition lives ONLY here).
 *
 * Implements: PL-021 typed engine binding + web-first target
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
export const PLAYCANVAS_ENGINE_ID = "playcanvas" as const;

/**
 * The web-first target set this adapter can serve. Frozen subset of the
 * target-profiles taxonomy: `web` (the web-first engine's home target)
 * and `spark` (9:16 mobile-first fast-start — a WEB-delivered target
 * profile per the architecture's Spark definition; lock rule 16).
 */
export const PLAYCANVAS_SUPPORTED_TARGETS: readonly ("web" | "spark")[] = Object.freeze(["web", "spark"]);

/**
 * Typed compatibility refusal codes for the web-first binding predicate.
 * Typed refusals, never thrown exceptions (E8 discipline).
 */
export type PlayCanvasBindingRefusalCode =
  | "playcanvas-binding/profile-target-unsupported"
  | "playcanvas-binding/profile-engine-not-declared"
  | "playcanvas-binding/profile-binding-not-pinned"
  | "playcanvas-binding/invalid-binding-ref";

/** The typed compatibility predicate result. */
export type PlayCanvasTargetCompatibility =
  | { readonly compatible: true; readonly target: "web" | "spark" }
  | {
      readonly compatible: false;
      readonly code: PlayCanvasBindingRefusalCode;
      readonly message: string;
      /** The incompatible target as observed (opaque text for evidence). */
      readonly target: string;
    };

/**
 * The typed PlayCanvas engine binding — engine family id, a content digest
 * sealing its canonical form, and the web-first supported-target
 * declaration. The digest format matches target-profiles'
 * EngineBindingDigest wire format (`sha256:<64 hex>`) so build inputs can
 * pin the binding without conversion; target-profiles remains the
 * taxonomy authority (never a second authority here).
 */
export interface PlayCanvasEngineBinding {
  readonly kind: "playcanvas-engine-binding";
  readonly engineId: EngineId;
  /** Content digest sealing this binding's canonical form. */
  readonly bindingDigest: EngineBindingDigest;
  /** Web-first targets this binding declares support for. */
  readonly supportedTargets: readonly ("web" | "spark")[];
}

/**
 * Builds the typed binding with a derived, content-addressed digest
 * (E9: the digest is computed from the binding content — engine family,
 * supported target set, adapter capability surface — never supplied by
 * the caller, never random).
 */
export function createPlayCanvasEngineBinding(): PlayCanvasEngineBinding {
  const hex = contentDigestOf({
    kind: "playcanvas-engine-binding",
    engineId: PLAYCANVAS_ENGINE_ID,
    supportedTargets: [...PLAYCANVAS_SUPPORTED_TARGETS],
  });
  return Object.freeze({
    kind: "playcanvas-engine-binding",
    engineId: asEngineId(PLAYCANVAS_ENGINE_ID),
    bindingDigest: asEngineBindingDigest(`sha256:${hex}`),
    supportedTargets: Object.freeze([...PLAYCANVAS_SUPPORTED_TARGETS]),
  });
}

/**
 * Typed compatibility predicate: can this web-first binding serve the
 * given sealed target profile record? Composes target-profiles'
 * checkEngineBindingCompatibility (mutual consent: the profile's engine
 * declaration must accept `playcanvas` AND the binding must declare
 * support for the profile's target) and re-exposes the verdict in this
 * package's typed refusal vocabulary. PURE; never throws.
 */
export function playCanvasCanServeTargetProfile(
  binding: PlayCanvasEngineBinding,
  profile: TargetProfileRecord,
): PlayCanvasTargetCompatibility {
  const verdict = checkEngineBindingCompatibility(profile, {
    engineId: binding.engineId,
    bindingDigest: binding.bindingDigest,
    supportedTargets: binding.supportedTargets,
  });
  if (verdict.ok) {
    return { compatible: true, target: profile.target as "web" | "spark" };
  }
  const code: PlayCanvasBindingRefusalCode =
    verdict.code === "target-not-supported"
      ? "playcanvas-binding/profile-target-unsupported"
      : verdict.code === "engine-not-declared"
        ? "playcanvas-binding/profile-engine-not-declared"
        : verdict.code === "binding-not-pinned"
          ? "playcanvas-binding/profile-binding-not-pinned"
          : "playcanvas-binding/invalid-binding-ref";
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
export function toBuildContractsEngineBindingRef(binding: PlayCanvasEngineBinding): EngineBindingRef {
  return {
    engineId: asBuildEngineId(PLAYCANVAS_ENGINE_ID),
    bindingDigest: binding.bindingDigest as EngineBindingRef["bindingDigest"],
    supportedTargets: binding.supportedTargets.map((target) => asBuildTargetId(target)),
  };
}

/** Type guard mirroring build-contracts' structural check over a projection. */
export function isProjectedEngineBindingRef(value: unknown): boolean {
  return isEngineBindingRef(value);
}
