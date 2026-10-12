/**
 * THE ENGINE BINDING CATALOG (PL-036) — the typed seam through which
 * target-set resolution consumes the four MERGED engine adapters
 * (PL-021 PlayCanvas, PL-022 Unreal, PL-023 Unity, PL-024 Godot).
 *
 * One authority per concern: every engine-specific type stays inside its
 * adapter package (E4) — this module only projects each adapter's TYPED
 * binding into the neutral catalog entry resolution consumes:
 * - `binding` is the build-contracts {@link EngineBindingRef} the adapter
 *   itself projects (its own `toBuildContractsEngineBindingRef`), so
 *   per-target build inputs cite the adapter's digest-pinned binding
 *   without any re-implementation;
 * - `canServe` is the adapter's OWN compatibility predicate (mutual
 *   consent with the sealed target profile record), re-exposed as a total
 *   typed verdict — never a throw, never a re-implementation of the
 *   compatibility rules (target-profiles' checkEngineBindingCompatibility
 *   remains the authority each adapter composes).
 *
 * The default catalog enumerates the four adapters in their merge order
 * (playcanvas, unreal, unity, godot). That order is FROZEN: when several
 * engines consent to serve one target, the FIRST consenting catalog entry
 * binds it — a deterministic, content-independent selection rule (E9).
 */

import type { EngineBindingRef, EngineId } from "@playliquid/build-contracts";
import type { TargetProfileRecord } from "@playliquid/target-profiles";
import {
  createPlayCanvasEngineBinding,
  playCanvasCanServeTargetProfile,
  toBuildContractsEngineBindingRef as playCanvasBindingRef,
} from "@playliquid/engine-playcanvas";
import {
  createUnrealEngineBinding,
  unrealCanServeTargetProfile,
  toBuildContractsEngineBindingRef as unrealBindingRef,
} from "@playliquid/engine-unreal";
import {
  createUnityEngineBinding,
  unityCanServeTargetProfile,
  toBuildContractsEngineBindingRef as unityBindingRef,
} from "@playliquid/engine-unity";
import {
  createGodotEngineBinding,
  godotCanServeTargetProfile,
  toBuildContractsEngineBindingRef as godotBindingRef,
} from "@playliquid/engine-godot";

/** One adapter's typed serve verdict (total; never throws). */
export type EngineServeVerdict =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly code: string; readonly message: string };

/** One engine adapter's entry in the catalog (neutral projection, E3/E4). */
export interface EngineCatalogEntry {
  /** The adapter's engine family id (build-contracts seam vocabulary). */
  readonly engineId: EngineId;
  /** The adapter's digest-pinned engine binding, as build inputs cite it. */
  readonly binding: EngineBindingRef;
  /** The adapter's own typed compatibility predicate (mutual consent). */
  readonly canServe: (profile: TargetProfileRecord) => EngineServeVerdict;
}

/** The catalog resolution iterates (frozen order = the merge order). */
export type EngineCatalog = readonly EngineCatalogEntry[];

/** Wraps one adapter's typed predicate into the neutral verdict shape. */
function serveVerdictOf(
  verdict: { readonly compatible: true } | { readonly compatible: false; readonly code: string; readonly message: string },
): EngineServeVerdict {
  return verdict;
}

/** The DEFAULT catalog: the four merged engine adapters in merge order. */
export function createDefaultEngineCatalog(): EngineCatalog {
  const playCanvas = createPlayCanvasEngineBinding();
  const unreal = createUnrealEngineBinding();
  const unity = createUnityEngineBinding();
  const godot = createGodotEngineBinding();
  return [
    {
      engineId: playCanvasBindingRef(playCanvas).engineId,
      binding: playCanvasBindingRef(playCanvas),
      canServe: (profile) => {
        const verdict = playCanvasCanServeTargetProfile(playCanvas, profile);
        return verdict.compatible
          ? { compatible: true }
          : serveVerdictOf({ compatible: false, code: verdict.code, message: verdict.message });
      },
    },
    {
      engineId: unrealBindingRef(unreal).engineId,
      binding: unrealBindingRef(unreal),
      canServe: (profile) => {
        const verdict = unrealCanServeTargetProfile(unreal, profile);
        return verdict.compatible
          ? { compatible: true }
          : serveVerdictOf({ compatible: false, code: verdict.code, message: verdict.message });
      },
    },
    {
      engineId: unityBindingRef(unity).engineId,
      binding: unityBindingRef(unity),
      canServe: (profile) => {
        const verdict = unityCanServeTargetProfile(unity, profile);
        return verdict.compatible
          ? { compatible: true }
          : serveVerdictOf({ compatible: false, code: verdict.code, message: verdict.message });
      },
    },
    {
      engineId: godotBindingRef(godot).engineId,
      binding: godotBindingRef(godot),
      canServe: (profile) => {
        const verdict = godotCanServeTargetProfile(godot, profile);
        return verdict.compatible
          ? { compatible: true }
          : serveVerdictOf({ compatible: false, code: verdict.code, message: verdict.message });
      },
    },
  ];
}

/** Every engine id of a catalog, in catalog order (deterministic, E9). */
export function catalogEngineIds(catalog: EngineCatalog): readonly EngineId[] {
  return catalog.map((entry) => entry.engineId);
}
