/**
 * THE SPARK BUILD DRIVER (PL-035) — drives the build-orchestrator's
 * staged pipeline for one spark build document and produces the TYPED
 * build result with content digests over the boot plan + stream schedule
 * + cache manifest.
 *
 * One authority per concern (E1/E2):
 * - composition/document digests: document.ts (pure);
 * - intake admission, phase arcs, terminal outputs and the append-only
 *   event log: the BuildOrchestratorService (PL-020) — this driver only
 *   drives and reads, it never re-implements a pipeline stage;
 * - tenancy (R20): the orchestrator's own doors enforce tenant scoping
 *   AND the driver refuses to run a document composed for another tenant;
 *   cross-tenant access is a typed refusal, never a silent cross-tenant
 *   build.
 *
 * Async/stateful discipline (spec/worker-contract.md):
 * - mutable state owner: the orchestrator service instance (build
 *   records, idempotency encounters, events);
 * - command admission: build-contracts' oracle, through
 *   `requestBuild(tenant, command)` — a duplicate idempotency key with a
 *   different payload is refused, never silently re-executed (E8);
 * - event order: per build, sequences 1, 2, 3, … append-only (E10);
 * - idempotency key: {scope, requester, nonce}, tenant-scoped by the
 *   orchestrator; replays return the recorded build id and this driver
 *   serves the recorded terminal truth (E6) instead of re-driving;
 * - stale-result rule: the driver re-reads status through the service
 *   after the drive loop (no cached state);
 * - replay/resume boundary: the orchestrator's content-addressed
 *   snapshot; this driver is stateless;
 * - retry/cancellation: cooperative, at arc boundaries, through the
 *   orchestrator's own cancel door (not duplicated here).
 *
 * Determinism (E9): the same document + orchestrator wiring produce the
 * same build id, the same build manifest digest and the same result
 * digest — every digest in the chain is content-derived, never random.
 */

import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { BuildId, BuildPhase } from "@playliquid/build-contracts";
import { BuildOrchestratorService } from "@playliquid/build-orchestrator";
import { isTenantId } from "@playliquid/build-orchestrator";
import type { TenantId } from "@playliquid/build-orchestrator";
import { sparkBuildRequestOf } from "./document.ts";
import type { SparkBuildDocument, SparkBuildRequestIdentity } from "./document.ts";

/** Why a spark build drive was refused (composition or pipeline refusal). */
export type SparkBuildDriveRefusalCode =
  | "invalid-tenant"
  | "cross-tenant"
  | "intake-refused"
  | "drive-refused"
  | "build-failed"
  | "read-refused"
  | "unexpected-state";

/** A typed spark build drive refusal. */
export interface SparkBuildDriveRefusal {
  readonly ok: false;
  readonly code: SparkBuildDriveRefusalCode;
  readonly message: string;
  /** The orchestrator's own refusal code, when one exists. */
  readonly source?: string;
}

/** The typed spark build result (E9 digests, E10 evidence trail). */
export interface SparkBuildResult {
  readonly ok: true;
  readonly kind: "spark-build-result";
  readonly tenant: TenantId;
  readonly buildId: BuildId;
  readonly target: "spark";
  /** `first` or `duplicate` (E6: a replayed idempotency key). */
  readonly classification: "first" | "duplicate";
  /** The phase after the drive loop — `succeeded` on the happy path. */
  readonly phase: BuildPhase;
  /** The orchestrator's build manifest digest (content-addressed outputs). */
  readonly buildManifestDigest: ContentDigest;
  /** The spark planning digests over the same game-ir content (E9). */
  readonly spark: SparkBuildDocument["spark"];
  /** Content digest over build id + manifest digest + spark payload. */
  readonly resultDigest: ContentDigest;
  /** Evidence-trail length: the build's append-only event count (E10). */
  readonly eventCount: number;
  /** The count of packaged artifacts in the terminal outputs. */
  readonly artifactCount: number;
}

/** A spark build drive: either a result or a typed refusal. */
export type SparkBuildOutcome = SparkBuildResult | SparkBuildDriveRefusal;

/** The maximum phase arcs one drive loop will advance (fail-closed bound). */
const MAX_DRIVE_ARCS = 12;

/**
 * Runs one spark build end to end: intake → resolve → plan → emit →
 * verify → package → succeeded (the frozen phase machine; the vendor gate
 * is `none` for spark, so no console evidence is ever required). Every
 * orchestrator refusal surfaces typed; a terminal failure surfaces as
 * `build-failed` with the orchestrator's own code (e.g. the truthful
 * E11 `toolchain-unavailable`).
 */
export async function runSparkBuild(
  tenant: TenantId,
  orchestrator: BuildOrchestratorService,
  document: SparkBuildDocument,
  identity: SparkBuildRequestIdentity,
): Promise<SparkBuildOutcome> {
  if (!isTenantId(tenant)) {
    return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
  }
  if (document.tenant !== tenant) {
    return {
      ok: false,
      code: "cross-tenant",
      message: `the spark build document was composed for tenant ${String(document.tenant)} and cannot run for tenant ${String(tenant)} (R20 tenant isolation)`,
    };
  }
  const request = sparkBuildRequestOf(document, identity);
  const intake = orchestrator.requestBuild(tenant, request);
  if (!intake.ok) {
    return {
      ok: false,
      code: "intake-refused",
      source: intake.code,
      message: `spark build intake refused: ${intake.code} — ${intake.message}`,
    };
  }
  const buildId = intake.buildId;
  const classification = intake.classification;
  for (let arc = 0; arc < MAX_DRIVE_ARCS; arc += 1) {
    const step = await orchestrator.drive(tenant, buildId);
    if (!step.ok) {
      if (step.code === "build-terminal") {
        // An idempotent replay of an already-terminal build: serve the
        // recorded truth below instead of re-driving (E6).
        break;
      }
      return { ok: false, code: "drive-refused", source: step.code, message: `spark build drive refused: ${step.code} — ${step.message}` };
    }
    if (step.terminal) {
      return assemble(tenant, orchestrator, document, buildId, classification, step.phase);
    }
  }
  return assemble(tenant, orchestrator, document, buildId, classification);
}

/** Reads the terminal state and assembles the typed result (pure reads). */
async function assemble(
  tenant: TenantId,
  orchestrator: BuildOrchestratorService,
  document: SparkBuildDocument,
  buildId: BuildId,
  classification: "first" | "duplicate",
  knownPhase?: BuildPhase,
): Promise<SparkBuildOutcome> {
  const status = orchestrator.status(tenant, buildId);
  if (!status.ok) {
    return { ok: false, code: "read-refused", source: status.code, message: `spark build status read refused: ${status.code} — ${status.message}` };
  }
  if (status.phase !== "succeeded" || status.outputs === undefined || status.manifestDigest === undefined) {
    const phase = status.phase ?? knownPhase ?? "unknown";
    if (phase === "failed") {
      return {
        ok: false,
        code: "build-failed",
        source: status.failure?.code ?? "unknown",
        message: `spark build failed${status.failure === undefined ? "" : `: ${status.failure.code} — ${status.failure.message}`}`,
      };
    }
    return {
      ok: false,
      code: "unexpected-state",
      message: `spark build ${buildId} is in phase "${phase}" without terminal outputs (internal invariant)`,
    };
  }
  const events = orchestrator.events(tenant, buildId);
  if (!events.ok) {
    return { ok: false, code: "read-refused", source: events.code, message: `spark build event log read refused: ${events.code} — ${events.message}` };
  }
  return {
    ok: true,
    kind: "spark-build-result",
    tenant,
    buildId,
    target: "spark",
    classification,
    phase: status.phase,
    buildManifestDigest: status.manifestDigest,
    spark: document.spark,
    resultDigest: sparkBuildResultDigestOf(buildId, status.manifestDigest, document.spark),
    eventCount: events.events.length,
    artifactCount: status.artifactCount,
  };
}

/** The result digest input: build id + manifest digest + spark payload. */
export function sparkBuildResultDigestOf(
  buildId: BuildId,
  buildManifestDigest: ContentDigest,
  spark: SparkBuildDocument["spark"],
): ContentDigest {
  return computeDigest({
    kind: "spark-build-result",
    buildId: String(buildId),
    buildManifestDigest,
    spark,
  });
}
