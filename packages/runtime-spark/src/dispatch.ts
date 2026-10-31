/**
 * THE SPARK WORLD DISPATCH (PLX-ARCH-003, ACR-001 Phase B) — the pure
 * (worldKind, targetProfile)-aware routing projection over a GameIR
 * document's optional `world` declaration.
 *
 * ACR-001 (lock v1.1 Amendment 1) separates two previously conflated
 * dimensions:
 *
 * - `WorldKind` (the CONTENT axis): spark | game | experience |
 *   digital_twin | other — what the World IS;
 * - `TargetProfile` (the DELIVERY axis): spark_vertical | web | desktop |
 *   mobile | xr | dedicated_server | simulation — how the World is
 *   delivered.
 *
 * Spark has dual citizenship (ACR-001 §2): it is a registered World kind
 * AND it names the `spark_vertical` delivery profile. NEITHER fact implies
 * the other — the dispatch below therefore NEVER gates on the content
 * kind: a World of ANY kind declaring `targetProfile: "spark_vertical"`
 * routes through the Spark runtime, and a `spark`-kind World declaring a
 * different delivery profile does NOT.
 *
 * Legacy documents (no `world` declaration, or no `targetProfile` inside
 * it) keep the exact pre-ACR behavior: routing is decided by the
 * build-target list alone (ACR-001 §4 — "absent means unspecified").
 *
 * Pure module: a projection over declaration data; no IO, no clocks.
 */

import type { GameIRDocument } from "@playliquid/game-ir";
import { resolveWorldKind } from "@playliquid/game-contracts";
import type { TargetProfile, WorldKind } from "@playliquid/game-contracts";
import type { SparkRuntimeRefusal } from "./runtime-refusal.ts";

/**
 * The typed dispatch verdict for one GameIR document.
 *
 * - `"spark-vertical"`: the document DECLARES `spark_vertical` delivery —
 *   the Spark runtime is the route, for EVERY World kind (dual
 *   citizenship; the kind is carried for evidence, never for gating).
 * - `"legacy-undeclared"`: no delivery declaration — pre-ACR behavior;
 *   the build-target list alone decides routing (exactly as before).
 * - `"other-delivery"`: the document declares a NON-spark delivery
 *   profile — the Spark runtime is NOT the route.
 */
export type SparkWorldDispatch =
  | { readonly routing: "spark-vertical"; readonly worldKind: WorldKind; readonly targetProfile: "spark_vertical" }
  | { readonly routing: "legacy-undeclared"; readonly worldKind: WorldKind; readonly targetProfile: null }
  | { readonly routing: "other-delivery"; readonly worldKind: WorldKind; readonly targetProfile: TargetProfile }
  ;

/**
 * Projects a GameIR document's world declaration into the typed Spark
 * dispatch verdict. Pure and total: EVERY document — with or without a
 * `world` declaration, of ANY kind — yields exactly one verdict.
 */
export function dispatchSparkWorld(document: GameIRDocument): SparkWorldDispatch {
  const worldKind = resolveWorldKind(document.world);
  const targetProfile = document.world?.targetProfile;
  if (targetProfile === undefined) {
    return { routing: "legacy-undeclared", worldKind, targetProfile: null };
  }
  if (targetProfile === "spark_vertical") {
    return { routing: "spark-vertical", worldKind, targetProfile };
  }
  return { routing: "other-delivery", worldKind, targetProfile };
}

/**
 * The runtime-door admission rule (E8 discipline, expressed as data):
 * the Spark runtime admits a document when its delivery declaration is
 * EITHER `spark_vertical` OR absent (legacy, target-list-driven — the
 * pre-ACR behavior is unchanged). A declared non-spark delivery is a
 * routing mistake and is refused at the door
 * (`world-delivery-not-spark`, runtime.ts).
 *
 * The content kind NEVER participates in admission (ACR-001 §2).
 */
export function sparkRuntimeAdmitsWorld(document: GameIRDocument): boolean {
  return dispatchSparkWorld(document).routing !== "other-delivery";
}

/**
 * The typed runtime-door refusal for a document DECLARING a non-spark
 * delivery profile, or `null` when the document is admissible
 * (`spark_vertical` declared, or legacy undeclared). The routing
 * authority lives here (dispatch.ts); runtime.ts's construction door
 * consults it before planning (PLX-ARCH-003).
 */
export function sparkWorldDoorRefusal(document: GameIRDocument): SparkRuntimeRefusal | null {
  const dispatch = dispatchSparkWorld(document);
  if (dispatch.routing !== "other-delivery") {
    return null;
  }
  return {
    ok: false,
    code: "world-delivery-not-spark",
    message: `the document declares targetProfile "${dispatch.targetProfile}" — the Spark runtime serves spark_vertical deliveries and legacy undeclared documents only (ACR-001)`,
  };
}
