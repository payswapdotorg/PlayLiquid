/**
 * @playliquid/runtime-spark — public surface (PL-035).
 *
 * The Spark RUNTIME: a thin fast-start shell over the merged runtime-core
 * Interactive kernel (PL-013 — never a fork), per spec/architecture.md
 * §Spark ("Spark is a target profile, not a second content model") and R6
 * ("Spark is a 9:16 mobile-first fast-start target").
 *
 * Imports per src/module.ts (the PL-010 governance manifest): runtime-core
 * (the kernel), runtime-contracts (the FROZEN SparkTargetProfile +
 * Experience Protocol vocabulary), game-ir (the only content model),
 * game-contracts (spatial/streaming vocabulary), platform-contracts
 * (TenantId tenancy), package-system (the digest authority, E7).
 *
 * Module map:
 * - viewport.ts         the 9:16 portrait projection (R6, pure math)
 * - content.ts          the game-ir walk: critical vs deferred units
 * - boot-plan.ts        THE typed boot plan (budget planning inputs, E9)
 * - stream-schedule.ts  typed progressive stream schedules (E9 order)
 * - cache.ts            content-addressed cache admission (R15 rules)
 * - ports.ts            the IO seams (E11: no real network/storage)
 * - streaming.ts        batch execution through the ports (R6/R15)
 * - record.ts           the immutable SparkBootRecord (E10)
 * - runtime.ts          the shell over the runtime-core kernel (R20)
 * - fakes.ts            TEST-SUPPORT deterministic fakes (E11)
 * - harness.ts          runtime evidence harness (node src/harness.ts)
 *
 * NOT BUILT (deliberate, per the work order): no second content model,
 * no real network/CDN/storage (ports + fakes only), no UI (PL-033's
 * game-ui owns presentation), no engine adapter (family done).
 */

// Viewport projection (R6)
export type {
  SparkViewportProjection,
  SparkViewportRefusalCode,
  SparkViewportRefusal,
  ScreenRectangle,
  ProjectedSparkFrame,
} from "./viewport.ts";
export {
  SPARK_ASPECT_RATIO,
  SPARK_ORIENTATION,
  SPARK_FORM_FACTOR,
  projectSparkViewport,
  projectScreenToSparkFrame,
} from "./viewport.ts";

// World dispatch (ACR-001 / PLX-ARCH-003)
export type { SparkWorldDispatch } from "./dispatch.ts";
export { dispatchSparkWorld, sparkRuntimeAdmitsWorld } from "./dispatch.ts";

// Content analysis (game-ir is the only content model)
export type {
  SparkContentUnit,
  SparkDeferredUnit,
  SparkContentAnalysis,
  SparkContentRejection,
} from "./content.ts";
export { SPARK_DEFAULT_STREAMING, analyzeSparkContent } from "./content.ts";

// Boot plan (minimal critical boot, R6)
export type {
  SparkCostModel,
  SparkBootClassification,
  SparkCriticalUnit,
  SparkBootPlan,
  SparkBootRejection,
  SparkBootPlanResult,
} from "./boot-plan.ts";
export { planSparkBoot } from "./boot-plan.ts";

// Stream schedule (progressive streaming, R15)
export type {
  SparkStreamBatch,
  SparkStreamSchedule,
  SparkScheduleRefusalCode,
  SparkScheduleRefusal,
} from "./stream-schedule.ts";
export { scheduleSparkStreams, sparkScheduleDigestOf, validateSparkSchedule } from "./stream-schedule.ts";

// Cache admission (aggressive caching, R15)
export type {
  SparkCacheAdmissionKind,
  SparkCacheRule,
  SparkCacheManifest,
  SparkCacheRefusalCode,
  SparkCacheRefusal,
  SparkCacheCandidate,
  SparkCacheAdmission,
} from "./cache.ts";
export { buildSparkCacheManifest, admitSparkCacheEntry, sparkCacheManifestDigestOf } from "./cache.ts";

// IO ports (E11)
export type {
  SparkClock,
  SparkFetchedContent,
  SparkFetchRefusal,
  SparkContentSourcePort,
  SparkCacheEntry,
  SparkCacheWriteRefusal,
  SparkCachePort,
} from "./ports.ts";

// Boot record (E10)
export type { SparkBootRecord } from "./record.ts";
export {
  sealSparkBootRecord,
  sparkBootRecordDigestOf,
  verifySparkBootRecord,
  sparkFirstCommandDigestOf,
} from "./record.ts";

// The runtime shell (R20)
export type {
  SparkRuntimeOptions,
  SparkRuntimeRefusalCode,
  SparkRuntimeRefusal,
  SparkRuntimeCreation,
  SparkRuntimePhase,
  SparkRuntimeView,
  SparkStreamedUnitReport,
} from "./runtime.ts";
export { SparkRuntime, createSparkRuntime } from "./runtime.ts";

// Progressive stream execution (R6/R15; E11 seams)
export type {
  SparkStreamSuccess,
  SparkStreamFailure,
  SparkStreamExecutionResult,
} from "./streaming.ts";
export { executeSparkStreamBatch } from "./streaming.ts";

// Test support (NOT production adapters)
export type { FakeSparkContentSourceOptions, TamperMode, CacheTamperScript } from "./fakes.ts";
export { ManualSparkClock, FakeSparkContentSource, InMemorySparkCache } from "./fakes.ts";
