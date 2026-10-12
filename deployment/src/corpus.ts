/**
 * THE DETERMINISTIC TOPOLOGY CORPUS (PL-044) — the sealed evidence this
 * repo's honest deployment topology is built from, and the host doors a
 * verifier run binds (E9: every digest is derived at runtime through the
 * OWNING package's own authorities — package records via package-system's
 * `sealPackageRecord`, target profiles via target-profiles'
 * `sealTargetProfileRecord`; never hand-written literals).
 *
 * E11 HONESTY: the doors below are the packages' own PUBLIC in-memory
 * implementations (package-registry's pure index, artifact-store's
 * in-memory-first store, target-builds' in-memory profile source — the
 * last clearly labeled a TEST DOUBLE upstream). There is no real
 * infrastructure, no network, no container orchestrator and no secrets
 * store here; a real deployment binds the SAME door interfaces to real
 * infrastructure. The committed manifest
 * (`deployment/manifests/deployment-plan.json`) is the verified evidence
 * this corpus deterministically produces.
 */

import { computeDigest, parseSemver, sealPackageRecord } from "../../packages/package-system/src/index.ts";
import type { PackageMetadata, PackageRecord, UnsealedPackageRecord } from "../../packages/package-system/src/index.ts";
import { createRegistryIndex } from "../../packages/package-registry/src/index.ts";
import { publishRecordToCas } from "../../packages/package-registry/src/index.ts";
import { createArtifactStore } from "../../packages/artifact-store/src/index.ts";
import { createMemoryProfileSource } from "../../packages/target-builds/src/index.ts";
import type { TargetProfileBundle } from "../../packages/target-builds/src/index.ts";
import { asEngineId, asProfileDigest, sealTargetProfileRecord } from "../../packages/target-profiles/src/index.ts";
import type { TargetCapabilities, TargetProfileRecord, UnsealedTargetProfileRecord } from "../../packages/target-profiles/src/index.ts";
import { asDigest, asTargetProfileId } from "../../packages/runtime-contracts/src/index.ts";
import { asSubjectId, asTenantId } from "../../packages/platform-contracts/src/index.ts";
import type { DeploymentDoors } from "./ports.ts";
import { DEPLOYMENT_TRUTH } from "./model.ts";
import type { DeploymentPlan, DeploymentUnit } from "./model.ts";

/** The tenant this repo's honest topology deploys under (R20). */
export const DEPLOYMENT_TENANT = asTenantId("tenant-ops")!;

/** The deploying subject: the tenant's rights-admin (security-gameos role seam). */
export const DEPLOYMENT_SUBMITTER_SUBJECT = asSubjectId("subject-ops-deployer")!;

/** The service identities holding each unit's least-privilege grants. */
export const OPS_RUNTIME_SUBJECT = asSubjectId("subject-ops-runtime")!;
export const WEB_HOST_SUBJECT = asSubjectId("subject-web-host")!;
export const ECONOMY_SERVICE_SUBJECT = asSubjectId("subject-economy-service")!;
export const INTEGRITY_SERVICE_SUBJECT = asSubjectId("subject-integrity-service")!;

/** Fixture commit of the corpus (lineage evidence, R19). */
export const DEPLOYMENT_CORPUS_COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** The stable plan id of this repo's honest topology. */
export const DEPLOYMENT_PLAN_ID = "plan-playliquid-honest-topology";

/** A deterministic bare-hex digest seed (runtime-contracts Digest format). */
function bareDigestOf(seed: string): string {
  return computeDigest({ corpus: seed }).slice("sha256:".length);
}

/** Corpus metadata: verified Apache-2.0 + complete original provenance (R19). */
function corpusMetadata(overrides?: Partial<PackageMetadata>): PackageMetadata {
  return {
    dependencies: [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: "verified" },
    provenance: {
      origin: { type: "original" },
      sourceCommit: DEPLOYMENT_CORPUS_COMMIT,
      transformationHistory: [{ kind: "author", description: "authored for the deployment topology corpus" }],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ["simulation"], engines: ["native"], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [],
    extensionPoints: [],
    overlay: null,
    ...overrides,
  };
}

/** Seals one corpus package record (kind `system`, deterministic, E9). */
export function sealCorpusRecord(id: string, overrides?: Partial<PackageMetadata>): PackageRecord {
  const unsealed: UnsealedPackageRecord = {
    identity: { kind: "system", id, version: parseSemver("1.0.0")! },
    metadata: corpusMetadata(overrides),
  };
  return sealPackageRecord(unsealed);
}

/** The sealed web profile bundle (frozen taxonomy target `web`). */
function webProfileBundle(): TargetProfileBundle {
  return bundleFor("web", "desktop-first", "any", "16:9", {
    render: "webgpu",
    vramClass: "medium",
    inputModalities: ["keyboard", "mouse"],
    screen: { touch: false, refreshHz: 60 },
  } as TargetCapabilities);
}

/** The sealed dedicated-server profile bundle (headless, no render API). */
function serverProfileBundle(): TargetProfileBundle {
  return bundleFor("dedicated-server", "headless-server", "any", "n/a", {
    render: "none",
    vramClass: "none",
    inputModalities: ["none"],
    screen: { touch: false },
  } as TargetCapabilities);
}

function bundleFor(
  target: "web" | "dedicated-server",
  formFactor: "desktop-first" | "headless-server",
  orientation: "any",
  aspectRatio: string,
  capabilities: TargetCapabilities,
): TargetProfileBundle {
  const unsealed: UnsealedTargetProfileRecord = {
    profileId: asTargetProfileId(`${target}-default`),
    target,
    formFactor,
    orientation,
    aspectRatio,
    version: "1.0.0",
    capabilities,
    runtimePolicy: { runtimes: target === "web" ? ["interactive"] : ["simulation"], policy: { policyId: `policy-${target}-default`, revisionDigest: asDigest(bareDigestOf(`runtime-policy:${target}`)) } },
    engineBindings: { engines: [asEngineId(target === "web" ? "playcanvas" : "native")], pinnedBindings: null },
    evaluationSuites: [{ suiteId: `suite-${target}-smoke`, suiteDigest: asProfileDigest(computeDigest({ corpus: `evaluation-suite:${target}` })) }],
    supersedes: null,
  };
  return { record: sealTargetProfileRecord(unsealed) as TargetProfileRecord, vendorGate: { kind: "none" } };
}

/** One topology unit pinned to its sealed record. */
function unitOf(
  unitId: string,
  kind: DeploymentUnit["kind"],
  target: DeploymentUnit["target"],
  healthGates: readonly DeploymentUnit["healthGates"][number][],
  rightsScope: readonly DeploymentUnit["rightsScope"][number][],
  record: PackageRecord,
): { unit: DeploymentUnit; record: PackageRecord } {
  return {
    unit: {
      unitId,
      kind,
      tenant: DEPLOYMENT_TENANT,
      artifactDigest: record.identity.contentDigest,
      target,
      healthGates,
      rightsScope,
    },
    record,
  };
}

/**
 * THE honest topology of THIS repo (7 units): the ops service, the web
 * host composition, and the platform services behind the services/ops
 * health doors. Health gates cite the doors each unit's readiness
 * actually depends on; rights scopes are the least-privilege platform
 * grants each service identity holds (R20; infrastructure units declare
 * NONE — default deny, the honest minimum).
 */
export function honestTopologyUnits(): readonly { unit: DeploymentUnit; record: PackageRecord }[] {
  return [
    unitOf("unit-ops-service", "ops-service", "dedicated-server",
      ["package-registry", "artifact-cas", "build-orchestrator", "rights-authority", "platform-economy", "platform-integrity", "ops-worker-journal"],
      [
        { tenant: DEPLOYMENT_TENANT, subject: OPS_RUNTIME_SUBJECT, capability: "integrity", permissions: ["read"] },
        { tenant: DEPLOYMENT_TENANT, subject: OPS_RUNTIME_SUBJECT, capability: "analytics", permissions: ["read"] },
      ],
      sealCorpusRecord("playliquid.ops-service")),
    unitOf("unit-web-host", "web-host", "web",
      ["web-host-composition", "artifact-cas"],
      [
        { tenant: DEPLOYMENT_TENANT, subject: WEB_HOST_SUBJECT, capability: "social", permissions: ["read"] },
      ],
      sealCorpusRecord("playliquid.web-host")),
    unitOf("unit-platform-registry", "platform-service", "dedicated-server",
      ["package-registry", "artifact-cas"], [], sealCorpusRecord("playliquid.platform-registry")),
    unitOf("unit-build-orchestrator", "platform-service", "dedicated-server",
      ["build-orchestrator"], [], sealCorpusRecord("playliquid.build-orchestrator")),
    unitOf("unit-rights-authority", "platform-service", "dedicated-server",
      ["rights-authority"], [], sealCorpusRecord("playliquid.rights-authority")),
    unitOf("unit-platform-economy", "platform-service", "dedicated-server",
      ["platform-economy"],
      [
        { tenant: DEPLOYMENT_TENANT, subject: ECONOMY_SERVICE_SUBJECT, capability: "rewards", permissions: ["administer"] },
      ],
      sealCorpusRecord("playliquid.platform-economy")),
    unitOf("unit-platform-integrity", "platform-service", "dedicated-server",
      ["platform-integrity"],
      [
        { tenant: DEPLOYMENT_TENANT, subject: INTEGRITY_SERVICE_SUBJECT, capability: "integrity", permissions: ["administer"] },
      ],
      sealCorpusRecord("playliquid.integrity-service")),
  ];
}

/** THE deployment plan for this repo's honest topology (deterministic, E9). */
export function honestTopologyPlan(): DeploymentPlan {
  return {
    planId: DEPLOYMENT_PLAN_ID,
    tenant: DEPLOYMENT_TENANT,
    submittedBy: {
      subject: DEPLOYMENT_SUBMITTER_SUBJECT,
      grants: [{ tenant: DEPLOYMENT_TENANT, subject: DEPLOYMENT_SUBMITTER_SUBJECT, role: "rights-admin" }],
    },
    units: honestTopologyUnits().map((entry) => entry.unit),
    truth: DEPLOYMENT_TRUTH,
  };
}

/** The corpus profile source: the sealed web + dedicated-server bundles. */
export function createCorpusProfiles(): DeploymentDoors["profiles"] {
  return createMemoryProfileSource([["web", webProfileBundle()], ["dedicated-server", serverProfileBundle()]]);
}

/**
 * Binds the host doors over the corpus: the pure registry index (release
 * gate ENFORCED — every corpus record passes it), the artifact store
 * holding every record's content blob, and the profile source serving
 * the sealed web + dedicated-server bundles.
 */
export function createCorpusDoors(): DeploymentDoors & { readonly records: readonly PackageRecord[] } {
  const registry = createRegistryIndex();
  const cas = createArtifactStore();
  const entries = honestTopologyUnits();
  for (const { record } of entries) {
    const published = registry.publish(record);
    if (!published.ok) throw new Error(`corpus record ${record.identity.id} failed registry admission: ${published.ok ? "" : published.message}`);
    const stored = publishRecordToCas(cas, record);
    if (!stored.ok) throw new Error(`corpus record ${record.identity.id} failed CAS publication: ${stored.ok ? "" : stored.message}`);
  }
  return {
    registry,
    cas,
    profiles: createCorpusProfiles(),
    records: entries.map((entry) => entry.record),
  };
}
