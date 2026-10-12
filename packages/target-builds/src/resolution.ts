/**
 * TARGET-SET RESOLUTION (PL-036) — the total per-target adjudication of a
 * multi-target build request against the engine adapters' typed bindings.
 *
 * Resolution is TOTAL: no throws, no `any`, no partial returns that hide
 * rejections — every requested target yields either a binding (the FIRST
 * catalog engine whose own compatibility predicate consents) or a TYPED
 * refusal, and partial results accumulate their typed rejections without
 * voiding each other (failure isolation).
 *
 * Frozen per-target check order (fail-closed, most fundamental first):
 *  1. `unknown-target`    — the string is not in the frozen target
 *     taxonomy (target-profiles is the authority, R12);
 *  2. `sdk-gated`         — console-class target (frozen workflow class
 *     `console`): console artifacts require authorized vendor
 *     SDK/toolchains and actual verification (lock rule 24) — out-of-band
 *     vendor-pipeline activities this surface NEVER simulates (E11), and
 *     no adapter of the merged family declares console support. The
 *     refusal names the vendor gate and whether vendor evidence was
 *     presented; it is the truthful console answer, not a retry hint;
 *  3. `profile-unavailable` / `profile-invalid` — the target profile
 *     source publishes no sealed record for the target, or the record
 *     fails its seal/validation (tamper check, E8);
 *  4. `evidence-missing`  — the profile bundle declares an
 *     authorized-vendor-SDK gate and the request's out-of-band evidence
 *     pool carries no passing vendor-SDK record for that vendor (lock
 *     rule 24; retryable by re-requesting with the evidence);
 *  5. `no-engine-for-target` — no catalog binding's compatibility
 *     predicate consents (e.g. steamdeck, xr, dedicated-server — targets
 *     no merged adapter declares — or a profile whose engine declaration
 *     accepts none of the family).
 *
 * Determinism (E9): targets are enumerated in the request's canonical
 * content-derived order (deduplicated, sorted); the engine choice is the
 * first consenting entry in the frozen catalog order. Same request + same
 * pinned inputs ⇒ same resolution, always.
 */

import type { EngineBindingRef, EngineId, VendorGateRequirement, VerificationEvidence } from "@playliquid/build-contracts";
import { hasAuthorizedVendorEvidence, isVerificationEvidenceRecord } from "@playliquid/build-orchestrator";
import type { TargetId, TargetProfileRecord } from "@playliquid/target-profiles";
import { isTargetId, targetWorkflowClass } from "@playliquid/target-profiles";
import type { EngineCatalog } from "./catalog.ts";
import type { TargetProfilePort } from "./profiles.ts";
import { verifyProfileBundle } from "./profiles.ts";
import type { ProfileVerification } from "./profiles.ts";
import type { MultiTargetBuildRequest } from "./request.ts";
import { canonicalTargets } from "./request.ts";

/** The typed refusal codes of target-set resolution. */
export type TargetRefusalCode =
  | "unknown-target"
  | "sdk-gated"
  | "evidence-missing"
  | "no-engine-for-target"
  | "profile-unavailable"
  | "profile-invalid";

/** One requested target's typed rejection (all outcomes are carried honestly). */
export interface TargetRefusal {
  /** The target as requested (opaque text — it may not even be in the taxonomy). */
  readonly target: string;
  readonly code: TargetRefusalCode;
  readonly message: string;
}

/** One requested target's engine binding. */
export interface TargetBinding {
  readonly target: TargetId;
  /** The bound adapter's engine family id. */
  readonly engineId: EngineId;
  /** The bound adapter's digest-pinned engine binding, as build inputs cite it. */
  readonly binding: EngineBindingRef;
  /** The sealed target profile record the adapter consented to serve. */
  readonly profile: TargetProfileRecord;
  /** The vendor gate the per-target build inputs will declare. */
  readonly vendorGate: VendorGateRequirement;
}

/** The total result of resolving one request's target set. */
export interface TargetSetResolution {
  /** The bound targets, in the request's canonical (content-derived) order. */
  readonly bindings: readonly TargetBinding[];
  /** The typed rejections, in the same canonical order (E8: never hidden). */
  readonly refusals: readonly TargetRefusal[];
  /** The canonical requested enumeration this resolution walked. */
  readonly requested: readonly string[];
}

/** True iff the target's frozen workflow class is console (lock rule 24). */
function isConsoleClass(target: TargetId): boolean {
  return targetWorkflowClass(target) === "console";
}

/** The sdk-gated refusal message for one console-class target (truthful, E11). */
function sdkGatedRefusal(target: TargetId, verification: ProfileVerification, evidence: readonly VerificationEvidence[]): TargetRefusal {
  const record = verification.ok ? verification.bundle.record : null;
  const vendor = record !== null && record.target === "console" ? ` (vendor "${record.console.vendorSdk.vendorId}")` : "";
  const presented = evidence.some((entry) => entry.kind === "vendor-sdk");
  return {
    target,
    code: "sdk-gated",
    message:
      `console-class target "${target}" is SDK/toolchain gated (lock rule 24): authorized vendor SDK/toolchains and actual on-target verification` +
      `${vendor} are out-of-band vendor-pipeline activities this multi-target surface never simulates (E11); no adapter of the engine family` +
      ` declares console support; vendor-SDK evidence was ${presented ? "presented but cannot substitute for the authorized vendor toolchain" : "not presented"}`,
  };
}

/**
 * Resolves one requested target's binding or typed refusal (the per-target
 * adjudication above; total, never throws).
 */
function resolveOneTarget(
  target: string,
  catalog: EngineCatalog,
  profiles: TargetProfilePort,
  evidence: readonly VerificationEvidence[],
): TargetBinding | TargetRefusal {
  if (!isTargetId(target)) {
    return {
      target,
      code: "unknown-target",
      message: `target "${target}" is not in the frozen target taxonomy (R12; target-profiles is the authority)`,
    };
  }
  const requested: TargetId = target;
  if (isConsoleClass(requested)) {
    // Lock rule 24 governs console BEFORE profile fit is even relevant: no
    // vendor-authorized SDK/toolchain means no console artifact, whatever the
    // profile says. The profile is still VERIFIED for the vendor name in the
    // refusal (a tampered profile yields the vendor-less message, never a throw).
    const verification = verifyProfileBundle(profiles.bundleFor(requested), requested);
    return sdkGatedRefusal(requested, verification, evidence);
  }
  const verification = verifyProfileBundle(profiles.bundleFor(requested), requested);
  if (!verification.ok) {
    return { target, code: verification.code, message: verification.message };
  }
  const bundle = verification.bundle;
  if (bundle.vendorGate.kind === "authorized-vendor-sdk" && !hasAuthorizedVendorEvidence(bundle.vendorGate, evidence)) {
    return {
      target,
      code: "evidence-missing",
      message:
        `target "${target}" profile declares an authorized-vendor-SDK gate for vendor "${bundle.vendorGate.vendorId}" (lock rule 24) ` +
        `but the request presents no passing vendor-SDK evidence for that vendor; supply the out-of-band evidence and re-request`,
    };
  }
  for (const entry of catalog) {
    if (entry.canServe(bundle.record).compatible) {
      return {
        target: requested,
        engineId: entry.engineId,
        binding: entry.binding,
        profile: bundle.record,
        vendorGate: bundle.vendorGate,
      };
    }
  }
  return {
    target,
    code: "no-engine-for-target",
    message: `no engine adapter of the catalog serves target "${target}" (every compatibility predicate refused; E11 truthful capability gap)`,
  };
}

/**
 * Resolves a multi-target request's full target set. Total: every
 * requested target yields a binding or a typed refusal; refusals never
 * void bindings (failure isolation, E8).
 */
export function resolveTargetSet(
  request: MultiTargetBuildRequest,
  catalog: EngineCatalog,
  profiles: TargetProfilePort,
): TargetSetResolution {
  // Fail-closed sanitation of the out-of-band pool (totality for hostile
  // direct callers): a malformed record can never satisfy a vendor gate, so
  // it is dropped here rather than crashing the adjudication (E8).
  const evidence = (request.evidence ?? []).filter(isVerificationEvidenceRecord);
  const bindings: TargetBinding[] = [];
  const refusals: TargetRefusal[] = [];
  for (const target of canonicalTargets(request)) {
    const outcome = resolveOneTarget(target, catalog, profiles, evidence);
    if ("engineId" in outcome) {
      bindings.push(outcome);
    } else {
      refusals.push(outcome);
    }
  }
  return { bindings, refusals, requested: canonicalTargets(request) };
}
