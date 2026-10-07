/**
 * Verification and provenance evidence for build outputs.
 *
 * R19 (provenance/licensing is a release/build gate) is enforced by
 * REUSING package-system's provenance vocabulary and release gate — this
 * module never re-implements provenance semantics: it aggregates
 * package-system's `checkReleaseGate` over the locked package records.
 *
 * Console truth (R12 "where toolchains permit"; architecture: "Console
 * artifacts require authorized vendor SDK/toolchains and actual
 * verification"): a build whose target profile declares the
 * `authorized-vendor-sdk` vendor gate FAILS CLOSED unless its evidence set
 * contains (a) an authorized vendor-SDK evidence record from the gate's
 * vendor, and (b) an actual (on-target) verification evidence record with
 * a PASS verdict covering the build manifest digest — the manifest pins
 * every artifact and every input, so nothing unsigned ships (lock rule
 * 24: console capability is SDK/toolchain gated and must be proven).
 */

import { checkReleaseGate, isContentDigest } from "@playliquid/package-system";
import type { ContentDigest, PackageRecord } from "@playliquid/package-system";
import type { VendorId } from "./primitives.ts";
import { isNonEmptyIdText } from "./primitives.ts";
import type { VendorGateRequirement } from "./inputs.ts";

/** A verification verdict. */
export type VerificationVerdict = "pass" | "fail";

/**
 * The authorized-vendor-SDK marker (structurally required by console
 * target profile records; mirrored here as the evidence-side shape). All
 * three fields are required — a marker without an authorized SDK digest or
 * without an authorization digest does not exist structurally.
 */
export interface VendorSdkAuthorization {
  readonly vendorId: VendorId;
  /** Content digest of the authorized vendor SDK/toolchain. */
  readonly authorizedSdkDigest: ContentDigest;
  /** Content digest of the vendor authorization (the "signature"). */
  readonly authorizationDigest: ContentDigest;
}

/** Type guard: a structurally valid vendor SDK authorization. */
export function isVendorSdkAuthorization(value: unknown): value is VendorSdkAuthorization {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<VendorSdkAuthorization>;
  return (
    isNonEmptyIdText(candidate.vendorId) &&
    isContentDigest(candidate.authorizedSdkDigest) &&
    isContentDigest(candidate.authorizationDigest)
  );
}

/** A verification evidence kind. Frozen vocabulary. */
export const VERIFICATION_EVIDENCE_KINDS = Object.freeze([
  "evaluation-suite",
  "vendor-sdk",
  "on-target",
] as const);

/** A verification evidence kind. */
export type VerificationEvidenceKind = (typeof VERIFICATION_EVIDENCE_KINDS)[number];

/** An evaluation-suite run verdict (suite references ride package-system's GameIR seam vocabulary). */
export interface EvaluationSuiteEvidence {
  readonly kind: "evaluation-suite";
  readonly verdict: VerificationVerdict;
  readonly suite: { readonly suiteId: string; readonly suiteDigest: ContentDigest };
  /** Content digest of the run's underlying evidence (opaque; CAS-resolvable). */
  readonly evidenceDigest: ContentDigest;
}

/** Authorized vendor SDK evidence (the console "signed toolchain" record). */
export interface VendorSdkEvidence {
  readonly kind: "vendor-sdk";
  readonly verdict: VerificationVerdict;
  readonly authorization: VendorSdkAuthorization;
  readonly evidenceDigest: ContentDigest;
}

/** Actual verification: the emitted build was really run/verified on/for the target. */
export interface OnTargetEvidence {
  readonly kind: "on-target";
  readonly verdict: VerificationVerdict;
  /** The build manifest digest that was verified (pins artifacts + inputs). */
  readonly verifiedDigest: ContentDigest;
  readonly evidenceDigest: ContentDigest;
}

/** A typed verification verdict record. */
export type VerificationEvidence = EvaluationSuiteEvidence | VendorSdkEvidence | OnTargetEvidence;

/** The inputs of {@link checkVendorSdkGate}. */
export interface VendorSdkGateInput {
  readonly vendorGate: VendorGateRequirement;
  readonly manifestDigest: ContentDigest;
  readonly evidence: readonly VerificationEvidence[];
}

/** Stable failure codes of the console vendor gate. */
export type VendorSdkGateFailureCode =
  | "vendor-sdk-evidence-missing"
  | "vendor-sdk-not-authorized"
  | "vendor-sdk-verdict-failed"
  | "actual-verification-missing"
  | "actual-verification-failed"
  | "actual-verification-target-mismatch";

/** One vendor gate failure reason. */
export interface VendorSdkGateFailure {
  readonly code: VendorSdkGateFailureCode;
  readonly message: string;
}

/** The vendor gate verdict. `pass` is true only when `reasons` is empty. */
export interface VendorSdkGateResult {
  readonly pass: boolean;
  readonly reasons: readonly VendorSdkGateFailure[];
}

/**
 * THE console evidence gate (pure, fails closed). For a
 * `authorized-vendor-sdk` gate the evidence set MUST contain an authorized
 * vendor-sdk PASS record from the gate's own vendor AND an on-target PASS
 * record verifying exactly `manifestDigest`. A `none` gate passes
 * vacuously (non-console targets may still carry evidence voluntarily).
 */
export function checkVendorSdkGate(input: VendorSdkGateInput): VendorSdkGateResult {
  if (input.vendorGate.kind !== "authorized-vendor-sdk") {
    return { pass: true, reasons: [] };
  }
  const vendorId = input.vendorGate.vendorId;
  const reasons: VendorSdkGateFailure[] = [];

  const vendorRecords = input.evidence.filter(
    (record): record is VendorSdkEvidence => record.kind === "vendor-sdk",
  );
  if (vendorRecords.length === 0) {
    reasons.push({
      code: "vendor-sdk-evidence-missing",
      message: `console-class build requires authorized vendor SDK evidence (vendor "${vendorId}"); none was provided`,
    });
  }
  const authorized = vendorRecords.filter(
    (record) => record.verdict === "pass" && record.authorization.vendorId === vendorId,
  );
  if (vendorRecords.length > 0 && authorized.length === 0) {
    reasons.push({
      code: "vendor-sdk-not-authorized",
      message: `vendor SDK evidence does not carry an authorized, passing record for gate vendor "${vendorId}"`,
    });
  }

  const onTarget = input.evidence.filter(
    (record): record is OnTargetEvidence => record.kind === "on-target",
  );
  if (onTarget.length === 0) {
    reasons.push({
      code: "actual-verification-missing",
      message: "console-class build requires actual (on-target) verification evidence; none was provided",
    });
  }
  if (onTarget.length > 0 && !onTarget.some((record) => record.verdict === "pass")) {
    reasons.push({
      code: "actual-verification-failed",
      message: "on-target verification evidence exists but no record carries a PASS verdict",
    });
  }
  if (
    onTarget.some((record) => record.verdict === "pass") &&
    !onTarget.some((record) => record.verdict === "pass" && record.verifiedDigest === input.manifestDigest)
  ) {
    reasons.push({
      code: "actual-verification-target-mismatch",
      message: "on-target PASS evidence does not verify this build's manifest digest; artifacts remain unsigned",
    });
  }

  return { pass: reasons.length === 0, reasons };
}

/** A provenance gate failure naming the offending package. */
export interface BuildProvenanceGateFailure {
  readonly packageId: string;
  readonly code: string;
  readonly message: string;
}

/** The R19 build provenance gate verdict. */
export interface BuildProvenanceGateResult {
  readonly pass: boolean;
  readonly reasons: readonly BuildProvenanceGateFailure[];
}

/**
 * THE R19 build provenance gate (pure, fails closed): every package record
 * locked into the build must pass package-system's release gate. This is
 * deliberately an AGGREGATION of `@playliquid/package-system`'s
 * `checkReleaseGate` — provenance semantics have exactly one authority.
 */
export function checkBuildProvenanceGate(records: readonly PackageRecord[]): BuildProvenanceGateResult {
  const reasons: BuildProvenanceGateFailure[] = [];
  for (const record of records) {
    const verdict = checkReleaseGate(record);
    if (!verdict.pass) {
      for (const failure of verdict.reasons) {
        reasons.push({
          packageId: record?.identity?.id ?? "<unknown>",
          code: failure.code,
          message: failure.message,
        });
      }
    }
  }
  return { pass: reasons.length === 0, reasons };
}
