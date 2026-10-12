/**
 * THE FAN-OUT PLAN (PL-036) — the durable, content-addressed document that
 * maps the resolved target set onto per-target staged builds.
 *
 * Shape: one IMMUTABLE plan per resolution, computed purely from
 * - the request's CONTENT fingerprint (pins + canonical target enumeration
 *   + canonical parameters — never the nonce/requester/evidence), and
 * - the resolution itself (bindings + typed refusals);
 * so `planId` is a CONTENT KEY: same request content + same pinned inputs ⇒
 * same plan id, same entries, same digests, same target order (E9). That
 * key is what E6 resume idempotence is keyed on — a re-run of the same
 * content reuses the durable plan and skips its already-completed targets.
 *
 * Every entry carries the per-target build-orchestrator REQUEST document
 * digest (build-contracts' request fingerprint — the deterministic payload
 * the per-target orchestrator's intake oracle will admit), making the plan
 * a typed target → request-document digest mapping; the target →
 * build-document digest mapping is recorded by the multi-target build
 * record as each staged build completes (see record.ts).
 *
 * Pure module: no IO, no clocks, no throws.
 */

import { asBuildNonce, asBuildTargetId, asProfileInputId, asRequesterId, computeBuildRequestFingerprint } from "@playliquid/build-contracts";
import type { BuildRequestCommand, EngineId } from "@playliquid/build-contracts";
import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { TenantId } from "@playliquid/build-orchestrator";
import type { TargetId } from "@playliquid/target-profiles";
import type { MultiTargetBuildRequest } from "./request.ts";
import { perTargetNonce } from "./request.ts";
import type { TargetBinding, TargetRefusal, TargetSetResolution } from "./resolution.ts";

/** One bound target's fan-out entry. */
export interface FanoutPlanEntry {
  readonly target: TargetId;
  /** The bound adapter's engine family id (adapter identity, R19 provenance material). */
  readonly engineId: EngineId;
  /** The bound adapter's digest-pinned engine binding digest. */
  readonly bindingDigest: ContentDigest;
  /** The sealed target profile record's content digest. */
  readonly profileDigest: ContentDigest;
  /** The per-target build-orchestrator REQUEST document digest (deterministic, E9). */
  readonly requestFingerprint: ContentDigest;
  /** Content digest of this entry (canonical form). */
  readonly entryDigest: ContentDigest;
}

/** The durable fan-out plan document (immutable, content-addressed). */
export interface MultiTargetFanoutPlan {
  readonly kind: "multi-target-fanout-plan";
  /** The content key (E6 resume idempotence): digest over tenant + request content + resolution. */
  readonly planId: ContentDigest;
  readonly tenant: TenantId;
  /** The request's CONTENT fingerprint (pins + canonical targets + parameters; E9). */
  readonly requestFingerprint: ContentDigest;
  /** Bound targets, in the request's canonical content-derived order. */
  readonly entries: readonly FanoutPlanEntry[];
  /** Typed per-target rejections carried by this plan (E8: never hidden). */
  readonly refusals: readonly TargetRefusal[];
}

/** The canonical JSON-safe form of one refusal (digest input). */
function refusalForm(refusal: TargetRefusal): { target: string; code: string; message: string } {
  return { target: refusal.target, code: refusal.code, message: refusal.message };
}

/** Derives one entry's per-target build request command (deterministic, E9). */
export function buildTargetRequestCommand(request: MultiTargetBuildRequest, binding: TargetBinding): BuildRequestCommand {
  return {
    kind: "request-build",
    idempotency: {
      scope: "build-request",
      requester: asRequesterId(request.requester),
      nonce: asBuildNonce(perTargetNonce(request, binding.target)),
    },
    inputs: {
      gameIr: { digest: request.pins.gameIr },
      packageLock: {
        lockFingerprint: request.pins.packageLock.lockFingerprint,
        pinnedPackageCount: request.pins.packageLock.pinnedPackageCount,
      },
      targetProfile: {
        profileId: asProfileInputId(binding.profile.profileId),
        profileDigest: binding.profile.profileDigest,
        target: asBuildTargetId(binding.target),
        vendorGate: binding.vendorGate,
      },
      engineBinding: binding.binding,
      toolchain: request.pins.toolchain,
    },
    parameters: request.parameters,
    requestedAt: request.requestedAt,
  };
}

/**
 * Computes the fan-out plan of one resolution. Pure and deterministic:
 * the same request content + the same resolution always produce the same
 * plan id, entry digests and ordering (E9).
 */
export function computeFanoutPlan(
  tenant: TenantId,
  request: MultiTargetBuildRequest,
  requestFingerprint: ContentDigest,
  resolution: TargetSetResolution,
): MultiTargetFanoutPlan {
  const entries: FanoutPlanEntry[] = resolution.bindings.map((binding) => {
    const command = buildTargetRequestCommand(request, binding);
    const requestFingerprintOfTarget = computeBuildRequestFingerprint(command);
    const entry = {
      target: binding.target,
      engineId: binding.engineId,
      bindingDigest: binding.binding.bindingDigest,
      profileDigest: binding.profile.profileDigest,
      requestFingerprint: requestFingerprintOfTarget,
    };
    return { ...entry, entryDigest: computeDigest(entry) };
  });
  const planId = computeDigest({
    kind: "multi-target-fanout-plan",
    tenant,
    requestFingerprint,
    entries: entries.map((entry) => entry.entryDigest),
    refusals: resolution.refusals.map(refusalForm),
  });
  return {
    kind: "multi-target-fanout-plan",
    planId,
    tenant,
    requestFingerprint,
    entries,
    refusals: resolution.refusals,
  };
}

/** The durable per-target resume key of one plan entry (service-internal). */
export function planTargetKey(planId: ContentDigest, target: TargetId): string {
  return `${planId}|${target}`;
}
