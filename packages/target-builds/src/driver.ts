/**
 * THE PER-TARGET STAGED-BUILD DRIVER (PL-036) — drives ONE bound target's
 * build-orchestrator document through its frozen phase machine, then
 * materializes the typed {@link TargetBuildResult} FROM THE
 * build-orchestrator's own content-addressed document (never re-derived).
 *
 * Contract with the service (which owns state):
 * - fresh drives submit the per-target request command (deterministic
 *   nonce ⇒ deterministic build id, E9) through the orchestrator's intake
 *   oracle; a typed intake refusal is an honest `admitted: false` result;
 * - resumed drives pass the EXISTING build id (the orchestrator was
 *   restored from its durable document; E6);
 * - the request's out-of-band evidence pool rides every drive (gated
 *   targets' vendor gates consume it; lock rule 24);
 * - a non-terminal `vendor-evidence-required` step is the RETRYABLE
 *   out-of-band wait: the driver stops and reports `awaitingEvidence`
 *   with the manifest digest the vendor pipeline must verify (E11) —
 *   never fabricated success;
 * - the result (phase, steps, artifacts, evidence, failure) is read from
 *   the verified snapshot document; the document digest pins it (E6/E10).
 */

import { asBuildId, computeBuildManifestDigest } from "@playliquid/build-contracts";
import type { BuildPhase, BuildRequestCommand, VerificationEvidence } from "@playliquid/build-contracts";
import { BuildOrchestratorService, verifySnapshot } from "@playliquid/build-orchestrator";
import type { StoredBuildSnapshot, TenantId } from "@playliquid/build-orchestrator";
import type { ContentDigest } from "@playliquid/package-system";
import type { TargetBuildResult } from "./outcomes.ts";

/** The arc budget of one drive (the frozen machine needs at most six; defensive). */
const MAX_ARCS_PER_DRIVE = 16;

/** The outcome of driving one target's staged build. */
export interface StagedDriveOutcome {
  readonly result: TargetBuildResult;
  /** The target's content-addressed build-orchestrator document (resume material). */
  readonly snapshot: StoredBuildSnapshot | null;
}

/**
 * The honest typed failure of one refused per-target restore (E6/E8): torn
 * durable state is NEVER healed and NEVER silently re-executed inside the
 * resuming run — the target reports a typed `restore-refused:*` failure over
 * the prior build's identity, and the NEXT run may re-execute fresh.
 */
export function restoreRefusedResult(
  prior: { readonly result: { readonly admitted: true; readonly buildId: string }; readonly snapshot: StoredBuildSnapshot },
  refusal: { readonly code: string; readonly message: string },
): StagedDriveOutcome {
  return {
    result: {
      admitted: true,
      phase: "failed",
      buildId: prior.result.buildId,
      documentDigest: prior.snapshot.snapshotId,
      manifestDigest: null,
      artifacts: [],
      stageDigests: [],
      evidence: [],
      failure: { code: `restore-refused:${refusal.code}`, message: refusal.message },
      awaitingEvidence: false,
    },
    snapshot: null,
  };
}

/** Reads the driven build's record out of the orchestrator's verified document. */
function materialize(
  orchestrator: BuildOrchestratorService,
  buildId: string,
  lastPhase: string,
  lastFailure: { readonly code: string; readonly message: string } | null,
  awaitingEvidence: boolean,
  stallManifestDigest: ContentDigest | null,
): StagedDriveOutcome {
  const snapshot = orchestrator.snapshot();
  const verification = verifySnapshot(snapshot);
  const record = verification.ok ? verification.document.builds.find((candidate) => candidate.buildId === buildId) ?? null : null;
  const result: TargetBuildResult = record === null
    ? {
        admitted: true,
        phase: lastPhase as BuildPhase,
        buildId,
        documentDigest: snapshot.snapshotId,
        manifestDigest: stallManifestDigest,
        artifacts: [],
        stageDigests: [],
        evidence: [],
        failure: lastFailure,
        awaitingEvidence,
      }
    : {
        admitted: true,
        phase: record.phase,
        buildId,
        documentDigest: snapshot.snapshotId,
        manifestDigest: record.outputs === null ? stallManifestDigest : computeBuildManifestDigest(record.outputs.manifest),
        artifacts: record.artifacts,
        stageDigests: record.steps.map((step) => ({ stage: step.stage, stageDigest: step.stageDigest })),
        evidence: record.evidence,
        failure: record.failure ?? (awaitingEvidence ? lastFailure : null),
        awaitingEvidence,
      };
  return { result, snapshot };
}

/**
 * Drives one target's staged build to a terminal phase, to the retryable
 * out-of-band vendor wait, or to an honest typed failure. Total; typed
 * results only; never throws.
 *
 * @param command the per-target request command, or null when resuming an
 *   existing build (`resumeBuildId` must then name it).
 */
export async function driveStagedBuild(
  orchestrator: BuildOrchestratorService,
  tenant: TenantId,
  command: BuildRequestCommand | null,
  resumeBuildId: string | null,
  evidence: readonly VerificationEvidence[],
): Promise<StagedDriveOutcome> {
  let buildId: string;
  if (command !== null) {
    const intake = orchestrator.requestBuild(tenant, command);
    if (!intake.ok) {
      return { result: { admitted: false, intakeRefusal: { code: intake.code, message: intake.message } }, snapshot: null };
    }
    buildId = intake.buildId;
  } else {
    if (resumeBuildId === null) {
      return {
        result: { admitted: false, intakeRefusal: { code: "invalid-command", message: "resume drive names no build id" } },
        snapshot: null,
      };
    }
    buildId = resumeBuildId;
  }
  const options = evidence.length > 0 ? { vendorEvidence: evidence } : undefined;
  let lastPhase = "queued";
  let lastFailure: { readonly code: string; readonly message: string } | null = null;
  let stallManifestDigest: ContentDigest | null = null;
  for (let arc = 0; arc < MAX_ARCS_PER_DRIVE; arc += 1) {
    const step = await orchestrator.drive(tenant, asBuildId(buildId), options);
    if (!step.ok) {
      return materialize(orchestrator, buildId, lastPhase, { code: `drive-${step.code}`, message: step.message }, false, null);
    }
    lastPhase = step.phase;
    if (step.terminal) {
      return materialize(orchestrator, buildId, step.phase, step.failure ?? null, false, null);
    }
    if (step.failure?.code === "vendor-evidence-required") {
      // The retryable out-of-band wait (lock rule 24): the on-target
      // verification of exactly `manifestDigest` is a vendor-pipeline
      // activity. Record it and stop — never fabricate the evidence.
      lastFailure = step.failure;
      stallManifestDigest = step.manifestDigest ?? null;
      return materialize(orchestrator, buildId, step.phase, step.failure, true, stallManifestDigest);
    }
    lastFailure = step.failure ?? lastFailure;
  }
  return materialize(orchestrator, buildId, lastPhase, { code: "arc-budget-exhausted", message: `drive reached no terminal phase within ${MAX_ARCS_PER_DRIVE} arcs` }, false, null);
}
