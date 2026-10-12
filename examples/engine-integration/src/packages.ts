/**
 * FORGE — the registry/CAS stage (PL-038).
 *
 * Every sealed artifact of the workflow lands in the REAL authorities
 * (PL-011): binary content in the REAL artifact store (the CAS, E7) and
 * package records in the REAL package registry over its in-memory store
 * (process-local persistence — the honest test double; E11). Publication
 * runs the registry's own transactional admission: structural validation,
 * the R19 release gate (verified license, provenance, lineage) and the
 * CAS-artifact verification (`publishPackage` refuses a record whose
 * declared artifacts are not in the store — fail closed).
 *
 * The package lock pins exact versions and content digests (lock rule 10)
 * and is verified against BOTH authorities (`verifyLockAgainstStores`).
 *
 * Determinism (E9): every digest is content-derived; the same sealed
 * inputs always publish, pin and verify identically.
 */

import type { GameIRDocument } from "../../../packages/game-ir/src/index.ts";
import { createArtifactStore } from "../../../packages/artifact-store/src/index.ts";
import type { ArtifactStore } from "../../../packages/artifact-store/src/index.ts";
import { computeLockFingerprint, sealPackageRecord } from "../../../packages/package-system/src/index.ts";
import type { ContentDigest, PackageLock, PackageRecord, SemanticVersion, UnsealedPackageRecord } from "../../../packages/package-system/src/index.ts";
import { InMemoryRegistryStore, openRegistry, publishPackage, verifyLockAgainstStores } from "../../../packages/package-registry/src/index.ts";
import type { LockStoreVerification, PackageRegistry } from "../../../packages/package-registry/src/index.ts";
import { FORGE_COMMIT, RECEIPT_MEDIA_TYPE } from "./ids.ts";
import type { SealedAsset } from "./authoring.ts";
import { gameDocumentBytes } from "./game.ts";
import type { WorkflowJournal } from "./journal.ts";

/** The workflow's package ids (pinned order is the lock's canonical order). */
export const PACKAGE_IDS = ["@forge/assets", "@forge/game", "@forge/world"] as const;

const VERSION: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: [], build: [] };

/** The opened authorities: the CAS + the registry (R19 admission included). */
export interface ForgeStores {
  readonly artifacts: ArtifactStore;
  readonly registry: PackageRegistry;
}

/** Opens fresh in-memory-backed authorities (E11: process-local stores). */
export async function openForgeStores(): Promise<ForgeStores> {
  const artifacts = createArtifactStore();
  const opened = await openRegistry({ store: new InMemoryRegistryStore() });
  if (!opened.ok) {
    throw new Error(`fixture registry refused to open: ${opened.message}`);
  }
  return { artifacts, registry: opened.registry };
}

/** R19 provenance metadata shared by every forge package (fail-closed gate material). */
function baseMetadata(options: { artifacts: UnsealedPackageRecord["metadata"]["artifacts"]; dependencies?: UnsealedPackageRecord["metadata"]["dependencies"]; history: UnsealedPackageRecord["metadata"]["provenance"]["transformationHistory"] }): UnsealedPackageRecord["metadata"] {
  return {
    dependencies: options.dependencies ?? [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: "verified" },
    provenance: {
      origin: { type: "original" },
      sourceCommit: FORGE_COMMIT,
      transformationHistory: options.history,
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: {
      runtimes: ["interactive"],
      engines: ["native", "unreal", "unity", "godot"],
      targets: [
        { profileId: "forge-windows", version: VERSION },
        { profileId: "forge-web", version: VERSION },
      ],
    },
    resources: {},
    evaluationSuites: [],
    artifacts: options.artifacts,
    extensionPoints: [],
    overlay: null,
  };
}

/** Stores one blob in the CAS and returns its verified manifest (E7). */
function storeBlob(artifacts: ArtifactStore, bytes: Uint8Array, mediaType: string): { readonly digest: ContentDigest; readonly sizeBytes: number } {
  const stored = artifacts.store(bytes, { mediaType });
  if (!stored.ok) {
    throw new Error(`fixture CAS store refused content: ${stored.message}`);
  }
  return { digest: stored.manifest.digest, sizeBytes: stored.manifest.sizeBytes };
}

/** The published content graph: records + lock + the authorities. */
export interface PublishedContent {
  readonly ok: true;
  readonly records: readonly PackageRecord[];
  readonly lock: PackageLock;
  readonly lockFingerprint: ContentDigest;
}

/** One typed publication refusal (the registry's own door, surfaced). */
export interface PublicationRefusal {
  readonly ok: false;
  readonly stage: "artifact-verification" | "cas" | "registry";
  readonly packageId: string;
  readonly detail: string;
}

/**
 * Publishes the workflow's content packages: the assets pack (the Blender
 * stage's sealed receipts) and the world pack (the GameIR composition,
 * which depends on the assets pack). R19 provenance is the record metadata
 * the registry's release gate adjudicates — nothing is claimed that the
 * workflow did not do.
 */
export async function publishContentPackages(
  stores: ForgeStores,
  sealed: readonly SealedAsset[],
  document: GameIRDocument,
): Promise<PublishedContent | PublicationRefusal> {
  // 1. The assets pack: one CAS artifact per sealed asset receipt.
  const assetRefs = sealed.map((asset) => {
    const stored = storeBlob(stores.artifacts, asset.bytes, RECEIPT_MEDIA_TYPE);
    return { storage: "cas" as const, digest: stored.digest, sizeBytes: stored.sizeBytes, mediaType: RECEIPT_MEDIA_TYPE };
  });
  const assetsRecord = sealPackageRecord({
    identity: { kind: "assets", id: PACKAGE_IDS[0], version: VERSION },
    metadata: baseMetadata({
      artifacts: assetRefs,
      history: [
        { kind: "author", description: "assets authored through the tool.blender adapter over the Tool Fabric runtime (PL-038)", tool: "tool.blender" },
      ],
    }),
  });

  // 2. The world pack: the GameIR composition's canonical bytes.
  const worldBytes = gameDocumentBytes(document);
  const worldRef = storeBlob(stores.artifacts, worldBytes, "application/json");
  const worldRecord = sealPackageRecord({
    identity: { kind: "world", id: PACKAGE_IDS[2], version: VERSION },
    metadata: baseMetadata({
      artifacts: [{ storage: "cas", digest: worldRef.digest, sizeBytes: worldRef.sizeBytes, mediaType: "application/json" }],
      dependencies: [{ id: PACKAGE_IDS[0], constraint: "^1.0.0", kind: "assets", optional: false }],
      history: [{ kind: "author", description: "the forge GameIR composition (engine-independent game content)", tool: "game-ir" }],
    }),
  });

  const records = [assetsRecord, worldRecord];
  for (const record of records) {
    const published = await publishPackage(record, { registry: stores.registry, artifacts: stores.artifacts });
    if (!published.ok) {
      return { ok: false, stage: published.stage, packageId: record.identity.id, detail: published.message };
    }
  }

  const lock: PackageLock = {
    lockVersion: 1,
    packages: records.map((record) => ({
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
      contentDigest: record.identity.contentDigest,
      resolvedFrom: "registry://tenant-forge",
    })),
    hostCapabilities: [],
  };
  return { ok: true, records, lock, lockFingerprint: computeLockFingerprint(lock) };
}

/** Verifies the lock against BOTH authorities (registry + CAS; lock rule 10). */
export function verifyForgeLock(stores: ForgeStores, content: PublishedContent): LockStoreVerification {
  return verifyLockAgainstStores(content.lock, { registry: stores.registry, artifacts: stores.artifacts });
}

/** Journals one published record (E10; the registry's own digest is the evidence). */
export function journalPublication(journal: WorkflowJournal, record: PackageRecord, at: number): void {
  journal.append({
    stage: "seal",
    event: "package-published",
    at,
    detail: { packageId: record.identity.id, contentDigest: record.identity.contentDigest, kind: record.identity.kind },
  });
}

/** The result of publishing the staged build's outputs (the game pack). */
export interface BuildOutputsPublication {
  readonly ok: true;
  readonly record: PackageRecord;
  readonly lock: PackageLock;
  readonly lockFingerprint: ContentDigest;
}

/**
 * Publishes the staged build's outputs as the game pack: the build's
 * artifacts (already CAS-stored by the build fabric port) declared by a
 * record with R19 provenance recording the REAL transformation — the
 * build-orchestrator staged pipeline over the engine adapter. The extended
 * lock now pins assets → world → game.
 */
export async function publishBuildOutputs(
  stores: ForgeStores,
  content: PublishedContent,
  artifacts: readonly { readonly digest: ContentDigest; readonly sizeBytes: number; readonly mediaType: string }[],
): Promise<BuildOutputsPublication | PublicationRefusal> {
  const gameRecord = sealPackageRecord({
    identity: { kind: "game", id: PACKAGE_IDS[1], version: VERSION },
    metadata: baseMetadata({
      artifacts: artifacts.map((artifact) => ({ storage: "cas" as const, digest: artifact.digest, sizeBytes: artifact.sizeBytes, mediaType: artifact.mediaType })),
      dependencies: [{ id: PACKAGE_IDS[2], constraint: "^1.0.0", kind: "world", optional: false }],
      history: [
        { kind: "transform", description: "staged build through the build-orchestrator pipeline over the engine.unreal adapter (PL-038)", tool: "build-orchestrator" },
      ],
    }),
  });
  const published = await publishPackage(gameRecord, { registry: stores.registry, artifacts: stores.artifacts });
  if (!published.ok) {
    return { ok: false, stage: published.stage, packageId: gameRecord.identity.id, detail: published.message };
  }
  const records = [...content.records, gameRecord];
  const lock: PackageLock = {
    lockVersion: 1,
    packages: records.map((record) => ({
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
      contentDigest: record.identity.contentDigest,
      resolvedFrom: "registry://tenant-forge",
    })),
    hostCapabilities: [],
  };
  return { ok: true, record: gameRecord, lock, lockFingerprint: computeLockFingerprint(lock) };
}
