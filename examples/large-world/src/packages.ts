/**
 * LATTICE — the world as a federated package graph (PL-039; §Package
 * Graph, §Scalability, E7).
 *
 * "A large world as many packages": the lattice's static content is
 * split across 87 immutable, versioned, content-addressed packages —
 * 64 chunk packages (each carrying its entity placements as a CAS
 * content blob plus a binary relief artifact), 16 zone packages, 4
 * region packages, the shared rules package, the viewpoint avatar
 * package and the world package that composes them all. Dependencies
 * point downward (world → regions → zones → chunks); the game lock pins
 * every exact version + content digest (lock rule 10).
 *
 * Publication goes through the REAL package authorities (PL-011):
 * `publishPackage` verifies the declared CAS artifacts, stores the
 * record's content bytes in the artifact store and publishes through the
 * package registry — whose own admission runs the provenance/licensing
 * RELEASE GATE (R19, fail-closed). Chunk content digests equal the CAS
 * blob digests of the canonical content bytes (the PL-011 binding
 * invariant).
 *
 * Determinism (E9): every digest is content-derived; the same model
 * always publishes, stores and pins identically. The stores are the
 * packages' own in-memory fakes (clearly labeled; no disk, no network).
 */

import { canonicalJson, sealPackageRecord } from "../../../packages/package-system/src/index.ts";
import type {
  PackageArtifact,
  PackageLock,
  PackageRecord,
  SemanticVersion,
  UnsealedPackageRecord,
} from "../../../packages/package-system/src/index.ts";
import { createArtifactStore } from "../../../packages/artifact-store/src/index.ts";
import type { ArtifactStore } from "../../../packages/artifact-store/src/index.ts";
import { InMemoryRegistryStore, openRegistry, publishPackage, verifyLockAgainstStores } from "../../../packages/package-registry/src/index.ts";
import type { PackageRegistry, LockStoreVerification } from "../../../packages/package-registry/src/index.ts";
import { encodeGameIRValue, decodeGameIRValue } from "../../../packages/simulation/src/index.ts";
import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { LATTICE_COMMIT, TENANT_NAME } from "./ids.ts";
import {
  RULES_PACKAGE_ID,
  VIEWPOINT_PACKAGE_ID,
  WORLD_PACKAGE_ID,
  chunkPackageId,
  chunkStaticContent,
  entityKeyOf,
  regionPackageId,
  zonePackageId,
} from "./world-model.ts";
import type { LatticeWorldModel } from "./world-model.ts";
import type { ChunkStaticResolver } from "./streaming.ts";

/** The single version every lattice package publishes (E9: pinned). */
const VERSION: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: [], build: [] };

/** The total package count of the world graph (1 world + 1 rules + 1 avatar + 4 regions + 16 zones + 64 chunks). */
export const LATTICE_PACKAGE_COUNT = 87;

/** A typed publication refusal (the failing stage surfaces verbatim). */
export interface PublicationRefusal {
  readonly ok: false;
  /** The refusing authority stage (package-registry's own vocabulary). */
  readonly stage: "cas" | "registry" | "artifact-verification";
  readonly packageId: string;
  readonly detail: string;
}

/** The published world graph: records + lock + the authorities + the streaming resolver. */
export interface LatticeWorldGraph {
  readonly ok: true;
  readonly registry: PackageRegistry;
  readonly artifacts: ArtifactStore;
  readonly records: readonly PackageRecord[];
  readonly lock: PackageLock;
  readonly resolver: ChunkStaticResolver & { readonly calls: readonly string[] };
  /** Chunk id → content digest (bare sha256 hex of the chunk's static content value). */
  readonly chunkContentDigests: ReadonlyMap<string, string>;
}

/** The canonical content bytes of a chunk's static content value. */
export function chunkContentBytes(content: GameIRValue): Uint8Array {
  return new TextEncoder().encode(canonicalJson(encodeGameIRValue(content)));
}

/** The deterministic binary relief artifact bytes of a chunk (E7 fixture content). */
export function chunkReliefBytes(chunkId: string): Uint8Array {
  return new TextEncoder().encode(`lattice/relief/${chunkId}: deterministic heightfield fixture v1`);
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
      sourceCommit: LATTICE_COMMIT,
      transformationHistory: [{ kind: "author", description: "authored for the lattice large-world reference" }],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: {
      runtimes: ["interactive", "simulation"],
      engines: ["native"],
      targets: [
        { profileId: "web", version: VERSION },
        { profileId: "dedicated-server", version: VERSION },
      ],
    },
    resources: {},
    evaluationSuites: [],
    artifacts: options.artifacts ?? [],
    extensionPoints: [],
    overlay: null,
  };
}

/** The chunk ids of one zone (deterministic order). */
function chunkIdsOfZone(model: LatticeWorldModel, zoneId: string): readonly string[] {
  return model.layout.zones.find((zone) => zone.id === zoneId)?.chunkIds ?? [];
}

/** The zone ids of one region (deterministic order). */
function zoneIdsOfRegion(model: LatticeWorldModel, regionId: string): readonly string[] {
  return model.layout.regions.find((region) => region.id === regionId)?.zoneIds ?? [];
}

/**
 * Publishes the whole world graph through the real authorities:
 * CAS blobs first (content + relief per chunk, the document blob for the
 * world package), then records in id-sorted order, then the lock.
 */
export async function publishLatticeWorld(model: LatticeWorldModel, documentBytes: Uint8Array): Promise<LatticeWorldGraph | PublicationRefusal> {
  const artifacts = createArtifactStore();
  const opened = await openRegistry({ store: new InMemoryRegistryStore() });
  if (!opened.ok) {
    return { ok: false, stage: "registry", packageId: "-", detail: opened.message };
  }
  const registry = opened.registry;

  // 1. CAS blobs: per-chunk static content (json) + relief (binary, E7).
  const contentDigests = new Map<string, string>();
  const chunkArtifacts = new Map<string, PackageArtifact[]>();
  for (const chunk of model.chunks) {
    const content = chunkStaticContent(model, chunk.id);
    const contentStored = artifacts.store(chunkContentBytes(content), { mediaType: "application/json" });
    if (!contentStored.ok) {
      return { ok: false, stage: "cas", packageId: chunk.packageId, detail: contentStored.message };
    }
    const reliefStored = artifacts.store(chunkReliefBytes(chunk.id), { mediaType: "application/octet-stream" });
    if (!reliefStored.ok) {
      return { ok: false, stage: "cas", packageId: chunk.packageId, detail: reliefStored.message };
    }
    contentDigests.set(chunk.id, contentStored.manifest.digest.slice("sha256:".length));
    chunkArtifacts.set(chunk.id, [
      { storage: "cas", digest: contentStored.manifest.digest, sizeBytes: contentStored.manifest.sizeBytes, mediaType: "application/json" },
      { storage: "cas", digest: reliefStored.manifest.digest, sizeBytes: reliefStored.manifest.sizeBytes, mediaType: "application/octet-stream" },
    ]);
  }
  const documentStored = artifacts.store(documentBytes, { mediaType: "application/json" });
  if (!documentStored.ok) {
    return { ok: false, stage: "cas", packageId: WORLD_PACKAGE_ID, detail: documentStored.message };
  }

  // 2. Records: leaves first conceptually, but sealed + published id-sorted (E9).
  const unsealed: UnsealedPackageRecord[] = [];
  for (const chunk of model.chunks) {
    unsealed.push({
      identity: { kind: "world", id: chunk.packageId, version: VERSION },
      metadata: baseMetadata({ artifacts: chunkArtifacts.get(chunk.id) }),
    });
  }
  for (const zone of model.layout.zones) {
    unsealed.push({
      identity: { kind: "world", id: zonePackageId(zone.id), version: VERSION },
      metadata: baseMetadata({
        dependencies: chunkIdsOfZone(model, zone.id).map((chunkId) => ({
          id: chunkPackageId(chunkId),
          constraint: "^1.0.0",
          kind: "world",
          optional: false,
        })),
      }),
    });
  }
  for (const region of model.layout.regions) {
    unsealed.push({
      identity: { kind: "world", id: regionPackageId(region.id), version: VERSION },
      metadata: baseMetadata({
        dependencies: zoneIdsOfRegion(model, region.id).map((zoneId) => ({
          id: zonePackageId(zoneId),
          constraint: "^1.0.0",
          kind: "world",
          optional: false,
        })),
      }),
    });
  }
  unsealed.push({ identity: { kind: "system", id: RULES_PACKAGE_ID, version: VERSION }, metadata: baseMetadata() });
  unsealed.push({ identity: { kind: "avatar", id: VIEWPOINT_PACKAGE_ID, version: VERSION }, metadata: baseMetadata() });
  unsealed.push({
    identity: { kind: "world", id: WORLD_PACKAGE_ID, version: VERSION },
    metadata: baseMetadata({
      artifacts: [
        { storage: "cas", digest: documentStored.manifest.digest, sizeBytes: documentStored.manifest.sizeBytes, mediaType: "application/json" },
      ],
      dependencies: [
        ...model.layout.regions.map((region) => ({ id: regionPackageId(region.id), constraint: "^1.0.0", kind: "world" as const, optional: false })),
        { id: RULES_PACKAGE_ID, constraint: "^1.0.0", kind: "system", optional: false },
        { id: VIEWPOINT_PACKAGE_ID, constraint: "^1.0.0", kind: "avatar", optional: false },
      ],
    }),
  });

  const records = unsealed
    .sort((a, b) => (a.identity.id < b.identity.id ? -1 : a.identity.id > b.identity.id ? 1 : 0))
    .map((record) => sealPackageRecord(record));
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
      resolvedFrom: `registry://${TENANT_NAME}`,
    })),
    hostCapabilities: [],
  };

  return { ok: true, registry, artifacts, records, lock, resolver: createChunkResolver(model, registry, artifacts), chunkContentDigests: contentDigests };
}

/** Verifies the lock against BOTH authorities (registry + CAS) — lock rule 10. */
export function verifyLatticeLock(graph: LatticeWorldGraph): LockStoreVerification {
  return verifyLockAgainstStores(graph.lock, { registry: graph.registry, artifacts: graph.artifacts });
}

/**
 * The CAS-backed chunk-content resolver: chunk package record → CAS
 * content blob → decoded entity placements. Fresh loads stream through
 * THIS path (E7 discipline); the call log makes resolution observable.
 */
export function createChunkResolver(model: LatticeWorldModel, registry: PackageRegistry, artifacts: ArtifactStore): ChunkStaticResolver & { readonly calls: readonly string[] } {
  const calls: string[] = [];
  return {
    get calls() {
      return calls;
    },
    resolve(chunkId: string) {
      const chunk = model.byChunkId.get(chunkId);
      if (chunk === undefined) {
        return { ok: false, code: "chunk-unknown", detail: `chunk ${chunkId} is not part of the world model` };
      }
      const record = registry.get({ kind: "world", id: chunk.packageId, version: VERSION });
      if (record === null) {
        return { ok: false, code: "chunk-unpublished", detail: `chunk package ${chunk.packageId} is not published in the registry` };
      }
      const reference = record.metadata.artifacts.find(
        (artifact): artifact is Extract<PackageArtifact, { storage: "cas" }> =>
          artifact.storage === "cas" && artifact.mediaType === "application/json",
      );
      if (reference === undefined) {
        return { ok: false, code: "chunk-content-corrupt", detail: `chunk package ${chunk.packageId} declares no CAS content artifact` };
      }
      const fetched = artifacts.fetch(reference.digest);
      if (!fetched.ok) {
        return { ok: false, code: "chunk-content-corrupt", detail: `CAS fetch of ${String(reference.digest)} failed: ${fetched.message}` };
      }
      let content: GameIRValue;
      try {
        content = decodeGameIRValue(JSON.parse(new TextDecoder().decode(fetched.bytes)));
      } catch (error) {
        return { ok: false, code: "chunk-content-corrupt", detail: `chunk content bytes did not decode: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (content.kind !== "record") {
        return { ok: false, code: "chunk-content-corrupt", detail: `chunk content of ${chunkId} is not a record value` };
      }
      calls.push(chunkId);
      return {
        ok: true,
        content: {
          chunkId,
          entities: Object.entries(content.fields).flatMap(([key, state]) => (state === undefined ? [] : [{ key, state }])),
        },
      };
    },
  };
}

/** Projects one entity key back to its chunk-relative view (diagnostics). */
export function entityKeysOfChunk(model: LatticeWorldModel, chunkId: string): readonly string[] {
  const chunk = model.byChunkId.get(chunkId);
  if (chunk === undefined) return [];
  return chunk.entities.map((entity) => entityKeyOf(entity.ref)).sort();
}
