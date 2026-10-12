/**
 * @playliquid/spark — public surface (PL-035).
 *
 * The Spark BUILD surface: build-contracts-shaped build documents for the
 * spark target driving build-orchestrator stages (intake → resolve →
 * plan → emit → verify → package), producing typed build results with
 * content digests over the boot plan + stream schedule + cache manifest
 * (composed from @playliquid/runtime-spark's pure planners over the same
 * game-ir content, E9).
 *
 * Spark is a TARGET PROFILE, not a second content model (lock rule 16):
 * - content: game-ir (the only content model — never re-declared);
 * - profile: target-profiles' frozen SparkTargetProfileRecord;
 * - request vocabulary: build-contracts (never re-declared);
 * - pipeline: build-orchestrator (the staged authority — this package
 *   drives it, it never re-implements a stage);
 * - planning digests: runtime-spark (the runtime's own pure planners).
 *
 * Imports per src/module.ts (the PL-010 governance manifest).
 *
 * Module map:
 * - document.ts  THE spark build document composer (E8 total, E9 digests)
 * - build.ts     the drive loop + typed results (R20 via orchestrator doors)
 * - fixtures.ts  deterministic fixtures (NOT exported from this barrel)
 * - harness.ts   build evidence harness (node src/harness.ts)
 *
 * NOT BUILT (deliberate, per the work order): no second content model,
 * no real network/CDN/storage (the orchestrator's ports host those), no
 * UI, no engine adapter (the engine-adapter family declares spark
 * support — this package only checks the cited binding declares the
 * spark target).
 */

// The spark build document (composition + digests)
export type {
  SparkBuildComposition,
  SparkBuildRefusalCode,
  SparkBuildReason,
  SparkBuildRefusal,
  SparkBuildPlanPayload,
  SparkBuildDocument,
  SparkBuildRequestIdentity,
} from "./document.ts";
export { composeSparkBuildDocument, sparkGameIrDigestOf, sparkBuildRequestOf } from "./document.ts";

// The spark build driver + typed results
export type {
  SparkBuildDriveRefusalCode,
  SparkBuildDriveRefusal,
  SparkBuildResult,
  SparkBuildOutcome,
} from "./build.ts";
export { runSparkBuild, sparkBuildResultDigestOf } from "./build.ts";
