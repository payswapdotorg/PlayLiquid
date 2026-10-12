/**
 * THE SPARK RUNTIME (PL-035) — a THIN fast-start shell over the merged
 * runtime-core Interactive kernel (PL-013), never a fork.
 *
 * One authority per concern (E1/E2):
 * - planning: boot-plan.ts / stream-schedule.ts / cache.ts (pure);
 * - session state and the canonical command/event path: the
 *   InteractiveRuntimeKernel (runtime-core), constructed here with the
 *   spark target profile and driven by `boot` / `interact`;
 * - IO: the injected ports (ports.ts — E11: no real network/storage);
 * - time: the injected clock (E3/E9).
 *
 * First-interaction discipline: `boot()` applies the plan and marks the
 * session interaction-ready; the ONE-TIME `firstInteraction()` door
 * accepts the first command through the kernel's canonical `act` path
 * and seals the immutable SparkBootRecord (E10 — a second attempt is a
 * typed `boot-record-immutable` refusal, never a re-record). Ongoing
 * commands use `interact()` (kernel `act`, no recording).
 *
 * Tenancy (R20): the instance is scoped to ONE tenant at construction;
 * every door re-checks the caller's tenant through platform-contracts'
 * `checkTenantIsolation` — cross-tenant access is a typed refusal.
 *
 * Async/stateful notes: all operations are synchronous and idempotent by
 * the kernel's command idempotency; the only mutable owner is THIS
 * instance (phase, streaming cursor, boot record).
 */

import {
  asDeterminismSeed,
  asDigest,
  asGameIrDigest,
  asSessionId,
  asTargetProfileId,
  asTimestamp,
  makeSessionDescriptor,
} from "@playliquid/runtime-contracts";
import type { RuntimePolicyRef, SparkTargetProfile } from "@playliquid/runtime-contracts";
import { createInteractiveRuntime } from "@playliquid/runtime-core";
import type {
  ActInput,
  ActResult,
  CapabilityPort,
  InteractiveRuntimeKernel,
  SnapshotStorePort,
  WorldDriver,
} from "@playliquid/runtime-core";
import type { JsonSafeValue } from "@playliquid/runtime-core";
import type { GameIRDocument } from "@playliquid/game-ir";
import { computeDigest } from "@playliquid/package-system";
import { asTenantId, checkTenantIsolation } from "@playliquid/platform-contracts";
import type { TenantId } from "@playliquid/platform-contracts";
import { planSparkBoot } from "./boot-plan.ts";
import type { SparkBootPlan, SparkBootRejection, SparkCostModel } from "./boot-plan.ts";
import { scheduleSparkStreams } from "./stream-schedule.ts";
import type { SparkStreamSchedule } from "./stream-schedule.ts";
import { buildSparkCacheManifest } from "./cache.ts";
import type { SparkCacheManifest } from "./cache.ts";
import { executeSparkStreamBatch } from "./streaming.ts";
import type { SparkStreamSuccess } from "./streaming.ts";
import type { SparkClock, SparkCachePort, SparkContentSourcePort } from "./ports.ts";
import { sealSparkBootRecord, sparkFirstCommandDigestOf } from "./record.ts";
import type { SparkBootRecord } from "./record.ts";

/** Everything the runtime needs; every host concern is an injected port. */
export interface SparkRuntimeOptions<W extends JsonSafeValue> {
  readonly tenant: TenantId;
  readonly sessionId: string;
  readonly document: GameIRDocument;
  readonly profile: SparkTargetProfile;
  readonly costModel: SparkCostModel;
  /** Runtime policy reference (caller data; runtime-contracts vocabulary). */
  readonly policy: RuntimePolicyRef;
  readonly driver: WorldDriver<W>;
  readonly capabilityPort: CapabilityPort;
  readonly snapshotStore: SnapshotStorePort;
  readonly clock: SparkClock;
  readonly contentSource: SparkContentSourcePort;
  readonly cache: SparkCachePort;
  /** Optional cache byte budget (admission refuses overflows). */
  readonly cacheBudgetBytes?: number;
  /** Optional determinism seed handed to the kernel (E9). */
  readonly seed?: string;
}

/** Typed runtime refusal codes (kebab-case, E8). */
export type SparkRuntimeRefusalCode =
  | "invalid-tenant"
  | "cross-tenant"
  | "invalid-session"
  | "boot-refused"
  | "not-booted"
  | "already-booted"
  | "boot-record-immutable"
  | "stream-exhausted"
  | "source-refused"
  | "cache-refused"
  | "kernel-refused";

/** A typed runtime refusal. */
export interface SparkRuntimeRefusal<C = SparkRuntimeRefusalCode> {
  readonly ok: false;
  readonly code: C;
  readonly message: string;
  /** Aggregated planning rejections, when code is `boot-refused`. */
  readonly rejections?: readonly SparkBootRejection[];
}

/** Construction result. */
export type SparkRuntimeCreation<W extends JsonSafeValue> =
  | { readonly ok: true; readonly runtime: SparkRuntime<W> }
  | SparkRuntimeRefusal;

/** The lifecycle phase of the shell (kernel phases stay authoritative). */
export type SparkRuntimePhase = "created" | "booted" | "live";

/** The tenant-scoped read model of the shell. */
export interface SparkRuntimeView {
  /** Discriminator: a view (never a refusal). */
  readonly ok: true;
  readonly sessionId: string;
  readonly phase: SparkRuntimePhase;
  readonly planDigest: string;
  readonly scheduleDigest: string;
  readonly cacheManifestDigest: string;
  readonly criticalBytes: number;
  readonly plannedFirstPaintMs: number;
  readonly plannedFirstInteractionMs: number;
  readonly deferredUnitCount: number;
  readonly streamedBatchCount: number;
  readonly bootRecordDigest: string | null;
}

/** One streamed unit's outcome inside a batch execution (streaming.ts). */
export type { SparkStreamedUnitReport } from "./streaming.ts";

/** The runtime shell. Construct via {@link createSparkRuntime}. */
export class SparkRuntime<W extends JsonSafeValue> {
  readonly #tenant: TenantId;
  readonly #sessionId: string;
  readonly #plan: SparkBootPlan;
  readonly #schedule: SparkStreamSchedule;
  readonly #cacheManifest: SparkCacheManifest;
  readonly #kernel: InteractiveRuntimeKernel<W>;
  readonly #clock: SparkClock;
  readonly #contentSource: SparkContentSourcePort;
  readonly #cache: SparkCachePort;
  readonly #cacheBudgetBytes: number | undefined;
  #phase: SparkRuntimePhase = "created";
  #bootedAt = 0;
  #interactionReadyAt = 0;
  #bootRecord: SparkBootRecord | null = null;
  #streamedBatches = 0;

  /** Constructed by {@link createSparkRuntime} — the only door to a shell. */
  constructor(options: SparkRuntimeOptions<W>, plan: SparkBootPlan, schedule: SparkStreamSchedule, manifest: SparkCacheManifest, kernel: InteractiveRuntimeKernel<W>) {
    this.#tenant = options.tenant;
    this.#sessionId = options.sessionId;
    this.#plan = plan;
    this.#schedule = schedule;
    this.#cacheManifest = manifest;
    this.#kernel = kernel;
    this.#clock = options.clock;
    this.#contentSource = options.contentSource;
    this.#cache = options.cache;
    this.#cacheBudgetBytes = options.cacheBudgetBytes;
  }

  /** The tenant-scoped read model of the shell. */
  view(tenant: TenantId): SparkRuntimeView | SparkRuntimeRefusal {
    const guard = this.#guardTenant(tenant);
    if (guard !== undefined) return guard;
    return {
      ok: true,
      sessionId: this.#sessionId,
      phase: this.#phase,
      planDigest: this.#plan.planDigest,
      scheduleDigest: this.#schedule.scheduleDigest,
      cacheManifestDigest: this.#cacheManifest.manifestDigest,
      criticalBytes: this.#plan.budgets.criticalBytes,
      plannedFirstPaintMs: this.#plan.budgets.plannedFirstPaintMs,
      plannedFirstInteractionMs: this.#plan.budgets.plannedFirstInteractionMs,
      deferredUnitCount: this.#plan.deferredUnits.length,
      streamedBatchCount: this.#streamedBatches,
      bootRecordDigest: this.#bootRecord === null ? null : this.#bootRecord.recordDigest,
    };
  }

  /** The boot plan (read-only; planning is pure). */
  get plan(): SparkBootPlan {
    return this.#plan;
  }

  /** Applies the boot plan: loads the kernel and marks interaction-ready. */
  boot(tenant: TenantId):
    | { readonly ok: true; readonly bootedAt: number; readonly interactionReadyAt: number; readonly plannedFirstPaintMs: number; readonly plannedFirstInteractionMs: number }
    | SparkRuntimeRefusal {
    const guard = this.#guardTenant(tenant);
    if (guard !== undefined) return guard;
    if (this.#phase !== "created") {
      return { ok: false, code: "already-booted", message: `session ${this.#sessionId} already booted this runtime` };
    }
    const loaded = this.#kernel.load();
    if (loaded.status !== "loaded") {
      return {
        ok: false,
        code: "kernel-refused",
        message: `kernel load refused: ${loaded.status} (${loaded.detail})`,
      };
    }
    this.#bootedAt = this.#clock.now();
    this.#interactionReadyAt = this.#bootedAt;
    this.#phase = "booted";
    return {
      ok: true,
      bootedAt: this.#bootedAt,
      interactionReadyAt: this.#interactionReadyAt,
      plannedFirstPaintMs: this.#plan.budgets.plannedFirstPaintMs,
      plannedFirstInteractionMs: this.#plan.budgets.plannedFirstInteractionMs,
    };
  }

  /**
   * The ONE-TIME first-interaction ceremony: accepts the first command
   * through the kernel's canonical act path and seals the immutable boot
   * record (E10). A second call is a typed `boot-record-immutable`
   * refusal — use {@link interact} for ongoing commands.
   */
  firstInteraction(tenant: TenantId, input: ActInput):
    | { readonly ok: true; readonly act: ActResult; readonly bootRecord: SparkBootRecord }
    | SparkRuntimeRefusal {
    const guard = this.#guardTenant(tenant);
    if (guard !== undefined) return guard;
    if (this.#phase === "created") {
      return { ok: false, code: "not-booted", message: "boot the runtime before accepting interactions" };
    }
    if (this.#bootRecord !== null) {
      return {
        ok: false,
        code: "boot-record-immutable",
        message: `the boot record for session ${this.#sessionId} is sealed (E10); use interact() for ongoing commands`,
      };
    }
    const act = this.#kernel.act(input);
    if (act.status !== "committed") {
      return {
        ok: false,
        code: "kernel-refused",
        message: `first interaction was not committed: ${act.status} (${act.status === "rejected" || act.status === "failed" ? act.detail : String(act.status)})`,
      };
    }
    const firstInteractionAt = this.#clock.now();
    const record = sealSparkBootRecord({
      kind: "spark-boot-record",
      tenant: this.#tenant,
      sessionId: asSessionId(this.#sessionId),
      profileId: "spark",
      planDigest: this.#plan.planDigest,
      scheduleDigest: this.#schedule.scheduleDigest,
      cacheManifestDigest: this.#cacheManifest.manifestDigest,
      criticalBytes: this.#plan.budgets.criticalBytes,
      firstCommandDigest: sparkFirstCommandDigestOf({
        commandId: String(act.commandId),
        commandSeq: act.commandSeq,
        commandKind: String(input.intent.kind),
        actorId: String(input.intent.actor.actorId),
        intentId: String(input.intent.intentId),
      }),
      firstCommandKind: String(input.intent.kind),
      firstCommandSeq: act.commandSeq,
      bootOrdering: this.#plan.criticalUnits.map((unit) => unit.unitId),
      bootedAt: this.#bootedAt,
      interactionReadyAt: this.#interactionReadyAt,
      firstInteractionAt,
    });
    this.#bootRecord = record;
    this.#phase = "live";
    return { ok: true, act, bootRecord: record };
  }

  /** Ongoing commands through the kernel's canonical act path. */
  interact(tenant: TenantId, input: ActInput): ActResult | SparkRuntimeRefusal {
    const guard = this.#guardTenant(tenant);
    if (guard !== undefined) return guard;
    if (this.#phase === "created") {
      return { ok: false, code: "not-booted", message: "boot the runtime before accepting interactions" };
    }
    return this.#kernel.act(input);
  }

  /** The sealed boot record (E10 evidence), tenant-scoped. */
  bootRecordOf(tenant: TenantId): SparkBootRecord | SparkRuntimeRefusal {
    const guard = this.#guardTenant(tenant);
    if (guard !== undefined) return guard;
    if (this.#bootRecord === null) {
      return { ok: false, code: "not-booted", message: `no boot record yet for session ${this.#sessionId}` };
    }
    return this.#bootRecord;
  }

  /** Streams the NEXT schedule batch through the ports (E11 seams). */
  streamNextBatch(tenant: TenantId): SparkStreamSuccess | SparkRuntimeRefusal {
    const guard = this.#guardTenant(tenant);
    if (guard !== undefined) return guard;
    if (this.#phase === "created") {
      return { ok: false, code: "not-booted", message: "boot the runtime before streaming deferred content" };
    }
    const batch = this.#schedule.batches[this.#streamedBatches];
    if (batch === undefined) {
      return { ok: false, code: "stream-exhausted", message: "every deferred batch has already streamed" };
    }
    const executed = executeSparkStreamBatch(
      batch,
      this.#cacheManifest,
      this.#contentSource,
      this.#cache,
      this.#cacheBudgetBytes,
    );
    if (!executed.ok) {
      return executed;
    }
    this.#streamedBatches += 1;
    return executed;
  }

  #guardTenant(tenant: TenantId): SparkRuntimeRefusal | undefined {
    // House tenancy pattern (sensory-runtime): the platform-contracts
    // TenantId is validated through its own parser — administration of
    // tenants belongs to platform-identity, not this shell (R20).
    if (typeof tenant !== "string" || asTenantId(tenant) === undefined) {
      return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
    }
    const isolation = checkTenantIsolation({ tenant }, { tenant: this.#tenant });
    if (!isolation.ok) {
      return {
        ok: false,
        code: "cross-tenant",
        message: `runtime of session ${this.#sessionId} belongs to tenant ${String(this.#tenant)} (R20 tenant isolation)`,
      };
    }
    return undefined;
  }
}

/** Constructs the spark runtime: plans, then builds the kernel (guarded). */
export function createSparkRuntime<W extends JsonSafeValue>(options: SparkRuntimeOptions<W>): SparkRuntimeCreation<W> {
  if (typeof options?.tenant !== "string" || asTenantId(options.tenant) === undefined) {
    return { ok: false, code: "invalid-tenant", message: `tenant "${String(options?.tenant)}" is not a well-formed tenant id` };
  }
  if (typeof options?.sessionId !== "string" || options.sessionId.length === 0) {
    return { ok: false, code: "invalid-session", message: "sessionId must be a non-empty string" };
  }
  const plan = planSparkBoot(options.document, options.profile, options.costModel);
  if (!plan.ok) {
    return { ok: false, code: "boot-refused", message: "spark boot planning refused the inputs (E8)", rejections: plan.rejections };
  }
  const schedule = scheduleSparkStreams(plan.plan, options.profile);
  if (!schedule.ok) {
    return { ok: false, code: "boot-refused", message: `spark stream scheduling refused: ${schedule.code}` };
  }
  const manifest = buildSparkCacheManifest(plan.plan);
  if (!manifest.ok) {
    return { ok: false, code: "boot-refused", message: `spark cache manifest refused: ${manifest.code}` };
  }
  const gameDigestHex = computeDigest({ identity: options.document.identity, entry: options.document.entry }).slice("sha256:".length);
  const worldUnit = plan.plan.criticalUnits.find((unit) => unit.kind === "world");
  const descriptor = makeSessionDescriptor({
    sessionId: asSessionId(options.sessionId),
    game: {
      gameDigest: asGameIrDigest(gameDigestHex),
      world: {
        worldId: String(options.document.entry.world),
        revisionDigest: asDigest(worldUnit === undefined ? "0".repeat(64) : worldUnit.contentDigest.slice("sha256:".length)),
      },
      policy: options.policy,
    },
    role: "interactive",
    determinism: options.seed === undefined ? undefined : asDeterminismSeed(options.seed),
    targetProfile: asTargetProfileId("spark"),
    provisionedAt: asTimestamp(options.clock.now()),
  });
  const created = createInteractiveRuntime<W>({
    descriptor,
    driver: options.driver,
    capabilityPort: options.capabilityPort,
    snapshotStore: options.snapshotStore,
  });
  if (created.status !== "created") {
    return { ok: false, code: "kernel-refused", message: `kernel construction refused: ${created.detail}` };
  }
  return {
    ok: true,
    runtime: new SparkRuntime(options, plan.plan, schedule, manifest, created.kernel),
  };
}
