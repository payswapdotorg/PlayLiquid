/**
 * LUMEN RUN — the game's packages (PL-037).
 *
 * "Everything reusable is a package" (§Game model, lock rule 7): the
 * game composes over three immutable, versioned, content-addressed
 * packages — the world pack (semantic content digest of the GameIR
 * document), the assets pack (CAS-backed binary artifacts, E7) and the
 * avatar pack (the portable companion, R5).
 *
 * Publication goes through the REAL package authorities (PL-011):
 * `publishPackage` verifies the declared CAS artifacts, stores the
 * record's content bytes in the artifact store and publishes the record
 * through the package registry — whose own admission runs the
 * provenance/licensing RELEASE GATE (R19: an unverified license is
 * refused at the door, fail-closed). The game lock pins exact versions
 * and content digests (lock rule 10) and is verified against BOTH
 * authorities (`verifyLockAgainstStores`).
 *
 * Determinism (E9): every digest is content-derived; the same records
 * always seal, store and pin identically. The stores are the packages'
 * own in-memory fakes (clearly labeled test doubles; no disk, no
 * network — see the README's honest scope statement).
 */

import { canonicalValueForm } from "../../../packages/game-ir/src/index.ts";
import type { GameIRDocument, GameIRNode } from "../../../packages/game-ir/src/index.ts";
import { canonicalJson, sealPackageRecord, computeLockFingerprint } from "../../../packages/package-system/src/index.ts";
import type { ContentDigest, PackageLock, PackageRecord, SemanticVersion, UnsealedPackageRecord } from "../../../packages/package-system/src/index.ts";
import { createArtifactStore } from "../../../packages/artifact-store/src/index.ts";
import type { ArtifactStore } from "../../../packages/artifact-store/src/index.ts";
import { InMemoryRegistryStore, openRegistry, publishPackage, verifyLockAgainstStores } from "../../../packages/package-registry/src/index.ts";
import type { PackageRegistry, LockStoreVerification } from "../../../packages/package-registry/src/index.ts";

/** The game's package set (pinned order is the lock's canonical order). */
export const PACKAGE_IDS = ["@lumen-run/assets", "@lumen-run/avatars", "@lumen-run/world"] as const;

const VERSION: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: [], build: [] };

/** A typed publication refusal (surface for the R19 fail-closed story). */
export interface PackagePublicationRefusal {
  readonly ok: false;
  readonly stage: "artifact-verification" | "cas" | "registry";
  readonly packageId: string;
  readonly detail: string;
}

/** The published package graph: records + lock + the authorities they resolve through. */
export interface PublishedPackages {
  readonly ok: true;
  readonly records: readonly PackageRecord[];
  readonly lock: PackageLock;
  readonly registry: PackageRegistry;
  readonly artifacts: ArtifactStore;
}

/** JSON-safe projection of a game-ir node (entity states via game-ir's canonical form). */
function jsonSafeNode(node: GameIRNode): unknown {
  return node.kind === "entity"
    ? { ...node, state: canonicalValueForm(node.state) }
    : node;
}

/** The world pack's CAS content: canonical bytes of the JSON-safe document. */
export function documentArtifactBytes(document: GameIRDocument): Uint8Array {
  const form = canonicalJson({
    irVersion: document.irVersion,
    identity: document.identity,
    lifecycle: document.lifecycle ?? "active",
    entry: document.entry,
    nodes: document.nodes.map(jsonSafeNode),
  });
  return new TextEncoder().encode(form);
}

/** The assets pack's deterministic binary content (fixture bytes, E7 in CAS). */
function assetBytes(name: string): Uint8Array {
  return new TextEncoder().encode(`lumen-run/${name}: deterministic fixture bytes v1`);
}

function baseMetadata(options: { artifacts?: UnsealedPackageRecord["metadata"]["artifacts"]; dependencies?: UnsealedPackageRecord["metadata"]["dependencies"] } = {}): UnsealedPackageRecord["metadata"] {
  return {
    dependencies: options.dependencies ?? [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: "verified" },
    provenance: {
      origin: { type: "original" },
      sourceCommit: "0f01a2b3c4d5e6f708192a3b4c5d6e7f80912a3b",
      transformationHistory: [{ kind: "author", description: "authored for the lumen-run reference game" }],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: {
      runtimes: ["interactive"],
      engines: ["native"],
      targets: [
        { profileId: "web", version: VERSION },
        { profileId: "spark", version: VERSION },
      ],
    },
    resources: {},
    evaluationSuites: [],
    artifacts: options.artifacts ?? [],
    extensionPoints: [],
    overlay: null,
  };
}

/**
 * Publishes the game's three packages through the real authorities.
 * The artifact store and registry run on their in-memory fakes (host
 * wiring for durable stores is a deployment concern, E6/E11).
 */
export async function publishGamePackages(document: GameIRDocument): Promise<PublishedPackages | PackagePublicationRefusal> {
  const artifacts = createArtifactStore();
  const registryResult = await openRegistry({ store: new InMemoryRegistryStore() });
  if (!registryResult.ok) {
    return { ok: false, stage: "registry", packageId: "-", detail: registryResult.message };
  }
  const registry = registryResult.registry;

  // 1. The assets pack: real CAS blobs (digest + size + media type pins).
  const atlas = artifacts.store(assetBytes("atlas"), { mediaType: "application/octet-stream" });
  const ping = artifacts.store(assetBytes("ping"), { mediaType: "audio/ogg" });
  if (!atlas.ok) return { ok: false, stage: "cas", packageId: PACKAGE_IDS[0], detail: atlas.message };
  if (!ping.ok) return { ok: false, stage: "cas", packageId: PACKAGE_IDS[0], detail: ping.message };
  const assetsRecord = sealPackageRecord({
    identity: { kind: "assets", id: PACKAGE_IDS[0], version: VERSION },
    metadata: baseMetadata({
      artifacts: [
        { storage: "cas", digest: atlas.manifest.digest, sizeBytes: atlas.manifest.sizeBytes, mediaType: "application/octet-stream" },
        { storage: "cas", digest: ping.manifest.digest, sizeBytes: ping.manifest.sizeBytes, mediaType: "audio/ogg" },
      ],
    }),
  });

  // 2. The avatar pack: the portable companion (R5).
  const avatarRecord = sealPackageRecord({
    identity: { kind: "avatar", id: PACKAGE_IDS[1], version: VERSION },
    metadata: baseMetadata(),
  });

  // 3. The world pack: semantic content, depends on the assets pack.
  const worldArtifact = artifacts.store(documentArtifactBytes(document), { mediaType: "application/json" });
  if (!worldArtifact.ok) return { ok: false, stage: "cas", packageId: PACKAGE_IDS[2], detail: worldArtifact.message };
  const worldRecord = sealPackageRecord({
    identity: { kind: "world", id: PACKAGE_IDS[2], version: VERSION },
    metadata: baseMetadata({
      artifacts: [{ storage: "cas", digest: worldArtifact.manifest.digest, sizeBytes: worldArtifact.manifest.sizeBytes, mediaType: "application/json" }],
      dependencies: [{ id: PACKAGE_IDS[0], constraint: "^1.0.0", kind: "assets", optional: false }],
    }),
  });

  const records = [assetsRecord, avatarRecord, worldRecord];
  for (const record of records) {
    const published = await publishPackage(record, { registry, artifacts });
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
      resolvedFrom: "registry://tenant-lumen-run",
    })),
    hostCapabilities: [],
  };
  return { ok: true, records, lock, registry, artifacts };
}

/**
 * Verifies the lock against BOTH authorities (registry + CAS) and the
 * package graph resolution — the composition's pin check (lock rule 10).
 */
export function verifyGameLock(packages: PublishedPackages): LockStoreVerification {
  return verifyLockAgainstStores(packages.lock, { registry: packages.registry, artifacts: packages.artifacts });
}

/** The lock fingerprint (E9: derived, never hand-written). */
export function lockFingerprintOf(packages: PublishedPackages): ContentDigest {
  return computeLockFingerprint(packages.lock);
}
