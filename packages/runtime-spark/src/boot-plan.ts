/**
 * THE SPARK BOOT PLAN (R6 "minimal critical boot"; PL-035).
 *
 * `planSparkBoot` is the single deterministic planner that materializes
 * WHAT LOADS NOW versus WHAT STREAMS LATER from a game-ir document under
 * the FROZEN SparkTargetProfile (runtime-contracts — never re-declared
 * here, lock rule 16):
 *
 * - the profile's boot budgets (firstPaintTargetMs /
 *   firstInteractionTargetMs) are PLANNING INPUTS: with the explicit
 *   caller-supplied cost model (bytes per millisecond — data, never an
 *   invented platform policy number) the planner checks the critical set
 *   fits the budgets and refuses `first-paint-oversized` /
 *   `critical-boot-oversized` when it does not (E8 negative coverage);
 *   a profile whose first-interaction budget precedes its first-paint
 *   budget is refused `budget-inversion`;
 * - the 9:16 portrait viewport projection (viewport.ts) rides the plan;
 * - the deferred remainder leaves as typed digest-pinned descriptors
 *   (content.ts) with content-derived stream priorities.
 *
 * Boot is TOTAL (E8): profile, document, budget and size rejections are
 * accumulated in ONE pass; there are no partial plans. The plan digest
 * (package-system computeDigest, E7/E9) covers content + profile + cost
 * model and is deliberately TENANT-INDEPENDENT: same content + profile +
 * cost model ⇒ same digest, always. Tenant isolation is enforced by the
 * runtime that owns the plan (R20), not by the digest.
 *
 * Pure module: no IO, no clocks, no globals.
 */

import { validateSparkProfile } from "@playliquid/runtime-contracts";
import type { SparkTargetProfile } from "@playliquid/runtime-contracts";
import type { GameIRDocument } from "@playliquid/game-ir";
import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import { analyzeSparkContent } from "./content.ts";
import type { SparkContentRejection, SparkContentUnit, SparkDeferredUnit } from "./content.ts";
import { projectSparkViewport } from "./viewport.ts";
import type { SparkViewportProjection } from "./viewport.ts";

/** The boot cost model: caller-supplied planning data (E9). */
export interface SparkCostModel {
  /** Transfer throughput assumed while planning, bytes per millisecond. */
  readonly bytesPerMillisecond: number;
}

/** What a critical unit is required for (profile boot-entry vocabulary). */
export type SparkBootClassification = "first-paint" | "first-interaction";

/** One critical unit of the plan, in deterministic boot order. */
export interface SparkCriticalUnit extends SparkContentUnit {
  readonly classification: SparkBootClassification;
  /** 1-based position in the deterministic boot order. */
  readonly order: number;
}

/** The typed minimal-critical-boot plan. */
export interface SparkBootPlan {
  readonly kind: "spark-boot-plan";
  readonly profileId: "spark";
  readonly viewport: SparkViewportProjection;
  readonly entryWorldId: string;
  readonly entrySceneId: string;
  readonly criticalUnits: readonly SparkCriticalUnit[];
  readonly deferredUnits: readonly SparkDeferredUnit[];
  readonly budgets: {
    readonly firstPaintTargetMs: number;
    readonly firstInteractionTargetMs: number;
    readonly firstPaintBytes: number;
    readonly criticalBytes: number;
    readonly plannedFirstPaintMs: number;
    readonly plannedFirstInteractionMs: number;
  };
  readonly planDigest: ContentDigest;
}

/** One aggregated boot-planning rejection (kebab-case code, E8). */
export interface SparkBootRejection extends SparkContentRejection {
  /** Original contract/profile code when one exists (data, not policy). */
  readonly source?: string;
}

/** The result of {@link planSparkBoot}: a total plan or every rejection. */
export type SparkBootPlanResult =
  | { readonly ok: true; readonly plan: SparkBootPlan }
  | { readonly ok: false; readonly rejections: readonly SparkBootRejection[] };

/** Maps a critical unit kind to its boot classification (R6 fast-start). */
function classificationOf(kind: SparkContentUnit["kind"]): SparkBootClassification {
  return kind === "world" || kind === "scene" ? "first-paint" : "first-interaction";
}

/** The digest input of a plan (E9): content + profile + cost model only. */
function planDigestInput(plan: Omit<SparkBootPlan, "planDigest">): unknown {
  return {
    kind: plan.kind,
    profileId: plan.profileId,
    viewport: {
      formFactor: plan.viewport.formFactor,
      orientation: plan.viewport.orientation,
      aspectRatio: plan.viewport.aspectRatio,
    },
    entryWorldId: plan.entryWorldId,
    entrySceneId: plan.entrySceneId,
    criticalUnits: plan.criticalUnits.map((unit) => ({
      order: unit.order,
      unitId: unit.unitId,
      classification: unit.classification,
      bytes: unit.bytes,
      contentDigest: unit.contentDigest,
    })),
    deferredUnits: plan.deferredUnits.map((unit) => ({
      streamPriority: unit.streamPriority,
      unitId: unit.unitId,
      bytes: unit.bytes,
      contentDigest: unit.contentDigest,
      after: unit.after,
    })),
    budgets: plan.budgets,
  };
}

/**
 * THE boot planner. Deterministic (E9): the same document + profile +
 * cost model always produce the same plan digest. Total (E8): every
 * invalid input is an aggregated typed kebab-case rejection.
 */
export function planSparkBoot(
  document: GameIRDocument,
  profile: SparkTargetProfile,
  costModel: SparkCostModel,
): SparkBootPlanResult {
  const rejections: SparkBootRejection[] = [];
  if (typeof costModel?.bytesPerMillisecond !== "number" ||
    !Number.isFinite(costModel.bytesPerMillisecond) ||
    costModel.bytesPerMillisecond <= 0) {
    rejections.push({
      code: "invalid-cost-model",
      message: "cost model bytesPerMillisecond must be a finite positive number (planning input, E9)",
    });
  }
  // Total pre-guard: the contract validator dereferences the profile, so a
  // non-object candidate gets its typed refusal here (E1 totality).
  if (typeof profile !== "object" || profile === null) {
    rejections.push({
      code: "not-spark-profile",
      message: "spark boot planning requires a SparkTargetProfile object",
    });
    return { ok: false, rejections };
  }
  const profileValidation = validateSparkProfile(profile);
  if (!profileValidation.ok) {
    rejections.push({
      code:
        profileValidation.code === "first-interaction-before-first-paint"
          ? "budget-inversion"
          : profileValidation.code,
      source: profileValidation.code,
      message: `spark target profile refused: ${profileValidation.code}`,
    });
  }
  if (profile?.boot?.firstInteractionTargetMs < profile?.boot?.firstPaintTargetMs) {
    rejections.push({
      code: "budget-inversion",
      source: "first-interaction-before-first-paint",
      message: "first-interaction budget precedes the first-paint budget",
    });
  }
  // The content walk aggregates its own rejections in one pass; merged
  // here with the profile/cost rejections collected above (E8 totality).
  // Byte-budget checks need parsed content, so they run only past this
  // point — every checkable rejection is still reported.
  const analysis = analyzeSparkContent(document);
  if (!analysis.ok) {
    return { ok: false, rejections: [...rejections, ...analysis.rejections] };
  }
  if (rejections.length > 0) return { ok: false, rejections };

  const { criticalUnits: units, deferredUnits, totalBytes } = analysis.analysis;
  const criticalUnits: SparkCriticalUnit[] = units.map((unit, index) => ({
    ...unit,
    classification: classificationOf(unit.kind),
    order: index + 1,
  }));
  const firstPaintBytes = criticalUnits
    .filter((unit) => unit.classification === "first-paint")
    .reduce((sum, unit) => sum + unit.bytes, 0);
  const criticalBytes = totalBytes - deferredUnits.reduce((sum, unit) => sum + unit.bytes, 0);
  const throughput = costModel.bytesPerMillisecond;
  const plannedFirstPaintMs = Math.ceil(firstPaintBytes / throughput);
  const plannedFirstInteractionMs = Math.ceil(criticalBytes / throughput);
  const firstPaintBudgetBytes = profile.boot.firstPaintTargetMs * throughput;
  const firstInteractionBudgetBytes = profile.boot.firstInteractionTargetMs * throughput;
  if (firstPaintBytes > firstPaintBudgetBytes) {
    rejections.push({
      code: "first-paint-oversized",
      message: `first-paint units are ${firstPaintBytes} bytes but the first-paint budget allows ${firstPaintBudgetBytes} bytes (${profile.boot.firstPaintTargetMs}ms × ${throughput} B/ms)`,
    });
  }
  if (criticalBytes > firstInteractionBudgetBytes) {
    rejections.push({
      code: "critical-boot-oversized",
      message: `critical boot is ${criticalBytes} bytes but the first-interaction budget allows ${firstInteractionBudgetBytes} bytes (${profile.boot.firstInteractionTargetMs}ms × ${throughput} B/ms)`,
    });
  }
  const viewport = projectSparkViewport(profile);
  if (!viewport.ok) {
    // Defense-in-depth: a structurally spark profile always projects; a
    // non-projecting profile is reported with everything already found
    // (E8 totality — no partial plan ever escapes).
    return { ok: false, rejections: [...rejections, { code: viewport.code, message: viewport.message }] };
  }
  if (rejections.length > 0) return { ok: false, rejections };

  const entryWorld = criticalUnits.find((unit) => unit.kind === "world");
  const plan: Omit<SparkBootPlan, "planDigest"> = {
    kind: "spark-boot-plan",
    profileId: "spark",
    viewport: viewport,
    entryWorldId: entryWorld?.unitId ?? "",
    entrySceneId: String(document.entry.scene),
    criticalUnits,
    deferredUnits,
    budgets: {
      firstPaintTargetMs: profile.boot.firstPaintTargetMs,
      firstInteractionTargetMs: profile.boot.firstInteractionTargetMs,
      firstPaintBytes,
      criticalBytes,
      plannedFirstPaintMs,
      plannedFirstInteractionMs,
    },
  };
  return { ok: true, plan: { ...plan, planDigest: computeDigest(planDigestInput(plan)) } };
}
