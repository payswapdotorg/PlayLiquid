/**
 * The typed multi-target build REQUEST (PL-036) — the vocabulary a tenant
 * submits to the multi-target surface:
 *
 *   tenant (the door argument, R20) + content/package pins + requested
 *   target set + out-of-band evidence pool + record parameters.
 *
 * One authority per concern:
 * - the target TAXONOMY is @playliquid/target-profiles — the request only
 *   names target STRINGS; per-target taxonomy membership is adjudicated at
 *   resolution (typed `unknown-target` refusals, E8), never here;
 * - the pins reuse @playliquid/build-contracts' input vocabulary verbatim
 *   (digests, lock fingerprint, toolchain profile) so the per-target build
 *   requests this surface derives are admitted by the build-orchestrator's
 *   own intake oracle without translation;
 * - the evidence pool is build-contracts' VerificationEvidence records —
 *   out-of-band attestations (authorized vendor-SDK, on-target records)
 *   that gated targets demand; it is NOT part of the request's content
 *   fingerprint (evidence may arrive between runs — that is exactly the
 *   E6 resume story: same plan, better evidence);
 * - parameters are a GameIR record value (the kernel value language) and
 *   enter the content fingerprint through game-ir's canonical value form
 *   — the single canonicalization authority for structured values (E9).
 *
 * Pure module: structural validation and one deterministic content
 * fingerprint. No IO, no clocks, no throws — typed refusals only.
 */

import { isContentDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import { computeDigest } from "@playliquid/package-system";
import { canonicalValueForm, isGameIRValue } from "@playliquid/game-ir";
import type { BuildParameters, BuildRequestCommand } from "@playliquid/build-contracts";
import type { RequesterId, BuildNonce, ToolchainProfileRef, VerificationEvidence } from "@playliquid/build-contracts";
import { isNonEmptyIdText, isValidToolOperationId } from "@playliquid/build-contracts";
import { isVerificationEvidenceRecord } from "@playliquid/build-orchestrator";

/** The content/package pins every per-target build is derived from. */
export interface MultiTargetPins {
  /** The pinned GameIR composition digest (kernel digest discipline). */
  readonly gameIr: ContentDigest;
  /** The pinned game package lock (package-system lockfile vocabulary). */
  readonly packageLock: {
    readonly lockFingerprint: ContentDigest;
    readonly pinnedPackageCount: number;
  };
  /** The toolchain/environment profile every target builds under. */
  readonly toolchain: ToolchainProfileRef;
}

/** A tenant-scoped multi-target build request (E6: durable, idempotent by key). */
export interface MultiTargetBuildRequest {
  readonly kind: "multi-target-build-request";
  readonly requester: RequesterId;
  /** Idempotency nonce — tenant+requester scoped (replay = duplicate, E6). */
  readonly nonce: BuildNonce;
  readonly pins: MultiTargetPins;
  /** The requested target set — target STRINGS; taxonomy membership is adjudicated at resolution. */
  readonly targets: readonly string[];
  /**
   * Out-of-band evidence pool (authorized vendor-SDK, on-target records).
   * Deliberately NOT part of the content fingerprint: a re-run may present
   * stronger evidence for the SAME plan (E6 resume; lock rule 24).
   */
  readonly evidence?: readonly VerificationEvidence[];
  /** Engine-independent request parameters (GameIR record value). */
  readonly parameters: BuildParameters;
  /** Caller-supplied epoch milliseconds; this package never reads a clock. */
  readonly requestedAt: number;
}

/** Stable request violation codes for {@link validateMultiTargetBuildRequest}. */
export type RequestViolationCode =
  | "invalid-requester"
  | "invalid-nonce"
  | "invalid-pins"
  | "invalid-targets"
  | "invalid-evidence"
  | "invalid-parameters"
  | "invalid-requested-at";

/** One structural violation of a multi-target build request. */
export interface RequestViolation {
  readonly code: RequestViolationCode;
  readonly message: string;
}

/** Result of {@link validateMultiTargetBuildRequest}. Fails closed; aggregates reasons. */
export type RequestValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly RequestViolation[] };

/** Total structural validation of a multi-target build request (E1/E8). */
export function validateMultiTargetBuildRequest(request: MultiTargetBuildRequest): RequestValidation {
  const reasons: RequestViolation[] = [];
  if (typeof request !== "object" || request === null || request.kind !== "multi-target-build-request") {
    return { ok: false, reasons: [{ code: "invalid-requester", message: "command must be a multi-target-build-request object" }] };
  }
  if (!isNonEmptyIdText(request.requester)) {
    reasons.push({ code: "invalid-requester", message: "requester must be non-empty identifier text" });
  }
  if (!isNonEmptyIdText(request.nonce)) {
    reasons.push({ code: "invalid-nonce", message: "nonce must be non-empty identifier text" });
  }
  const pins = request.pins;
  if (
    typeof pins !== "object" ||
    pins === null ||
    !isContentDigest(pins?.gameIr) ||
    !isContentDigest(pins?.packageLock?.lockFingerprint) ||
    typeof pins?.packageLock?.pinnedPackageCount !== "number" ||
    !Number.isSafeInteger(pins?.packageLock?.pinnedPackageCount) ||
    (pins?.packageLock?.pinnedPackageCount ?? -1) < 0 ||
    !isNonEmptyIdText(pins?.toolchain?.profileId) ||
    !isContentDigest(pins?.toolchain?.profileDigest) ||
    !Array.isArray(pins?.toolchain?.citesToolOperations) ||
    !pins?.toolchain?.citesToolOperations.every((operation) => isValidToolOperationId(operation))
  ) {
    reasons.push({ code: "invalid-pins", message: "content/package pins are structurally invalid (gameIr, packageLock, toolchain)" });
  }
  if (!Array.isArray(request.targets) || request.targets.length === 0 || !request.targets.every((target) => typeof target === "string" && target.length > 0)) {
    reasons.push({ code: "invalid-targets", message: "requested target set must be a non-empty array of target strings" });
  }
  if (request.evidence !== undefined && (!Array.isArray(request.evidence) || request.evidence.some((record) => !isVerificationEvidenceRecord(record)))) {
    reasons.push({ code: "invalid-evidence", message: "evidence pool must be an array of well-formed verification evidence records (fail closed, E8)" });
  }
  if (!isGameIRValue(request.parameters) || request.parameters.kind !== "record") {
    reasons.push({ code: "invalid-parameters", message: "request parameters must be a GameIR record value" });
  }
  if (typeof request.requestedAt !== "number" || !Number.isFinite(request.requestedAt) || request.requestedAt < 0) {
    reasons.push({ code: "invalid-requested-at", message: "requestedAt must be a finite, non-negative caller-supplied timestamp" });
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** The canonical requested-target enumeration: deduplicated, lexicographically sorted (E9). */
export function canonicalTargets(request: MultiTargetBuildRequest): readonly string[] {
  return [...new Set(request.targets)].sort();
}

/**
 * The CONTENT fingerprint of a multi-target request (E9): a pure digest of
 * WHAT is built — pins, the canonical target enumeration and the canonical
 * parameter form. The idempotency nonce, the requester and the evidence pool
 * are deliberately excluded: replays are keyed by the encounter, and a
 * re-run with a fresh nonce but identical content maps to the SAME plan
 * (content key), which is what makes E6 resume-skip semantics possible.
 */
export function computeMultiTargetRequestFingerprint(request: MultiTargetBuildRequest): ContentDigest {
  return computeDigest({
    pins: {
      gameIr: request.pins.gameIr,
      packageLock: {
        lockFingerprint: request.pins.packageLock.lockFingerprint,
        pinnedPackageCount: request.pins.packageLock.pinnedPackageCount,
      },
      toolchain: {
        profileId: request.pins.toolchain.profileId,
        profileDigest: request.pins.toolchain.profileDigest,
        citesToolOperations: [...request.pins.toolchain.citesToolOperations].sort(),
      },
    },
    targets: canonicalTargets(request),
    parameters: canonicalValueForm(request.parameters),
  });
}

/** The tenant-scoped idempotency encounter key of one request (R20/E6). */
export function multiTargetEncounterKey(tenant: string, request: MultiTargetBuildRequest): string {
  return `${tenant}|${request.requester}|${request.nonce}`;
}

/** The per-target nonce minted from the request's nonce (deterministic, E9; bounded to the id budget). */
export function perTargetNonce(request: MultiTargetBuildRequest, target: string): BuildNonce {
  if (request.nonce.length + 1 + target.length <= 256) {
    return (`${request.nonce}#${target}` as BuildNonce);
  }
  // Oversized nonces degrade to a bounded digest form — never a broken id.
  const derived = computeDigest({ nonce: request.nonce, target }).slice("sha256:".length, "sha256:".length + 24);
  return (`mtb#${derived}` as BuildNonce);
}

/** Narrowing helper: the build-contracts request command shape this surface derives per target. */
export type PerTargetBuildRequest = BuildRequestCommand;
