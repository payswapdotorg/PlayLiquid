/**
 * BUILD INTAKE (E1) — the admission machinery of the build orchestrator
 * service, extracted from service.ts (max-lines discipline; the house
 * apply.ts precedent). This module owns NOTHING durably: it is handed the
 * service instance's state maps and ports, mutates them under the
 * single-record discipline (state mutation and its event append together),
 * and answers with build-contracts' typed results.
 *
 * Admission order (fail-closed, one authority per layer):
 * 1. total pre-guard: a NON-OBJECT command is refused `invalid-command`
 *    here (build-contracts' oracle dereferences the command shape, so this
 *    layer answers for shape-first totality, E1);
 * 2. build-contracts' `admitBuildRequest` is THE intake oracle: structural
 *    validity → idempotency encounter (replay = duplicate; same key with a
 *    different payload = collision refusal, E8) → input-digest
 *    resolvability (unresolvable inputs are named, never guessed) →
 *    target/engine compatibility;
 * 3. this layer re-ranks the oracle's compatibility-family refusals into
 *    the house's frozen order — the R12 target taxonomy FIRST
 *    (`unknown-target`), the engine binding SECOND
 *    (`target-engine-incompatible`), resolvability after both — and adds
 *    the duplicate-payload layer: an identical fingerprint already in
 *    flight or succeeded is refused `duplicate-payload` naming the existing
 *    build (E9 determinism makes re-execution waste); failed/cancelled
 *    builds are retryable with a fresh nonce;
 * 4. the accepted command is pinned verbatim into the build record (the
 *    deterministic re-drive material) and the first encounter is recorded.
 */

import {
  admitBuildRequest,
  asBuildId,
  buildInputDigests,
  computeBuildInputsDigest,
  requestTarget,
} from "@playliquid/build-contracts";
import type {
  BuildIdempotencyKey,
  BuildPhase,
  BuildRequestCommand,
  BuildRequestEncounter,
} from "@playliquid/build-contracts";
import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import { isTargetId } from "@playliquid/target-profiles";
import type { BuildEvent, BuildEventType } from "./events.ts";
import type { BuildRecord, RecordedEncounter } from "./document.ts";
import type { BuildSourcePort, ServiceClock } from "./ports.ts";
import type { BuildIntakeResult } from "./service-types.ts";
import { tenantEncounterKey } from "./tenancy.ts";
import type { TenantId } from "./tenancy.ts";

/**
 * The state and ports the intake operates on (all owned by the service
 * instance — the single mutable-state owner; this module is its engine).
 */
export interface BuildIntakeDeps {
  /** Build records by build id (mutated by admission). */
  readonly builds: Map<string, BuildRecord>;
  /** First encounters by tenant-scoped idempotency key (E6). */
  readonly encounters: Map<string, RecordedEncounter>;
  /** Tenant+fingerprint → build ids (duplicate-payload lookup). */
  readonly fingerprintIndex: Map<string, readonly string[]>;
  /** The registry/CAS read seam (input-digest resolvability). */
  readonly sources: BuildSourcePort;
  /** The only time source (E3). */
  readonly clock: ServiceClock;
  /** Appends an event through the owning service (mutation + event together). */
  readonly emit: (tenant: string, buildId: string, type: BuildEventType, phase: BuildPhase, detail?: unknown) => BuildEvent;
  /** Bumps the state revision once per state mutation. */
  readonly bumpRevision: () => void;
}

/**
 * Admits one tenant-scoped build request into the given state (the body of
 * `BuildOrchestratorService.requestBuild`). Typed refusals only; the
 * tenant is pre-validated by the caller.
 */
export function admitBuildToIntake(
  deps: BuildIntakeDeps,
  tenant: TenantId,
  command: BuildRequestCommand,
): BuildIntakeResult {
  // Layer 1 — total pre-guard: the oracle dereferences the command, so a
  // non-object candidate gets its `invalid-command` verdict here (E1).
  if (typeof command !== "object" || command === null) {
    return {
      ok: false,
      code: "invalid-command",
      message: "command must be a request-build object (kind, idempotency, inputs, parameters, requestedAt)",
    };
  }
  const idempotency = command?.idempotency;
  const encounterKey = tenantEncounterKey(
    tenant,
    typeof idempotency?.scope === "string" ? idempotency.scope : "",
    typeof idempotency?.requester === "string" ? idempotency.requester : "",
    typeof idempotency?.nonce === "string" ? idempotency.nonce : "",
  );
  const recorded = deps.encounters.get(encounterKey) ?? null;
  const admission = admitBuildRequest(command, {
    resolvableDigests: resolvableDigestsOf(deps, command),
    firstEncounter: recorded === null ? null : encounterViewOf(recorded),
  });
  if (!admission.ok) {
    // Layer 3 — re-rank the oracle's compatibility-family refusals into
    // the house's frozen order: the R12 target taxonomy first, the engine
    // binding second (the oracle checks resolvability before engine
    // compatibility, so its unresolvable verdicts may be hiding an earlier
    // frozen-order refusal; by this point structure is oracle-validated,
    // so the target/binding reads below are well-founded).
    if (admission.code === "unresolvable-input" || admission.code === "target-engine-incompatible") {
      const target = requestTarget(command);
      if (!isTargetId(target)) {
        return {
          ok: false,
          code: "unknown-target",
          message: `target "${target}" is not in the frozen target taxonomy (R12)`,
        };
      }
      if (
        admission.code === "unresolvable-input" &&
        !command.inputs.engineBinding.supportedTargets.includes(target)
      ) {
        return {
          ok: false,
          code: "target-engine-incompatible",
          message: `engine binding "${command.inputs.engineBinding.engineId}" declares no support for target "${target}"`,
        };
      }
    }
    return {
      ok: false,
      code: admission.code,
      message: admission.message,
      ...(admission.input === undefined ? {} : { input: admission.input }),
    };
  }
  if (admission.classification === "duplicate") {
    return { ok: true, classification: "duplicate", buildId: admission.buildId };
  }
  const fingerprint = admission.fingerprint;
  const target = requestTarget(command);
  if (!isTargetId(target)) {
    return {
      ok: false,
      code: "unknown-target",
      message: `target "${target}" is not in the frozen target taxonomy (R12)`,
    };
  }
  const duplicate = findInFlightOrSucceeded(deps, tenant, fingerprint);
  if (duplicate !== null) {
    return {
      ok: false,
      code: "duplicate-payload",
      message: `an identical build request is already recorded as build ${duplicate.buildId} (phase ${duplicate.phase}); reuse that build or retry after failure with a fresh nonce`,
    };
  }
  const buildId = mintBuildId(tenant, fingerprint, command.idempotency);
  const record: BuildRecord = {
    buildId,
    tenant,
    requester: command.idempotency.requester,
    phase: "queued",
    admittedAt: deps.clock.now(),
    fingerprint,
    inputsDigest: computeBuildInputsDigest(command.inputs),
    request: command,
    steps: [],
    artifacts: [],
    evidence: [],
    closureSummary: null,
    provenance: null,
    outputs: null,
    failure: null,
  };
  deps.bumpRevision();
  deps.builds.set(buildId, record);
  deps.encounters.set(encounterKey, {
    key: encounterKey,
    tenant,
    scope: command.idempotency.scope,
    requester: command.idempotency.requester,
    nonce: command.idempotency.nonce,
    fingerprint,
    buildId,
  });
  addToFingerprintIndex(deps, tenant, fingerprint, buildId);
  deps.emit(tenant, buildId, "admitted", "queued");
  return { ok: true, classification: "first", buildId: asBuildId(buildId) };
}

/** Deterministic build-id minting (E9): same tenant+payload+nonce ⇒ same id. */
function mintBuildId(tenant: string, fingerprint: ContentDigest, idempotency: BuildIdempotencyKey): string {
  const digest = computeDigest({ tenant, fingerprint, requester: idempotency.requester, nonce: idempotency.nonce });
  return `bld-${digest.slice("sha256:".length, "sha256:".length + 24)}`;
}

/** Rebuilds build-contracts' encounter view from the recorded encounter. */
function encounterViewOf(recorded: RecordedEncounter): BuildRequestEncounter {
  const key: BuildIdempotencyKey = {
    scope: recorded.scope as BuildIdempotencyKey["scope"],
    requester: recorded.requester as BuildIdempotencyKey["requester"],
    nonce: recorded.nonce as BuildIdempotencyKey["nonce"],
  };
  return { key, fingerprint: recorded.fingerprint, buildId: asBuildId(recorded.buildId) };
}

/** The input digests the source seam can currently resolve (total; malformed commands yield the empty set). */
function resolvableDigestsOf(deps: BuildIntakeDeps, command: BuildRequestCommand): ReadonlySet<ContentDigest> {
  const set = new Set<ContentDigest>();
  try {
    for (const entry of buildInputDigests(command.inputs)) {
      if (deps.sources.canResolve(entry.digest)) {
        set.add(entry.digest);
      }
    }
  } catch {
    return set;
  }
  return set;
}

/** The in-flight-or-succeeded build for this tenant+fingerprint, when one exists. */
function findInFlightOrSucceeded(deps: BuildIntakeDeps, tenant: string, fingerprint: ContentDigest): BuildRecord | null {
  for (const buildId of deps.fingerprintIndex.get(`${tenant}|${fingerprint}`) ?? []) {
    const record = deps.builds.get(buildId);
    if (record !== undefined && record.phase !== "failed" && record.phase !== "cancelled") {
      return record;
    }
  }
  return null;
}

/** Records a build under the tenant+fingerprint index (duplicate-payload lookup). */
function addToFingerprintIndex(deps: BuildIntakeDeps, tenant: string, fingerprint: ContentDigest, buildId: string): void {
  const key = `${tenant}|${fingerprint}`;
  const existing = deps.fingerprintIndex.get(key) ?? [];
  deps.fingerprintIndex.set(key, [...existing, buildId]);
}
