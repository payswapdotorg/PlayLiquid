/**
 * LUMEN RUN — the versioned game composition (PL-037; §Game model).
 *
 * "Game = versioned composition of packages + target profile + runtime
 * policy." This module is that sentence as code: one function assembles
 * the game from its parts and refuses — with a typed refusal, never a
 * partial game — when any part fails its gate:
 *
 * 1. the GameIR document must validate (the kernel's own oracle);
 * 2. the packages must publish through the registry (the provenance/
 *    licensing release gate runs INSIDE that admission, R19) and the
 *    lock must verify against BOTH the registry and the CAS (lock
 *    rule 10);
 * 3. the engine binding must be able to serve the target profile
 *    (mutual consent, typed);
 * 4. the spark boot planning must fit the declared fast-start budgets
 *    (R6 — refusal codes surface verbatim).
 *
 * The sealed composition carries every digest downstream consumers pin:
 * the GameIR content digest, the lock fingerprint, the profile digest,
 * the binding digest and the spark planning digests (E9: all
 * content-derived, so the same inputs always compose identically).
 */

import { validate } from "../../../packages/game-ir/src/index.ts";
import type { GameIRDocument, Diagnostic } from "../../../packages/game-ir/src/index.ts";
import { computeDigest } from "../../../packages/package-system/src/index.ts";
import { playCanvasCanServeTargetProfile } from "../../../packages/engine-playcanvas/src/index.ts";
import type { PlayCanvasEngineBinding } from "../../../packages/engine-playcanvas/src/index.ts";
import type { SparkTargetProfileRecord } from "../../../packages/target-profiles/src/index.ts";
import { lumenEngineBinding, lumenSparkProfileRecord, planLumenSpark } from "./build.ts";
import { lumenRunDocument } from "./document.ts";
import { lockFingerprintOf, publishGamePackages, verifyGameLock } from "./packages.ts";
import type { PublishedPackages } from "./packages.ts";

/** The sealed, digest-pinned game composition. */
export interface GameComposition {
  readonly ok: true;
  readonly document: GameIRDocument;
  readonly packages: PublishedPackages;
  readonly profile: SparkTargetProfileRecord;
  readonly engineBinding: PlayCanvasEngineBinding;
  /** Spark fast-start planning digests over the same document (R6). */
  readonly spark: {
    readonly planDigest: string;
    readonly scheduleDigest: string;
    readonly cacheManifestDigest: string;
    readonly criticalBytes: number;
    readonly deferredUnitCount: number;
    readonly plannedFirstPaintMs: number;
    readonly plannedFirstInteractionMs: number;
  };
  /** The full-document GameIR content digest (sha256:<hex>). */
  readonly gameIrDigest: string;
  /** The lock fingerprint (sha256:<hex>). */
  readonly lockFingerprint: string;
  /** Content digest sealing the whole composition. */
  readonly compositionDigest: string;
}

/** Why a composition was refused (typed, aggregated; E8 totality). */
export type CompositionRefusal =
  | { readonly ok: false; readonly code: "document-invalid"; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly code: "package-publication-refused"; readonly stage: string; readonly packageId: string; readonly detail: string }
  | { readonly ok: false; readonly code: "lock-unverified"; readonly problems: readonly { readonly code: string; readonly message: string }[] }
  | { readonly ok: false; readonly code: "engine-binding-incompatible"; readonly refusalCode: string; readonly detail: string }
  | { readonly ok: false; readonly code: "spark-planning-refused"; readonly rejections: readonly { readonly code: string; readonly message: string }[] };

/** Composition inputs (every field optional — the canonical game is the default). */
export interface CompositionInput {
  readonly document?: GameIRDocument;
  readonly profile?: SparkTargetProfileRecord;
}

/**
 * Composes the game. Total: either the sealed composition or a typed
 * refusal carrying the refusing gate's own vocabulary.
 */
export async function composeGame(input: CompositionInput = {}): Promise<GameComposition | CompositionRefusal> {
  const document = input.document ?? lumenRunDocument();

  const validation = validate(document);
  if (!validation.ok) return { ok: false, code: "document-invalid", diagnostics: validation.diagnostics };

  const packages = await publishGamePackages(document);
  if (!packages.ok) {
    return { ok: false, code: "package-publication-refused", stage: packages.stage, packageId: packages.packageId, detail: packages.detail };
  }

  const lockVerification = verifyGameLock(packages);
  if (!lockVerification.pass) {
    return {
      ok: false,
      code: "lock-unverified",
      problems: lockVerification.pins.flatMap((pin) => pin.problems.map((problem) => ({ code: problem.code, message: problem.message }))),
    };
  }

  const profile = input.profile ?? lumenSparkProfileRecord();
  const engineBinding = lumenEngineBinding();
  const compatibility = playCanvasCanServeTargetProfile(engineBinding, profile);
  if (!compatibility.compatible) {
    return { ok: false, code: "engine-binding-incompatible", refusalCode: compatibility.code, detail: compatibility.message };
  }

  const planning = planLumenSpark(document, profile);
  if (!planning.ok) {
    return { ok: false, code: "spark-planning-refused", rejections: planning.rejections };
  }

  const gameIrDigest = planning.gameIrDigest;
  const lockFingerprint = lockFingerprintOf(packages);
  const compositionDigest = computeDigest({
    game: "lumen-run",
    gameIrDigest,
    lockFingerprint,
    profileDigest: profile.profileDigest,
    engineBindingDigest: engineBinding.bindingDigest,
    planDigest: planning.plan.planDigest,
    scheduleDigest: planning.schedule.scheduleDigest,
    cacheManifestDigest: planning.manifest.manifestDigest,
  });

  return {
    ok: true as const,
    document,
    packages,
    profile,
    engineBinding,
    spark: {
      planDigest: planning.plan.planDigest,
      scheduleDigest: planning.schedule.scheduleDigest,
      cacheManifestDigest: planning.manifest.manifestDigest,
      criticalBytes: planning.plan.budgets.criticalBytes,
      deferredUnitCount: planning.plan.deferredUnits.length,
      plannedFirstPaintMs: planning.plan.budgets.plannedFirstPaintMs,
      plannedFirstInteractionMs: planning.plan.budgets.plannedFirstInteractionMs,
    },
    gameIrDigest,
    lockFingerprint,
    compositionDigest,
  };
}
