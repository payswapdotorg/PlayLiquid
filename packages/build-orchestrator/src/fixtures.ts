/**
 * Deterministic in-memory fixtures for the build orchestrator's tests and
 * harness (house pattern; NOT exported from the package barrel — see
 * build-contracts' fixtures.ts). Every digest is derived from its inputs
 * through package-system's `computeDigest` (never fabricated literals);
 * every package record is sealed via package-system's own seal
 * discipline; the vendor evidence records are shape-only test doubles
 * clearly labeled as such (authorization is NEVER simulated as real —
 * lock rule 24, E11).
 */

import {
  asBuildId,
  asBuildNonce,
  asBuildTargetId,
  asEngineId,
  asProfileInputId,
  asRequesterId,
  asToolOperationId,
  asToolchainProfileId,
  asVendorId,
  BUILD_STAGES,
  computeBuildInputsDigest,
  computeBuildManifestDigest,
} from "@playliquid/build-contracts";
import type {
  BuildInputs,
  BuildRequestCommand,
  BuildStage,
  BuildStepRecord,
  OnTargetEvidence,
  VendorSdkEvidence,
  VerificationEvidence,
} from "@playliquid/build-contracts";
import {
  computeLockFingerprint,
  computeDigest,
  sealPackageRecord,
} from "@playliquid/package-system";
import type {
  ContentDigest,
  PackageLock,
  PackageRecord,
  SemanticVersion,
  UnsealedPackageRecord,
} from "@playliquid/package-system";
import type { BuildEvent, StageCompletedDetail } from "./events.ts";
import { computeBuildPlan } from "./plan.ts";
import { packageStageDigest } from "./stages.ts";

/** A stable, digest-derived content digest for fixtures (no hand-written digests). */
export function fixtureDigest(seed: string): ContentDigest {
  return computeDigest({ fixture: seed });
}

const FIXTURE_SEMVER: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: [], build: [] };

/** Options of {@link fixturePackageRecord}. */
export interface FixtureRecordOptions {
  /** `declared` (unverified) license status fails the R19 build gate on purpose. */
  readonly licenseStatus?: "verified" | "declared";
  /** Marks the record as AI-generated (with a model provenance entry). */
  readonly generatedByAi?: boolean;
}

/**
 * A minimal gate-passing package record (license `verified` default),
 * sealed via package-system's own seal discipline. Passing
 * `licenseStatus: "declared"` produces a record that FAILS the R19 build
 * provenance gate — for refusal tests.
 */
export function fixturePackageRecord(id: string, options: FixtureRecordOptions = {}): PackageRecord {
  const unsealed: UnsealedPackageRecord = {
    identity: { kind: "assets", id, version: FIXTURE_SEMVER },
    metadata: {
      dependencies: [],
      providedCapabilities: [],
      requiredCapabilities: [],
      permissions: [],
      license: { spdxExpression: "Apache-2.0", status: options.licenseStatus ?? "verified" },
      provenance: {
        origin: { type: "original" },
        sourceCommit: "0123456789abcdef0123456789abcdef01234567",
        transformationHistory: [{ kind: "author", description: "authored for fixtures" }],
        modelProvenance: options.generatedByAi === true
          ? [{ model: "fixture-model", provider: "fixture-provider", usage: "assistance", disclosed: true }]
          : [],
        generatedByAi: options.generatedByAi === true,
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

/** Two sealed, gate-passing fixture records (an assets pack and a logic pack). */
export function fixtureRecords(): readonly PackageRecord[] {
  return [fixturePackageRecord("fixture-assets-pack"), fixturePackageRecord("fixture-logic-pack")];
}

/** A lock pinning exactly `records` (fingerprint derived, never hand-written). */
export function fixtureLock(records: readonly PackageRecord[]): PackageLock {
  return {
    lockVersion: 1,
    packages: records.map((record) => ({
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
      contentDigest: record.identity.contentDigest,
    })),
    hostCapabilities: [],
  };
}

/** Options of {@link fixtureWebBuildInputs}. */
export interface FixtureInputsOptions {
  /** Cited tool operations of the toolchain profile (default build/test/package). */
  readonly operations?: readonly string[];
  /** Overrides for individual input refs (tests compose refusals). */
  readonly over?: {
    readonly gameIrDigest?: ContentDigest;
    readonly lockFingerprint?: ContentDigest;
    readonly profileDigest?: ContentDigest;
    readonly bindingDigest?: ContentDigest;
    readonly toolchainDigest?: ContentDigest;
  };
}

/** Structurally valid build inputs for a non-gated (web) target. */
export function fixtureWebBuildInputs(lock: PackageLock, options: FixtureInputsOptions = {}): BuildInputs {
  const over = options.over ?? {};
  return {
    gameIr: { digest: over.gameIrDigest ?? fixtureDigest("game-ir-composition") },
    packageLock: {
      lockFingerprint: over.lockFingerprint ?? computeLockFingerprint(lock),
      pinnedPackageCount: lock.packages.length,
    },
    targetProfile: {
      profileId: asProfileInputId("web-default"),
      profileDigest: over.profileDigest ?? fixtureDigest("target-profile-web"),
      target: asBuildTargetId("web"),
      vendorGate: { kind: "none" },
    },
    engineBinding: {
      engineId: asEngineId("native"),
      bindingDigest: over.bindingDigest ?? fixtureDigest("engine-binding-native"),
      supportedTargets: [asBuildTargetId("web"), asBuildTargetId("spark")],
    },
    toolchain: {
      profileId: asToolchainProfileId("web-toolchain"),
      profileDigest: over.toolchainDigest ?? fixtureDigest("toolchain-profile-web"),
      citesToolOperations: (options.operations ?? ["build", "test", "package"]).map((operation) => asToolOperationId(operation)),
    },
  };
}

/** Structurally valid build inputs for a vendor-gated (console-class) target. */
export function fixtureConsoleBuildInputs(lock: PackageLock, vendorId = "nintendo"): BuildInputs {
  const web = fixtureWebBuildInputs(lock);
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
export function fixtureBuildRequest(inputs: BuildInputs, over: Partial<BuildRequestCommand> = {}): BuildRequestCommand {
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
    ...over,
  };
}

/** Caller-supplied-style vendor SDK evidence for console tests (authorization SHAPE only — a test double). */
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

/** A passing evaluation-suite evidence record (verify-stage shape). */
export function fixtureEvaluationEvidence(): VerificationEvidence {
  return {
    kind: "evaluation-suite",
    verdict: "pass",
    suite: { suiteId: "suite-smoke", suiteDigest: fixtureDigest("evaluation-suite-smoke") },
    evidenceDigest: fixtureDigest("evaluation-suite-evidence"),
  };
}

/** The on-target PASS record verifying exactly `manifestDigest` (out-of-band vendor pipeline double). */
export function fixtureOnTargetEvidence(manifestDigest: ContentDigest): OnTargetEvidence {
  return {
    kind: "on-target",
    verdict: "pass",
    verifiedDigest: manifestDigest,
    evidenceDigest: computeDigest({ onTarget: manifestDigest }),
  };
}

/** The per-stage digests recorded in a build's `stage-completed` events. */
export function stageDigestsFromEvents(events: readonly BuildEvent[]): Readonly<Record<BuildStage, string>> {
  const byStage: Partial<Record<BuildStage, string>> = {};
  for (const event of events) {
    if (event.type !== "stage-completed") {
      continue;
    }
    const detail = event.detail as StageCompletedDetail | undefined;
    if (detail !== undefined && typeof detail.stage === "string") {
      byStage[detail.stage] = detail.stageDigest;
    }
  }
  return byStage as Record<BuildStage, string>;
}

/** The four host-content blob digests of `inputs` (lock fingerprints resolve via the lock table). */
export function contentDigestsOf(inputs: BuildInputs): readonly ContentDigest[] {
  return [
    inputs.gameIr.digest,
    inputs.targetProfile.profileDigest,
    inputs.engineBinding.bindingDigest,
    inputs.toolchain.profileDigest,
  ];
}

/**
 * The manifest digest a build over `inputs` will carry once it reaches the
 * package stage: the four executed-stage digests are read from the
 * stage-completed events, while the PACKAGE step digest is recomputed from
 * the same deterministic plan the service uses (it is plan-derived by
 * design, so the manifest digest is knowable BEFORE packaging — that is
 * what lets console on-target evidence reference it). This is the digest
 * console on-target evidence must verify — recomputed here with the
 * package's own authorities for tests/harness.
 */
export function expectedManifestDigest(
  buildId: string,
  inputs: BuildInputs,
  stageDigests: Readonly<Record<BuildStage, string>>,
): ContentDigest {
  const plan = computeBuildPlan(
    asBuildId(buildId),
    inputs.targetProfile.target,
    inputs.toolchain.citesToolOperations,
  );
  const steps: readonly BuildStepRecord[] = BUILD_STAGES.map((stage) => ({
    stage,
    stageDigest: stage === "package" ? packageStageDigest(plan) : stageDigests[stage],
  }));
  return computeBuildManifestDigest({
    buildId: asBuildId(buildId),
    inputsDigest: computeBuildInputsDigest(inputs),
    inputs: {
      gameIr: inputs.gameIr.digest,
      packageLock: inputs.packageLock.lockFingerprint,
      targetProfile: inputs.targetProfile.profileDigest,
      engineBinding: inputs.engineBinding.bindingDigest,
      toolchain: inputs.toolchain.profileDigest,
    },
    steps,
    environmentFingerprint: inputs.toolchain.profileDigest,
  });
}
