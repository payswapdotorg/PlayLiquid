/**
 * Deterministic in-memory fakes and fixture builders.
 *
 * NOT exported from the package barrel — test/harness-only (house pattern;
 * see `@playliquid/package-system` test-fixtures). The fake executor is
 * clearly a FAKE: it derives every digest from its inputs through
 * package-system's `computeDigest` (never fabricated literals, never a
 * real toolchain) and FAILS CLOSED on vendor-gated builds unless the
 * caller supplies the vendor evidence records — authorization is never
 * simulated (lock rule 24, E11, AGENTS "no mock presented as real
 * production integration").
 */

import { computeDigest, sealPackageRecord } from "@playliquid/package-system";
import type { ContentDigest, PackageRecord, SemanticVersion, UnsealedPackageRecord } from "@playliquid/package-system";
import {
  asBuildId,
  asBuildNonce,
  asBuildTargetId,
  asProfileInputId,
  asRequesterId,
  asToolchainProfileId,
  asVendorId,
} from "./primitives.ts";
import type { BuildArtifactKind } from "./primitives.ts";
import { asEngineId, asToolOperationId } from "./adapter-seam.ts";
import type { BuildInputs } from "./inputs.ts";
import { computeBuildInputsDigest } from "./inputs.ts";
import type { BuildRequestCommand } from "./commands.ts";
import { admitBuildRequest } from "./commands.ts";
import type { BuildExecutionCommand, BuildExecutionResult, BuildExecutor } from "./executor.ts";
import { BUILD_STAGES } from "./stages.ts";
import type { BuildArtifact, BuildManifest, BuildStepRecord } from "./outputs.ts";
import { computeBuildManifestDigest } from "./outputs.ts";
import type { VendorSdkEvidence, VerificationEvidence } from "./verification.ts";

/** A stable, digest-derived content digest for fixtures (no hand-written digests). */
export function fixtureDigest(seed: string): ContentDigest {
  return computeDigest({ fixture: seed });
}

/** Structurally valid build inputs for a non-gated (web) target. */
export function fixtureWebInputs(): BuildInputs {
  return {
    gameIr: { digest: fixtureDigest("game-ir-composition") },
    packageLock: { lockFingerprint: fixtureDigest("package-lock"), pinnedPackageCount: 3 },
    targetProfile: {
      profileId: asProfileInputId("web-default"),
      profileDigest: fixtureDigest("target-profile-web"),
      target: asBuildTargetId("web"),
      vendorGate: { kind: "none" },
    },
    engineBinding: {
      engineId: asEngineId("native"),
      bindingDigest: fixtureDigest("engine-binding-native"),
      supportedTargets: [asBuildTargetId("web"), asBuildTargetId("spark")],
    },
    toolchain: {
      profileId: asToolchainProfileId("web-toolchain"),
      profileDigest: fixtureDigest("toolchain-profile-web"),
      citesToolOperations: [asToolOperationId("build"), asToolOperationId("package")],
    },
  };
}

/** Structurally valid build inputs for a vendor-gated (console-class) target. */
export function fixtureConsoleInputs(vendorId = "nintendo"): BuildInputs {
  const web = fixtureWebInputs();
  return {
    ...web,
    targetProfile: {
      profileId: asProfileInputId("console-vendor"),
      profileDigest: fixtureDigest("target-profile-console"),
      target: asBuildTargetId("console"),
      vendorGate: { kind: "authorized-vendor-sdk", vendorId: asVendorId(vendorId) },
    },
    engineBinding: {
      engineId: asEngineId("vendor-engine"),
      bindingDigest: fixtureDigest("engine-binding-vendor"),
      supportedTargets: [asBuildTargetId("console")],
    },
  };
}

/** A well-formed build request command over the given inputs. */
export function fixtureBuildRequest(inputs: BuildInputs): BuildRequestCommand {
  return {
    kind: "request-build",
    idempotency: {
      scope: "build-request",
      requester: asRequesterId("builder-agent"),
      nonce: asBuildNonce("nonce-0001"),
    },
    inputs,
    parameters: { kind: "record", fields: { "include-debug": { kind: "bool", value: false } } },
    requestedAt: 1_700_000_000_000,
  };
}

/** Caller-supplied-style vendor SDK evidence for console tests (authorization shape only). */
export function fixtureVendorSdkEvidence(inputs: BuildInputs, verdict: "pass" | "fail" = "pass"): VendorSdkEvidence {
  const gate = inputs.targetProfile.vendorGate;
  const vendorId = gate.kind === "authorized-vendor-sdk" ? gate.vendorId : asVendorId("nintendo");
  return {
    kind: "vendor-sdk",
    verdict,
    authorization: {
      vendorId,
      authorizedSdkDigest: fixtureDigest("vendor-authorized-sdk"),
      authorizationDigest: fixtureDigest("vendor-authorization"),
    },
    evidenceDigest: fixtureDigest("vendor-sdk-evidence"),
  };
}

function fixtureArtifacts(inputs: BuildInputs, inputsDigest: ContentDigest): readonly BuildArtifact[] {
  const kinds = ["game.bundle", "assets.pack"] as const;
  return kinds.map((artifactKind, index) => ({
    artifactKind: artifactKind as BuildArtifactKind,
    target: inputs.targetProfile.target,
    bytes: {
      storage: "cas" as const,
      digest: computeDigest({ from: inputsDigest, artifact: index, kind: artifactKind }),
      sizeBytes: 1_048_576 + index,
      mediaType: "application/octet-stream",
    },
  }));
}

function fixtureManifest(buildId: string, inputs: BuildInputs, inputsDigest: ContentDigest): BuildManifest {
  const steps: readonly BuildStepRecord[] = BUILD_STAGES.map((stage) => ({
    stage,
    stageDigest: computeDigest({ stage, inputsDigest }),
  }));
  return {
    buildId: asBuildId(buildId),
    inputsDigest,
    inputs: {
      gameIr: inputs.gameIr.digest,
      packageLock: inputs.packageLock.lockFingerprint,
      targetProfile: inputs.targetProfile.profileDigest,
      engineBinding: inputs.engineBinding.bindingDigest,
      toolchain: inputs.toolchain.profileDigest,
    },
    steps,
    environmentFingerprint: inputs.toolchain.profileDigest,
  };
}

/**
 * The deterministic in-memory fake build executor. Non-gated targets get
 * synthetic evaluation-suite evidence; vendor-gated targets FAIL CLOSED
 * unless the caller supplies vendor-sdk evidence (the fake never
 * fabricates authorization, but it does synthesize the deterministic
 * on-target evidence record over its own manifest digest once the vendor
 * side is satisfied).
 */
export function fakeBuildExecutor(): BuildExecutor {
  return {
    execute(command: BuildExecutionCommand): BuildExecutionResult {
      const request = command.request.request;
      if (request.kind !== "request-build") {
        return { ok: false, code: "invalid-command", message: "fake executor only executes build requests" };
      }
      const gate = request.inputs.targetProfile.vendorGate;
      if (gate.kind === "authorized-vendor-sdk") {
        const supplied = command.vendorEvidence ?? [];
        const authorized = supplied.some(
          (record): record is VendorSdkEvidence =>
            record.kind === "vendor-sdk" &&
            record.verdict === "pass" &&
            record.authorization.vendorId === gate.vendorId,
        );
        if (!authorized) {
          return {
            ok: false,
            code: "vendor-evidence-required",
            message: `vendor-gated target requires authorized vendor SDK evidence (vendor "${gate.vendorId}")`,
          };
        }
      }

      const inputsDigest = computeBuildInputsDigest(request.inputs);
      const buildId = command.request.buildId;
      const manifest = fixtureManifest(buildId, request.inputs, inputsDigest);
      const manifestDigest = computeBuildManifestDigest(manifest);
      const verification: VerificationEvidence[] = [
        {
          kind: "evaluation-suite",
          verdict: "pass",
          suite: { suiteId: "suite-smoke", suiteDigest: fixtureDigest("evaluation-suite-smoke") },
          evidenceDigest: fixtureDigest("evaluation-suite-evidence"),
        },
      ];
      if (gate.kind === "authorized-vendor-sdk") {
        verification.push(...(command.vendorEvidence ?? []));
        verification.push({
          kind: "on-target",
          verdict: "pass",
          verifiedDigest: manifestDigest,
          evidenceDigest: computeDigest({ onTarget: manifestDigest }),
        });
      }
      return {
        ok: true,
        outputs: {
          artifacts: fixtureArtifacts(request.inputs, inputsDigest),
          manifest,
          provenance: {
            buildTransformation: {
              kind: "transform",
              description: "deterministic fake build for contract tests",
              tool: "fake-build-executor",
            },
            packageProvenance: [],
            modelProvenance: [],
            generatedByAi: false,
          },
          verification,
        },
      };
    },
  };
}

const FIXTURE_SEMVER: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: [], build: [] };

/** A minimal gate-passing package record (for provenance gate tests), sealed via package-system's own seal discipline. */
export function fixturePackageRecord(id: string, licenseStatus: "verified" | "declared" = "verified"): PackageRecord {
  const unsealed: UnsealedPackageRecord = {
    identity: { kind: "assets", id, version: FIXTURE_SEMVER },
    metadata: {
      dependencies: [],
      providedCapabilities: [],
      requiredCapabilities: [],
      permissions: [],
      license: { spdxExpression: "Apache-2.0", status: licenseStatus },
      provenance: {
        origin: { type: "original" },
        sourceCommit: "0123456789abcdef0123456789abcdef01234567",
        transformationHistory: [{ kind: "author", description: "authored for fixtures" }],
        modelProvenance: [],
        generatedByAi: false,
      },
      lineage: { origin: null, parent: null },
      compatibility: { runtimes: ["interactive"], engines: ["native"], targets: [] },
      resources: {},
      evaluationSuites: [],
      artifacts: [],
      extensionPoints: [],
      overlay: null,
    },
  };
  return sealPackageRecord(unsealed);
}

/** Admission context fixture: every input digest of `inputs` resolvable. */
export function fixtureAdmissionContext(inputs: BuildInputs) {
  const resolvableDigests = new Set<ContentDigest>([
    inputs.gameIr.digest,
    inputs.packageLock.lockFingerprint,
    inputs.targetProfile.profileDigest,
    inputs.engineBinding.bindingDigest,
    inputs.toolchain.profileDigest,
  ]);
  return { resolvableDigests, firstEncounter: null };
}

/** Admits a fixture request and pairs it with a deterministic build id. */
export function fixtureAdmittedBuild(request: BuildRequestCommand, buildId: string) {
  const admission = admitBuildRequest(request, fixtureAdmissionContext(request.inputs));
  if (!admission.ok) {
    throw new Error(`fixture request failed admission: ${admission.code} — ${admission.message}`);
  }
  return { request, buildId: asBuildId(buildId) };
}
