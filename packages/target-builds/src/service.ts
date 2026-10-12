/**
 * THE MULTI-TARGET BUILD SERVICE (PL-036) — the single mutable-state owner
 * of the multi-target surface: request encounters (idempotency), durable
 * fan-out plans, per-target durable outcomes and the aggregated records.
 * The state document + snapshot/restore verification live in snapshot.ts.
 *
 * Async/stateful discipline (spec/worker-contract.md):
 * - command admission: {@link execute} validates the request structurally
 *   (typed `invalid-request`), then keys the tenant-scoped idempotency
 *   encounter `{tenant, requester, nonce}` — a replay returns the
 *   RECORDED record; the same key with different content is a typed
 *   `idempotency-collision` (E8, never silently executed twice);
 * - idempotency by content key: the durable plan's `planId` is a pure
 *   function of the request CONTENT (pins + canonical targets +
 *   parameters) and the resolution. A re-run with a fresh nonce and
 *   identical content resumes the SAME plan: already-SUCCEEDED targets
 *   are skipped (typed skip outcome), non-terminal targets are restored
 *   from their content-addressed build-orchestrator documents and
 *   re-driven with the (possibly strengthened) evidence pool (E6);
 * - event order: per-target staged builds append through the
 *   build-orchestrator's own append-only event log (the E10 authority);
 *   this service's state document is itself content-addressed;
 * - replay/resume boundary: {@link snapshot} / static {@link restore} —
 *   restore verifies the snapshot's content address before any state is
 *   trusted; per-target restores additionally verify the durable event
 *   store's agreement (torn state is refused, E8/E10);
 * - tenant isolation (R20): every door names its tenant; cross-tenant
 *   reads are typed refusals.
 */

import type { ContentDigest } from "@playliquid/package-system";
import { BuildOrchestratorService, isTenantId } from "@playliquid/build-orchestrator";
import type { BuildOrchestratorServiceOptions, TenantId } from "@playliquid/build-orchestrator";
import type { BuildRequestCommand, VerificationEvidence } from "@playliquid/build-contracts";
import type { MultiTargetBuildRequest, RequestViolation } from "./request.ts";
import { computeMultiTargetRequestFingerprint, multiTargetEncounterKey, validateMultiTargetBuildRequest } from "./request.ts";
import type { TargetOutcome, DurableTargetOutcome } from "./outcomes.ts";
import { computeVerdict, outcomeOfResult, skipOutcomeOf } from "./outcomes.ts";
import { resolveTargetSet } from "./resolution.ts";
import type { TargetBinding } from "./resolution.ts";
import { buildTargetRequestCommand, computeFanoutPlan, planTargetKey } from "./plan.ts";
import type { FanoutPlanEntry, MultiTargetFanoutPlan } from "./plan.ts";
import { driveStagedBuild, restoreRefusedResult } from "./driver.ts";
import { aggregateProvenance, aggregateVerification, sourcePinsOf } from "./evidence.ts";
import type { TargetProvenanceEvidence, TargetVerificationEvidence } from "./evidence.ts";
import { mintRecordId, sealMultiTargetRecord } from "./record.ts";
import type { MultiTargetBuildRecord } from "./record.ts";
import type { MultiTargetBuildServiceOptions } from "./ports.ts";
import { effectiveCatalog } from "./ports.ts";
import type { EngineCatalog } from "./catalog.ts";
import type { MultiTargetBuildsDocument, MultiTargetBuildsSnapshot, RecordedRequestEncounter } from "./snapshot.ts";
import { snapshotOfDocument, verifyMultiTargetSnapshot } from "./snapshot.ts";

/** The typed refusal of {@link MultiTargetBuildService.execute}. */
export interface MultiTargetExecutionRefusal {
  readonly ok: false;
  readonly code: "invalid-tenant" | "invalid-request" | "idempotency-collision";
  readonly message: string;
  /** Per-field reasons, when the code is `invalid-request`. */
  readonly reasons?: readonly RequestViolation[];
}

/** The result of one multi-target execution (first run, resume, or idempotent replay). */
export type MultiTargetExecutionResult =
  | { readonly ok: true; readonly classification: "first"; readonly record: MultiTargetBuildRecord }
  | { readonly ok: true; readonly classification: "resumed"; readonly record: MultiTargetBuildRecord }
  | { readonly ok: true; readonly classification: "replay"; readonly record: MultiTargetBuildRecord }
  | MultiTargetExecutionRefusal;

/** The result of restoring a service (E6). */
export type MultiTargetRestoreResult =
  | { readonly ok: true; readonly service: MultiTargetBuildService }
  | { readonly ok: false; readonly code: "snapshot-malformed" | "snapshot-digest-mismatch"; readonly message: string };

/** The mutable state of one service instance (single owner: the instance). */
interface ServiceState {
  revision: number;
  encounters: Map<string, RecordedRequestEncounter>;
  plans: Map<string, MultiTargetFanoutPlan>;
  outcomes: Map<string, DurableTargetOutcome>;
  records: Map<string, MultiTargetBuildRecord>;
}

/** The multi-target build service: doors, state ownership, reads, resume, restore. */
export class MultiTargetBuildService {
  private readonly catalog: EngineCatalog;
  private readonly options: MultiTargetBuildServiceOptions;
  private readonly state: ServiceState = {
    revision: 0,
    encounters: new Map(),
    plans: new Map(),
    outcomes: new Map(),
    records: new Map(),
  };

  constructor(options: MultiTargetBuildServiceOptions) {
    this.options = options;
    this.catalog = effectiveCatalog(options.catalog);
  }

  // ------------------------------------------------------------------
  // Execute (admission → resolution → fan-out → aggregation)
  // ------------------------------------------------------------------

  /** Executes one tenant-scoped multi-target build request (first run, resume or replay). */
  async execute(tenant: TenantId, request: MultiTargetBuildRequest): Promise<MultiTargetExecutionResult> {
    if (!isTenantId(tenant)) {
      return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
    }
    const validation = validateMultiTargetBuildRequest(request);
    if (!validation.ok) {
      return { ok: false, code: "invalid-request", message: "multi-target build request is structurally invalid (fail closed)", reasons: validation.reasons };
    }
    const fingerprint = computeMultiTargetRequestFingerprint(request);
    const encounterKey = multiTargetEncounterKey(tenant, request);
    const recorded = this.state.encounters.get(encounterKey) ?? null;
    if (recorded !== null) {
      if (recorded.requestFingerprint !== fingerprint) {
        return { ok: false, code: "idempotency-collision", message: "idempotency key was already used with different content; refusing (never silently executed twice, E8)" };
      }
      const replayed = this.state.records.get(recorded.recordId);
      if (replayed === undefined) {
        return { ok: false, code: "idempotency-collision", message: "recorded encounter names a record this service no longer holds (torn state, E8)" };
      }
      return { ok: true, classification: "replay", record: replayed };
    }

    // Resolution + plan (total; typed refusals accumulate, E8/E9).
    const resolution = resolveTargetSet(request, this.catalog, this.options.profiles);
    const plan = computeFanoutPlan(tenant, request, fingerprint, resolution);
    if (!this.state.plans.has(plan.planId)) {
      this.state.plans.set(plan.planId, plan);
      this.state.revision += 1;
    }
    const recordId = mintRecordId(tenant, plan.planId, request.requester, request.nonce);
    const evidence = request.evidence ?? [];
    const outcomes: TargetOutcome[] = [];
    const provenance: TargetProvenanceEvidence[] = [];
    const verification: TargetVerificationEvidence[] = [];
    let resumed = false;

    const entryByTarget = new Map<string, FanoutPlanEntry>(plan.entries.map((entry) => [entry.target, entry]));
    for (const binding of resolution.bindings) {
      const entry = entryByTarget.get(binding.target);
      if (entry === undefined) {
        continue;
      }
      const planKey = planTargetKey(plan.planId, binding.target);
      const prior = this.state.outcomes.get(planKey) ?? null;
      const pins = sourcePinsOf(request.pins, binding.profile.profileDigest);
      if (prior !== null && prior.result.admitted && prior.result.phase === "succeeded") {
        // E6 resume: this target already completed under the same content
        // key — skip it (typed skip; no re-execution, no re-admission).
        resumed = true;
        outcomes.push(skipOutcomeOf(prior));
        provenance.push(aggregateProvenance(prior.target, prior.engineId, entry.bindingDigest, pins, prior.result));
        verification.push(aggregateVerification(prior.target, prior.result));
        continue;
      }
      const driven = await this.driveOneTarget(tenant, request, binding, plan, recordId, evidence);
      outcomes.push(driven.outcome);
      provenance.push(driven.provenance);
      verification.push(driven.verification);
      if (driven.resumedDrive || driven.outcome.outcome === "awaiting-evidence") {
        resumed = true;
      }
    }

    const record = sealMultiTargetRecord({
      kind: "multi-target-build-record",
      recordId,
      tenant,
      requester: request.requester,
      planId: plan.planId,
      requestFingerprint: fingerprint,
      verdict: computeVerdict(outcomes, plan.refusals.length),
      outcomes,
      refusals: plan.refusals,
      provenance,
      verification,
      completedAt: this.options.clock.now(),
    });
    this.state.revision += 1;
    this.state.records.set(recordId, record);
    this.state.encounters.set(encounterKey, {
      key: encounterKey,
      tenant,
      requester: request.requester,
      nonce: request.nonce,
      requestFingerprint: fingerprint,
      recordId,
    });
    return { ok: true, classification: resumed ? "resumed" : "first", record };
  }
  // ------------------------------------------------------------------
  // Reads (tenant-scoped, R20)
  // ------------------------------------------------------------------

  /** The tenant-scoped read of one multi-target build record. */
  recordOf(tenant: TenantId, recordId: string): { readonly ok: true; readonly record: MultiTargetBuildRecord } | { readonly ok: false; readonly code: "invalid-tenant" | "unknown-record" | "wrong-tenant"; readonly message: string } {
    if (!isTenantId(tenant)) {
      return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
    }
    const record = this.state.records.get(recordId);
    if (record === undefined) {
      return { ok: false, code: "unknown-record", message: `multi-target record ${recordId} is not recorded` };
    }
    if (record.tenant !== tenant) {
      return { ok: false, code: "wrong-tenant", message: `record ${recordId} belongs to tenant ${record.tenant} (R20 tenant isolation)` };
    }
    return { ok: true, record };
  }

  /** The tenant-scoped read of one durable fan-out plan (E6). */
  planOf(tenant: TenantId, planId: ContentDigest): { readonly ok: true; readonly plan: MultiTargetFanoutPlan } | { readonly ok: false; readonly code: "invalid-tenant" | "unknown-plan" | "wrong-tenant"; readonly message: string } {
    if (!isTenantId(tenant)) {
      return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
    }
    const plan = this.state.plans.get(planId);
    if (plan === undefined) {
      return { ok: false, code: "unknown-plan", message: `fan-out plan ${planId} is not recorded` };
    }
    if (plan.tenant !== tenant) {
      return { ok: false, code: "wrong-tenant", message: `fan-out plan ${planId} belongs to tenant ${plan.tenant} (R20 tenant isolation)` };
    }
    return { ok: true, plan };
  }

  /** The tenant-scoped durable outcomes recorded under one plan (E6 resume view). */
  durableOutcomesOf(tenant: TenantId, planId: ContentDigest): readonly DurableTargetOutcome[] {
    if (!isTenantId(tenant)) {
      return [];
    }
    const plan = this.state.plans.get(planId);
    if (plan === undefined || plan.tenant !== tenant) {
      return [];
    }
    return [...this.state.outcomes.values()].filter((outcome) => outcome.planKey.startsWith(`${planId}|`));
  }

  // ------------------------------------------------------------------
  // Snapshot / restore (E6)
  // ------------------------------------------------------------------

  /** The content-addressed snapshot of the full state (E6 resume boundary). */
  snapshot(): MultiTargetBuildsSnapshot {
    return snapshotOfDocument(this.documentOf());
  }

  /** Restores a service from a stored snapshot (fail-closed; torn state refused, E8). */
  static restore(snapshot: MultiTargetBuildsSnapshot, options: MultiTargetBuildServiceOptions): MultiTargetRestoreResult {
    const verification = verifyMultiTargetSnapshot(snapshot);
    if (!verification.ok) {
      return { ok: false, code: verification.code, message: verification.message };
    }
    const service = new MultiTargetBuildService(options);
    service.seed(verification.document);
    return { ok: true, service };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Drives (or restores-and-resumes) one bound target; records the durable outcome (E6). */
  private async driveOneTarget(
    tenant: TenantId,
    request: MultiTargetBuildRequest,
    binding: TargetBinding,
    plan: MultiTargetFanoutPlan,
    recordId: string,
    evidence: readonly VerificationEvidence[],
  ): Promise<{ readonly outcome: TargetOutcome; readonly provenance: TargetProvenanceEvidence; readonly verification: TargetVerificationEvidence; readonly resumedDrive: boolean }> {
    const planKey = planTargetKey(plan.planId, binding.target);
    const prior = this.state.outcomes.get(planKey) ?? null;
    const restorable = prior !== null
      && prior.result.admitted
      && prior.result.phase !== "succeeded"
      && prior.result.phase !== "failed"
      && prior.result.phase !== "cancelled"
      && prior.snapshot !== null;
    const storeKey = restorable && prior !== null ? prior.storeKey : `${recordId}#${binding.target}`;
    const orchestratorOptions: BuildOrchestratorServiceOptions = {
      sources: this.options.sources,
      fabric: this.options.fabric,
      clock: this.options.clock,
      store: this.options.stores.open(storeKey),
    };
    let orchestrator: BuildOrchestratorService | null = null;
    let command: BuildRequestCommand | null = null;
    let resumeBuildId: string | null = null;
    let resumedDrive = false;
    let driven: Awaited<ReturnType<typeof driveStagedBuild>>;
    if (restorable && prior !== null && prior.snapshot !== null && prior.result.admitted) {
      const restored = BuildOrchestratorService.restore(prior.snapshot, orchestratorOptions);
      if (restored.ok) {
        orchestrator = restored.service;
        resumeBuildId = prior.result.buildId;
        resumedDrive = true;
      } else {
        // Torn durable state is never healed inside the resuming run (E8):
        // the target records an honest typed failure naming the refusal; a
        // LATER run (fresh encounter) may re-execute from scratch.
        const admittedPrior = prior;
        const admittedResult = admittedPrior.result;
        const admittedSnapshot = admittedPrior.snapshot;
        if (admittedResult.admitted && admittedSnapshot !== null) {
          driven = restoreRefusedResult({ result: admittedResult, snapshot: admittedSnapshot }, restored);
        } else {
          driven = { result: { admitted: false, intakeRefusal: { code: `restore-refused:${restored.code}`, message: restored.message } }, snapshot: null };
        }
        this.recordDurableOutcome(planKey, storeKey, recordId, binding, driven);
        return {
          outcome: outcomeOfResult(binding.target, binding.engineId, driven.result),
          provenance: aggregateProvenance(binding.target, binding.engineId, binding.binding.bindingDigest, sourcePinsOf(request.pins, binding.profile.profileDigest), driven.result),
          verification: aggregateVerification(binding.target, driven.result),
          resumedDrive,
        };
      }
    }
    if (orchestrator === null) {
      orchestrator = new BuildOrchestratorService(orchestratorOptions);
      command = buildTargetRequestCommand(request, binding);
    }
    driven = await driveStagedBuild(orchestrator, tenant, command, resumeBuildId, evidence);
    this.recordDurableOutcome(planKey, storeKey, recordId, binding, driven);
    return {
      outcome: outcomeOfResult(binding.target, binding.engineId, driven.result),
      provenance: aggregateProvenance(binding.target, binding.engineId, binding.binding.bindingDigest, sourcePinsOf(request.pins, binding.profile.profileDigest), driven.result),
      verification: aggregateVerification(binding.target, driven.result),
      resumedDrive,
    };
  }

  /** Persists one driven target's durable outcome under its plan-scoped key (E6). */
  private recordDurableOutcome(
    planKey: string,
    storeKey: string,
    recordId: string,
    binding: TargetBinding,
    driven: Awaited<ReturnType<typeof driveStagedBuild>>,
  ): void {
    this.state.outcomes.set(planKey, {
      kind: "durable-target-outcome",
      planKey,
      storeKey,
      originRecordId: recordId,
      target: binding.target,
      engineId: binding.engineId,
      result: driven.result,
      snapshot: driven.snapshot,
      recordedAt: this.options.clock.now(),
    });
    this.state.revision += 1;
  }

  private documentOf(): MultiTargetBuildsDocument {
    const tenants = new Set<string>();
    for (const record of this.state.records.values()) {
      tenants.add(record.tenant);
    }
    for (const plan of this.state.plans.values()) {
      tenants.add(plan.tenant);
    }
    return {
      revision: this.state.revision,
      tenants: [...tenants].sort(),
      encounters: [...this.state.encounters.values()],
      plans: [...this.state.plans.values()],
      outcomes: [...this.state.outcomes.values()],
      records: [...this.state.records.values()],
    };
  }

  private seed(document: MultiTargetBuildsDocument): void {
    this.state.revision = document.revision;
    for (const encounter of document.encounters) {
      this.state.encounters.set(encounter.key, encounter);
    }
    for (const plan of document.plans) {
      this.state.plans.set(plan.planId, plan);
    }
    for (const outcome of document.outcomes) {
      this.state.outcomes.set(outcome.planKey, outcome);
    }
    for (const record of document.records) {
      this.state.records.set(record.recordId, record);
    }
  }
}
