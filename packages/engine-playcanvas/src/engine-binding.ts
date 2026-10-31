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
import { isTargetProfile } from "@playliquid/game-contracts";
import type { TargetProfile, WorldDeclaration } from "@playliquid/game-contracts";
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
 * ACR-001 (2026-10-31, lock v1.1) delivery axis: the mapping from the
 * web-first BUILD targets this binding declares to the typed TargetProfile
 * delivery registry owned by game-contracts (single definition site, E1).
 * `web` delivers the `web` profile; the `spark` target delivers the
 * `spark_vertical` profile (the delivery axis is DISTINCT from the
 * build-target axis — ACR-001 §2.4).
 */
export const PLAYCANVAS_DELIVERY_BY_TARGET: Readonly<Record<"web" | "spark", TargetProfile>> = Object.freeze({
  web: "web",
  spark: "spark_vertical",
});

/** The delivery profiles DERIVED from the frozen web-first target set. */
export const PLAYCANVAS_DELIVERY_PROFILES: readonly TargetProfile[] = Object.freeze(
  PLAYCANVAS_SUPPORTED_TARGETS.map((target) => PLAYCANVAS_DELIVERY_BY_TARGET[target]),
);

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
 * Typed compatibility refusal codes for the web-first binding predicate.
 * Typed refusals, never thrown exceptions (E8 discipline).
 */
export type PlayCanvasBindingRefusalCode =
  | "playcanvas-binding/profile-target-unsupported"
  | "playcanvas-binding/profile-engine-not-declared"
  | "playcanvas-binding/profile-binding-not-pinned"
  | "playcanvas-binding/invalid-binding-ref"
  /** ACR-001 (PLX-ARCH-003): invalid explicit delivery-profile declarations. */
  | "playcanvas-binding/invalid-delivery-profiles"
  /** ACR-001 (PLX-ARCH-003): a delivery profile this binding does not serve. */
  | "playcanvas-binding/delivery-profile-unsupported";

/**
 * The typed PlayCanvas engine binding — engine family id, a content digest
 * sealing its canonical form, and the web-first supported-target
 * declaration. The digest format matches target-profiles'
 * EngineBindingDigest wire format (`sha256:<64 hex>`) so build inputs can
 * pin the binding without conversion; target-profiles remains the
 * taxonomy authority (never a second authority here).
 *
 * ACR-001 (PLX-ARCH-003): the binding additionally carries the typed
 * delivery-profile dimension — DERIVED from the frozen target set by
 * default (digest unchanged: derived data is a pure function of the
 * digested fields), or PINNED explicitly through
 * {@link configurePlayCanvasDeliveryProfiles} (the explicit declaration
 * joins the digest — E9: everything not derivable is pinned).
 */
export interface PlayCanvasEngineBinding {
  readonly kind: "playcanvas-engine-binding";
  readonly engineId: EngineId;
  /** Content digest sealing this binding's canonical form. */
  readonly bindingDigest: EngineBindingDigest;
  /** Web-first targets this binding declares support for. */
  readonly supportedTargets: readonly ("web" | "spark")[];
  /** The typed delivery profiles this binding serves (ACR-001 delivery axis). */
  readonly deliveryProfiles: readonly TargetProfile[];
}

/**
 * Builds the typed binding with a derived, content-addressed digest
 * (E9: the digest is computed from the binding content — engine family,
 * supported target set, adapter capability surface — never supplied by
 * the caller, never random). The delivery profiles are DERIVED from the
 * frozen target set ({@link PLAYCANVAS_DELIVERY_BY_TARGET}) and the digest
 * keeps its exact pre-ACR input shape (legacy bindings stay byte-identical).
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
    deliveryProfiles: Object.freeze([...PLAYCANVAS_DELIVERY_PROFILES]),
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

// ---------------------------------------------------------------------------
// ACR-001 (PLX-ARCH-003): the typed delivery-profile dimension — explicit
// configuration, the serve predicate, and the (kind-agnostic) world-delivery
// dispatch view. Pure; typed refusals, never exceptions (E8).
// ---------------------------------------------------------------------------

/** The typed result of an explicit delivery-profile configuration. */
export type PlayCanvasDeliveryConfiguration =
  | { readonly ok: true; readonly binding: PlayCanvasEngineBinding }
  | {
      readonly ok: false;
      readonly code: "playcanvas-binding/invalid-delivery-profiles";
      readonly message: string;
    };

/**
 * Derives a NEW binding with EXPLICITLY declared delivery profiles. The
 * explicit declaration joins the binding digest (E9: an explicit delivery
 * surface is binding content, not a derivation), so the returned binding's
 * digest differs from the default binding's — profile records that pin
 * bindings re-pin the new digest deliberately. Legacy behavior and the
 * default binding are unchanged. PURE; typed refusal on invalid input.
 */
export function configurePlayCanvasDeliveryProfiles(
  binding: PlayCanvasEngineBinding,
  deliveryProfiles: readonly TargetProfile[],
): PlayCanvasDeliveryConfiguration {
  if (
    !Array.isArray(deliveryProfiles) ||
    deliveryProfiles.length === 0 ||
    !deliveryProfiles.every((profile) => isTargetProfile(profile)) ||
    new Set(deliveryProfiles as readonly string[]).size !== deliveryProfiles.length
  ) {
    return {
      ok: false,
      code: "playcanvas-binding/invalid-delivery-profiles",
      message: "delivery profiles must be a non-empty array of distinct registered TargetProfile values (ACR-001 registry)",
    };
  }
  const hex = contentDigestOf({
    kind: "playcanvas-engine-binding",
    engineId: PLAYCANVAS_ENGINE_ID,
    supportedTargets: [...binding.supportedTargets],
    deliveryProfiles: [...deliveryProfiles],
  });
  return {
    ok: true,
    binding: Object.freeze({
      kind: "playcanvas-engine-binding",
      engineId: binding.engineId,
      bindingDigest: asEngineBindingDigest(`sha256:${hex}`),
      supportedTargets: binding.supportedTargets,
      deliveryProfiles: Object.freeze([...deliveryProfiles]),
    }),
  };
}

/** The typed delivery-profile serve predicate result. */
export type PlayCanvasDeliveryCompatibility =
  | { readonly serves: true; readonly deliveryProfile: TargetProfile }
  | {
      readonly serves: false;
      readonly code: "playcanvas-binding/delivery-profile-unsupported";
      readonly message: string;
      readonly deliveryProfile: string;
    };

/**
 * Typed predicate: can this binding serve the given typed delivery
 * profile? The delivery axis is INDEPENDENT of the build-target axis
 * (ACR-001 §2) — this answers the DELIVERY question only.
 */
export function playCanvasCanServeDeliveryProfile(
  binding: PlayCanvasEngineBinding,
  deliveryProfile: TargetProfile,
): PlayCanvasDeliveryCompatibility {
  if (binding.deliveryProfiles.includes(deliveryProfile)) {
    return { serves: true, deliveryProfile };
  }
  return {
    serves: false,
    code: "playcanvas-binding/delivery-profile-unsupported",
    message: `the playcanvas binding serves [${binding.deliveryProfiles.join(", ")}] but "${String(deliveryProfile)}" was requested (ACR-001 delivery axis)`,
    deliveryProfile: String(deliveryProfile),
  };
}

/**
 * The (worldKind, targetProfile)-aware dispatch view over a GameIR world
 * declaration (ACR-001 §2/§4). The content kind NEVER participates — ANY
 * kind of World may be delivered web or spark_vertical through this
 * binding; only the DECLARED delivery profile decides:
 * - no `targetProfile` declared → `declared: false` (legacy: routing is
 *   decided by the build-target list alone, exactly as before);
 * - declared and served → `serves: true`;
 * - declared and not served → a typed refusal (the binding is the wrong
 *   route for that delivery).
 */
export type PlayCanvasWorldDelivery =
  | { readonly declared: false }
  | ({ readonly declared: true } & PlayCanvasDeliveryCompatibility);

/** Projects a world declaration into the binding's typed delivery verdict. */
export function playCanvasCanServeWorldDelivery(
  binding: PlayCanvasEngineBinding,
  world: WorldDeclaration | undefined,
): PlayCanvasWorldDelivery {
  const deliveryProfile = world?.targetProfile;
  if (deliveryProfile === undefined) {
    return { declared: false };
  }
  return { declared: true, ...playCanvasCanServeDeliveryProfile(binding, deliveryProfile) };
}
