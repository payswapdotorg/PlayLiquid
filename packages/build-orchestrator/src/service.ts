/**
 * THE BUILD ORCHESTRATOR SERVICE (PL-020) — matrix row
 * `build-orchestrator | Build | build-contracts, tool-fabric-runtime`.
 *
 * The service instance is the single mutable-state owner (E1): build
 * records, tenant-scoped idempotency encounters, the append-only event log
 * and the recorded environment limitations. Every command and read names
 * its tenant; a command naming another tenant's build is a typed refusal
 * (R20). The domain is pure: the registry, the Tool Fabric runtime, time
 * and durable persistence live behind the injected ports (E3, E6).
 *
 * Async/stateful discipline (spec/worker-contract.md):
 * - command admission: build-contracts' `admitBuildRequest` is THE intake
 *   oracle; the intake engine (intake.ts) adds the taxonomy and
 *   duplicate-payload layers on top, all typed and fail-closed (E1, E8);
 * - event order: per build, sequences 1, 2, 3, … strictly increasing; the
 *   log only ever appends and is stamped with this service's authority
 *   (E10); every state mutation and its event(s) append together;
 * - idempotency key: {scope, requester, nonce}, scoped per tenant;
 *   replays return the recorded build id; the same key with a different
 *   payload is a collision refusal (E8);
 * - stale-result rule: `drive` advances exactly one phase arc (the arc
 *   engine lives in service-arcs.ts) and reports the phase after the
 *   step; a terminal build refuses further drives;
 * - replay/resume boundary: the content-addressed snapshot (E6); restore
 *   verifies the snapshot's content address, the append-only event
 *   discipline and durable-store agreement before any state is trusted.
 *
 * Vendor evidence policy (lock rule 24, R12, E11 — never fabricated):
 * console-class builds require the authorized vendor-SDK PASS record in
 * `DriveOptions` before ANY tool step executes — missing authorization
 * fails the build `vendor-evidence-required`. The on-target record that
 * verifies the exact manifest digest is an out-of-band vendor-pipeline
 * activity: until it arrives the package arc refuses RETRYABLY (the
 * build is not failed and stays drivable; the refusal names the manifest
 * digest to verify) and a truthful E11 limitation is recorded; success is
 * never simulated.
 */
import {
  admitCancelBuild,
  asBuildId,
  computeBuildManifestDigest,
  computeBuildRequestFingerprint,
  isTerminalBuildPhase,
} from "@playliquid/build-contracts";
import type {
  BuildExecutionCommand,
  BuildExecutionResult,
  BuildExecutor,
  BuildId,
  BuildPhase,
  BuildRequestCommand,
  CancelBuildCommand,
  ToolOperationId,
} from "@playliquid/build-contracts";
import { canonicalJson, computeDigest } from "@playliquid/package-system";
import { computeBuildPlan, planOperations } from "./plan.ts";
import type { BuildPlan } from "./plan.ts";
import { BUILD_ORCHESTRATOR_AUTHORITY, nextSequence } from "./events.ts";
import type { BuildEvent, BuildEventType } from "./events.ts";
import { snapshotOf, verifySnapshot } from "./document.ts";
import type {
  BuildOrchestratorDocument,
  BuildRecord,
  EnvironmentLimitation,
  StoredBuildSnapshot,
} from "./document.ts";
import type { BuildSourcePort, ServiceClock, ToolFabricPort } from "./ports.ts";
import type {
  BuildIntakeResult,
  BuildServiceRestoreResult,
  BuildStatusView,
  CancelResult,
  DriveOptions,
  DriveRefusal,
  DriveStepResult,
  EventLogView,
} from "./service-types.ts";
import type { BuildOrchestratorServiceOptions } from "./service-types.ts";
import { isVerificationEvidenceRecord } from "./stages.ts";
import { admitBuildToIntake } from "./intake.ts";
import { advanceOneArc } from "./service-arcs.ts";
import type { ArcHost } from "./service-arcs.ts";
import { asTenantId, isTenantId } from "./tenancy.ts";
import type { TenantId } from "./tenancy.ts";

/** The mutable state of one service instance (single owner: the instance). */
interface ServiceState {
  revision: number;
  builds: Map<string, BuildRecord>;
  encounters: Map<string, import("./document.ts").RecordedEncounter>;
  fingerprintIndex: Map<string, readonly string[]>;
  events: BuildEvent[];
  limitations: EnvironmentLimitation[];
}

/** The build orchestrator service: doors, state ownership, reads, restore. */
export class BuildOrchestratorService {
  private readonly sources: BuildSourcePort;
  private readonly fabric: ToolFabricPort;
  private readonly clock: ServiceClock;
  private readonly store: BuildOrchestratorServiceOptions["store"];
  private readonly host: ArcHost;
  private readonly state: ServiceState = {
    revision: 0,
    builds: new Map(),
    encounters: new Map(),
    fingerprintIndex: new Map(),
    events: [],
    limitations: [],
  };

  constructor(options: BuildOrchestratorServiceOptions) {
    this.sources = options.sources;
    this.fabric = options.fabric;
    this.clock = options.clock;
    this.store = options.store;
    this.host = {
      sources: this.sources,
      fabric: this.fabric,
      emit: (tenant, buildId, type, phase, detail) => this.emit(tenant, buildId, type, phase, detail),
      mutate: (buildId, patch) => this.mutate(buildId, patch),
      recordOf: (buildId) => this.recordOf(buildId),
      planOf: (record) => this.planOf(record),
      stepInputBase: (record) => this.stepInputBase(record),
      missingOperations: (plan) => this.missingOperations(plan),
      recordLimitation: (record, code, message, operation) => this.recordLimitation(record, code, message, operation),
    };
  }

  // ---------------------------------------------------------------------
  // Intake (E1)
  // ---------------------------------------------------------------------

  /** Admits one tenant-scoped build request; single-record, typed refusals. */
  requestBuild(tenant: TenantId, command: BuildRequestCommand): BuildIntakeResult {
    if (!isTenantId(tenant)) {
      return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
    }
    return admitBuildToIntake(
      {
        builds: this.state.builds,
        encounters: this.state.encounters,
        fingerprintIndex: this.state.fingerprintIndex,
        sources: this.sources,
        clock: this.clock,
        emit: (tenantId, buildId, type, phase, detail) => this.emit(tenantId, buildId, type, phase, detail),
        bumpRevision: () => {
          this.state.revision += 1;
        },
      },
      tenant,
      command,
    );
  }

  // ---------------------------------------------------------------------
  // Drive (E10 pipeline, one phase arc per call)
  // ---------------------------------------------------------------------

  /** Advances one build by exactly one phase arc; typed refusals, no partial arcs. */
  async drive(tenant: TenantId, buildId: BuildId, options?: DriveOptions): Promise<DriveStepResult | DriveRefusal> {
    if (!isTenantId(tenant)) {
      return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
    }
    const record = this.state.builds.get(buildId);
    if (record === undefined) {
      return { ok: false, code: "unknown-build", message: `build ${buildId} is not recorded` };
    }
    if (record.tenant !== tenant) {
      return { ok: false, code: "wrong-tenant", message: `build ${buildId} belongs to tenant ${record.tenant} (R20 tenant isolation)` };
    }
    if (isTerminalBuildPhase(record.phase)) {
      return { ok: false, code: "build-terminal", message: `build ${buildId} is in terminal phase "${record.phase}"` };
    }
    const evidence = options?.vendorEvidence;
    if (evidence !== undefined && !evidence.every((entry) => isVerificationEvidenceRecord(entry))) {
      return { ok: false, code: "invalid-evidence", message: "vendor evidence contains a structurally invalid record (fail closed, no state changed)" };
    }
    return advanceOneArc(this.host, record, options);
  }

  // ---------------------------------------------------------------------
  // Cancel, reads, snapshot/restore, executor view
  // ---------------------------------------------------------------------

  /** Cooperative cancellation at arc boundaries (build-contracts admission). */
  cancel(tenant: TenantId, command: CancelBuildCommand): CancelResult {
    if (!isTenantId(tenant)) {
      return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
    }
    const record = this.state.builds.get(command?.buildId);
    if (record === undefined) {
      return { ok: false, code: "unknown-build", message: `build ${String(command?.buildId)} is not recorded` };
    }
    if (record.tenant !== tenant) {
      return { ok: false, code: "wrong-tenant", message: `build ${record.buildId} belongs to tenant ${record.tenant} (R20 tenant isolation)` };
    }
    const admission = admitCancelBuild(command, { buildId: asBuildId(record.buildId), phase: record.phase, admittedAt: record.admittedAt });
    if (!admission.ok) {
      return { ok: false, code: admission.code, message: admission.message };
    }
    const from = record.phase;
    this.mutate(record.buildId, () => ({ phase: "cancelled" }));
    this.emit(tenant, record.buildId, "phase-transition", "cancelled", { from, to: "cancelled" });
    this.emit(tenant, record.buildId, "build-cancelled", "cancelled");
    return { ok: true, buildId: asBuildId(record.buildId), phase: "cancelled" };
  }

  /** The tenant-scoped read model of one build. */
  status(tenant: TenantId, buildId: BuildId): BuildStatusView | { ok: false; code: "invalid-tenant" | "unknown-build" | "wrong-tenant"; message: string } {
    if (!isTenantId(tenant)) {
      return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
    }
    const record = this.state.builds.get(buildId);
    if (record === undefined) {
      return { ok: false, code: "unknown-build", message: `build ${buildId} is not recorded` };
    }
    if (record.tenant !== tenant) {
      return { ok: false, code: "wrong-tenant", message: `build ${buildId} belongs to tenant ${record.tenant} (R20 tenant isolation)` };
    }
    const manifestDigest = record.outputs === null ? undefined : computeBuildManifestDigest(record.outputs.manifest);
    return {
      ok: true,
      buildId: asBuildId(record.buildId),
      tenant: asTenantId(record.tenant),
      phase: record.phase,
      admittedAt: record.admittedAt,
      target: record.request.inputs.targetProfile.target,
      requester: record.requester,
      ...(record.failure === null ? {} : { failure: record.failure }),
      ...(manifestDigest === undefined ? {} : { manifestDigest }),
      ...(record.outputs === null ? {} : { outputs: record.outputs }),
      artifactCount: record.artifacts.length,
      stepCount: record.steps.length,
    };
  }

  /** The tenant-scoped, append-only event log of one build (E10 audit). */
  events(tenant: TenantId, buildId: BuildId): EventLogView {
    if (!isTenantId(tenant)) {
      return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
    }
    const record = this.state.builds.get(buildId);
    if (record === undefined) {
      return { ok: false, code: "unknown-build", message: `build ${buildId} is not recorded` };
    }
    if (record.tenant !== tenant) {
      return { ok: false, code: "wrong-tenant", message: `build ${buildId} belongs to tenant ${record.tenant} (R20 tenant isolation)` };
    }
    return { ok: true, events: this.state.events.filter((event) => event.buildId === buildId).map((event) => event) };
  }

  /** The tenant-scoped recorded environment limitations (E11 truth). */
  limitations(tenant: TenantId): readonly EnvironmentLimitation[] {
    if (!isTenantId(tenant)) {
      return [];
    }
    return this.state.limitations.filter((limitation) => limitation.tenant === tenant);
  }

  /** The content-addressed snapshot of the full state (E6 resume boundary). */
  snapshot(): StoredBuildSnapshot {
    return snapshotOf(this.documentOf());
  }

  /**
   * Restores a service from a stored snapshot. Fail-closed order: snapshot
   * verification (parse → structure → content address → append-only
   * discipline) → durable-store agreement (the store's log must equal the
   * snapshot's events; divergence is torn state and is refused, E8/E10).
   */
  static restore(snapshot: StoredBuildSnapshot, options: BuildOrchestratorServiceOptions): BuildServiceRestoreResult {
    const verification = verifySnapshot(snapshot);
    if (!verification.ok) {
      return { ok: false, code: verification.code, message: verification.message };
    }
    const document = verification.document;
    const stored = options.store.loadEvents();
    // Value equality by canonical serialization, never object identity: the
    // snapshot's events are freshly parsed from its JSON document, so `!==`
    // would flag every honest restore as divergence. Canonical JSON makes
    // the agreement check content-addressed (same discipline as the digest).
    const storedEqual = stored.length === document.events.length
      && stored.every((event, index) => {
        try {
          return canonicalJson(event) === canonicalJson(document.events[index]);
        } catch {
          return false;
        }
      });
    if (!storedEqual) {
      return { ok: false, code: "store-divergence", message: `the durable event store holds ${stored.length} event(s) but the snapshot records ${document.events.length}; refusing torn state (E6/E8)` };
    }
    const service = new BuildOrchestratorService(options);
    service.seed(document);
    return { ok: true, service };
  }

  /** Serves build-contracts' BuildExecutor port from recorded, immutable build truth. */
  asBuildExecutor(): BuildExecutor {
    return {
      execute: (command: BuildExecutionCommand): BuildExecutionResult => {
        const buildId = command?.request?.buildId;
        const record = this.state.builds.get(buildId);
        if (record === undefined) {
          return { ok: false, code: "invalid-command", message: `build ${String(buildId)} is not recorded by this orchestrator` };
        }
        const fingerprint = computeBuildRequestFingerprint(command.request.request);
        if (fingerprint !== record.fingerprint) {
          return { ok: false, code: "invalid-command", message: "execution command does not name the recorded request payload for this build id" };
        }
        if (record.phase !== "succeeded" || record.outputs === null) {
          const code = record.failure?.code === "vendor-evidence-required" ? "vendor-evidence-required" : "invalid-command";
          return { ok: false, code, message: `build ${record.buildId} is in phase "${record.phase}" — the executor serves recorded truth of SUCCEEDED builds only (E6; drive the build first)` };
        }
        return { ok: true, outputs: record.outputs };
      },
    };
  }

  // ---------------------------------------------------------------------
  // Internals (the single-owner mutation engine)
  // ---------------------------------------------------------------------

  private seed(document: BuildOrchestratorDocument): void {
    this.state.revision = document.revision;
    for (const build of document.builds) {
      this.state.builds.set(build.buildId, build);
      this.state.encounters.set(
        `${build.tenant}|${build.request.idempotency.scope}|${build.request.idempotency.requester}|${build.request.idempotency.nonce}`,
        {
          key: `${build.tenant}|${build.request.idempotency.scope}|${build.request.idempotency.requester}|${build.request.idempotency.nonce}`,
          tenant: build.tenant,
          scope: build.request.idempotency.scope,
          requester: build.request.idempotency.requester,
          nonce: build.request.idempotency.nonce,
          fingerprint: build.fingerprint,
          buildId: build.buildId,
        },
      );
      this.state.fingerprintIndex.set(`${build.tenant}|${build.fingerprint}`, [
        ...(this.state.fingerprintIndex.get(`${build.tenant}|${build.fingerprint}`) ?? []),
        build.buildId,
      ]);
    }
    this.state.events = [...document.events];
    this.state.limitations = [...document.limitations];
  }

  private documentOf(): BuildOrchestratorDocument {
    const tenants = new Set<string>();
    for (const build of this.state.builds.values()) {
      tenants.add(build.tenant);
    }
    return {
      revision: this.state.revision,
      tenants: [...tenants].sort(),
      encounters: [...this.state.encounters.values()],
      builds: [...this.state.builds.values()],
      events: [...this.state.events],
      limitations: [...this.state.limitations],
    };
  }

  private emit(tenant: string, buildId: string, type: BuildEventType, phase: BuildPhase, detail?: unknown): BuildEvent {
    const event: BuildEvent = {
      kind: "build-orchestrator-event",
      authority: BUILD_ORCHESTRATOR_AUTHORITY,
      tenant: asTenantId(tenant),
      buildId,
      sequence: nextSequence(this.state.events, buildId),
      at: this.clock.now(),
      type,
      phase,
      ...(detail === undefined ? {} : { detail }),
    };
    this.state.events.push(event);
    this.state.revision += 1;
    this.store.appendEvents([event]);
    return event;
  }

  private mutate(buildId: string, patch: (current: BuildRecord) => Partial<BuildRecord>): void {
    const current = this.state.builds.get(buildId);
    if (current === undefined) {
      return;
    }
    this.state.builds.set(buildId, { ...current, ...patch(current) });
    this.state.revision += 1;
  }

  private recordOf(buildId: string): BuildRecord {
    const record = this.state.builds.get(buildId);
    if (record === undefined) {
      throw new Error(`internal invariant: build ${buildId} disappeared mid-arc`);
    }
    return record;
  }

  private planOf(record: BuildRecord): BuildPlan {
    return computeBuildPlan(asBuildId(record.buildId), record.request.inputs.targetProfile.target, record.request.inputs.toolchain.citesToolOperations);
  }

  private stepInputBase(record: BuildRecord): Record<string, unknown> {
    return {
      buildId: record.buildId,
      tenant: record.tenant,
      target: record.request.inputs.targetProfile.target,
      inputsDigest: record.inputsDigest,
    };
  }

  private missingOperations(plan: BuildPlan): readonly ToolOperationId[] {
    const available = new Set<string>(this.fabric.availableOperations());
    return planOperations(plan).filter((operation) => !available.has(operation));
  }

  private recordLimitation(record: BuildRecord, code: string, message: string, operation?: string): void {
    const at = this.clock.now();
    const limitation: EnvironmentLimitation = {
      limitationId: `lim-${computeDigest({ tenant: record.tenant, at, code, message }).slice("sha256:".length, "sha256:".length + 16)}`,
      at,
      tenant: record.tenant,
      buildId: record.buildId,
      target: record.request.inputs.targetProfile.target,
      ...(operation === undefined ? {} : { operation }),
      code,
      message,
    };
    this.state.limitations.push(limitation);
    this.state.revision += 1;
    this.emit(record.tenant, record.buildId, "limitation-recorded", this.state.builds.get(record.buildId)?.phase ?? record.phase, { limitationId: limitation.limitationId, code, message });
  }
}
