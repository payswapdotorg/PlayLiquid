/**
 * The composition validator: checks a complete {@link BuildOutputs} record
 * against the {@link BuildInputs} it claims to have been produced from.
 * Pure and fail-closed; aggregates typed violation codes.
 *
 * Checks:
 * 1. at least one artifact, every artifact structurally valid and CAS
 *    addressed (E7 — inline build artifacts are refused);
 * 2. every artifact is for the requested target;
 * 3. the manifest's input-set digest and per-input summary match the
 *    actual inputs (a manifest for different inputs is refused);
 * 4. the manifest's steps are exactly the complete frozen stage sequence;
 * 5. the environment fingerprint equals the pinned toolchain/environment
 *    profile digest (E9 — no ambient environments);
 * 6. provenance evidence is structurally present (R19 shape; the
 *    per-package release gate is `checkBuildProvenanceGate`);
 * 7. the console vendor gate passes (fail-closed; no unsigned console
 *    artifacts — lock rule 24).
 */

import { checkArtifactPlacement } from "@playliquid/package-system";
import type { BuildInputs } from "./inputs.ts";
import { computeBuildInputsDigest } from "./inputs.ts";
import type { BuildOutputs } from "./outputs.ts";
import { computeBuildManifestDigest } from "./outputs.ts";
import type { BuildStage } from "./stages.ts";
import { isCompleteStageSequence, isBuildStage } from "./stages.ts";
import { checkVendorSdkGate } from "./verification.ts";
import type { VendorSdkGateFailure } from "./verification.ts";

/** Stable violation codes for {@link validateBuildOutputs}. */
export type BuildOutputViolationCode =
  | "no-artifacts"
  | "invalid-artifact"
  | "artifact-not-cas"
  | "artifact-target-mismatch"
  | "manifest-inputs-mismatch"
  | "manifest-inputs-summary-mismatch"
  | "manifest-steps-invalid"
  | "environment-fingerprint-mismatch"
  | "provenance-transformation-missing"
  | "provenance-invalid"
  | "model-provenance-missing"
  | "vendor-gate-failed";

/** One output violation. */
export interface BuildOutputViolation {
  readonly code: BuildOutputViolationCode;
  readonly message: string;
  /** Vendor gate reasons, present only with code `vendor-gate-failed`. */
  readonly vendorGateReasons?: readonly VendorSdkGateFailure[];
}

/** Result of {@link validateBuildOutputs}. */
export type BuildOutputsValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly BuildOutputViolation[] };

/** Pure composition validation of build outputs against their inputs. */
export function validateBuildOutputs(outputs: BuildOutputs, inputs: BuildInputs): BuildOutputsValidation {
  const reasons: BuildOutputViolation[] = [];

  if (!Array.isArray(outputs.artifacts) || outputs.artifacts.length === 0) {
    reasons.push({ code: "no-artifacts", message: "build produced no artifacts" });
  }
  for (const artifact of outputs.artifacts) {
    if (
      typeof artifact !== "object" ||
      artifact === null ||
      typeof artifact.artifactKind !== "string" ||
      typeof artifact.target !== "string"
    ) {
      reasons.push({ code: "invalid-artifact", message: "artifact record is structurally invalid" });
      continue;
    }
    const placement = checkArtifactPlacement(artifact.bytes);
    if (!placement.ok) {
      reasons.push({ code: "invalid-artifact", message: `artifact is invalid: ${placement.message}` });
      continue;
    }
    if (artifact.bytes.storage !== "cas") {
      reasons.push({
        code: "artifact-not-cas",
        message: "build artifacts must be CAS-addressed (E7); inline artifacts are refused",
      });
      continue;
    }
    if (artifact.target !== inputs.targetProfile.target) {
      reasons.push({
        code: "artifact-target-mismatch",
        message: `artifact of kind "${artifact.artifactKind}" targets "${artifact.target}" but the build was requested for "${inputs.targetProfile.target}"`,
      });
    }
  }

  const manifest = outputs.manifest;
  const expectedInputsDigest = computeBuildInputsDigest(inputs);
  if (manifest?.inputsDigest !== expectedInputsDigest) {
    reasons.push({
      code: "manifest-inputs-mismatch",
      message: "manifest inputs digest does not match the build inputs",
    });
  }
  const summary = manifest?.inputs;
  if (
    summary?.gameIr !== inputs.gameIr.digest ||
    summary?.packageLock !== inputs.packageLock.lockFingerprint ||
    summary?.targetProfile !== inputs.targetProfile.profileDigest ||
    summary?.engineBinding !== inputs.engineBinding.bindingDigest ||
    summary?.toolchain !== inputs.toolchain.profileDigest
  ) {
    reasons.push({
      code: "manifest-inputs-summary-mismatch",
      message: "manifest per-input digest summary does not match the build inputs",
    });
  }

  const stages: readonly BuildStage[] = Array.isArray(manifest?.steps)
    ? manifest.steps.map((step) => step?.stage)
    : [];
  const stepsWellFormed =
    Array.isArray(manifest?.steps) &&
    manifest.steps.every(
      (step) => isBuildStage(step?.stage) && typeof step?.stageDigest === "string",
    );
  if (!stepsWellFormed || !isCompleteStageSequence(stages)) {
    reasons.push({
      code: "manifest-steps-invalid",
      message: "manifest steps are not the complete frozen stage sequence (resolve → plan → emit → verify → package)",
    });
  }

  if (manifest?.environmentFingerprint !== inputs.toolchain.profileDigest) {
    reasons.push({
      code: "environment-fingerprint-mismatch",
      message: "environment fingerprint is not the pinned toolchain/environment profile digest (E9)",
    });
  }

  const provenance = outputs.provenance;
  if (
    typeof provenance !== "object" ||
    provenance === null ||
    typeof provenance.buildTransformation !== "object" ||
    provenance.buildTransformation === null ||
    provenance.buildTransformation.kind !== "transform"
  ) {
    reasons.push({
      code: "provenance-transformation-missing",
      message: "build provenance must record the build as a `transform` step (R19)",
    });
  }
  if (!Array.isArray(provenance?.packageProvenance)) {
    reasons.push({ code: "provenance-invalid", message: "package provenance evidence is missing (R19)" });
  }
  if (provenance?.generatedByAi === true && !Array.isArray(provenance.modelProvenance)) {
    reasons.push({
      code: "model-provenance-missing",
      message: "AI-assisted build carries no model provenance entries (R19)",
    });
  }

  const gate = checkVendorSdkGate({
    vendorGate: inputs.targetProfile.vendorGate,
    manifestDigest: manifest ? computeBuildManifestDigest(manifest) : "",
    evidence: outputs.verification,
  });
  if (!gate.pass) {
    reasons.push({
      code: "vendor-gate-failed",
      message: "console-class build failed the authorized-vendor-SDK evidence gate",
      vendorGateReasons: gate.reasons,
    });
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
