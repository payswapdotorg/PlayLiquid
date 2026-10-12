/**
 * PACKAGE-GRAPH TESTS (PL-039; E7, E9) — the large world as 87 immutable,
 * versioned, content-addressed packages on the REAL authorities
 * (package-registry + artifact-store): scale, CAS discipline, the
 * chunk-content resolver and lock verification.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLockFingerprint } from "../../../packages/package-system/src/index.ts";
import { decodeGameIRValue } from "../../../packages/simulation/src/index.ts";
import { InMemoryRegistryStore, openRegistry } from "../../../packages/package-registry/src/index.ts";
import { latticeDocument } from "./document.ts";
import { deriveWorldModel } from "./world-model.ts";
import { chunkPackageId, chunkStaticContent, regionPackageId, zonePackageId } from "./world-model.ts";
import { entityKeyOf } from "./world-model.ts";
import { documentArtifactBytes } from "./composition.ts";
import { LATTICE_PACKAGE_COUNT, chunkContentBytes, chunkReliefBytes, createChunkResolver, publishLatticeWorld, verifyLatticeLock } from "./packages.ts";
const MODEL = deriveWorldModel(latticeDocument());

/** Publishes the canonical world graph (the shared fixture of this file). */
async function published() {
  const graph = await publishLatticeWorld(MODEL, documentArtifactBytes(latticeDocument()));
  if (!graph.ok) throw new Error(`publication refused: ${graph.stage} ${graph.packageId} — ${graph.detail}`);
  return graph;
}

test("packages: the world publishes 87 packages (1 world + 1 rules + 1 avatar + 4 regions + 16 zones + 64 chunks)", async () => {
  const graph = await published();
  assert.equal(graph.records.length, LATTICE_PACKAGE_COUNT);
  assert.equal(LATTICE_PACKAGE_COUNT, 87);
  const byKind = new Map<string, number>();
  for (const record of graph.records) {
    byKind.set(record.identity.kind, (byKind.get(record.identity.kind) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries([...byKind.entries()].sort()), { avatar: 1, system: 1, world: 85 });
  // Every package id is distinct and content-addressed.
  const ids = new Set(graph.records.map((record) => record.identity.id));
  assert.equal(ids.size, LATTICE_PACKAGE_COUNT);
  for (const record of graph.records) {
    assert.match(record.identity.contentDigest, /^sha256:[0-9a-f]{64}$/);
  }
  assert.ok(ids.has("@lattice/world"));
  assert.ok(ids.has("@lattice/rules"));
  assert.ok(ids.has("@lattice/viewpoint-avatar"));
  assert.ok(ids.has(regionPackageId("region-0-0")));
  assert.ok(ids.has(zonePackageId("zone-2-3")));
  assert.ok(ids.has(chunkPackageId("chunk-7-7")));
});

test("packages: the dependency graph points downward (world → regions → zones → chunks)", async () => {
  const graph = await published();
  const byId = new Map(graph.records.map((record) => [record.identity.id, record]));
  const world = byId.get("@lattice/world")!;
  assert.deepEqual(
    world.metadata.dependencies.map((dep) => dep.id).sort(),
    ["@lattice/region-0-0", "@lattice/region-0-1", "@lattice/region-1-0", "@lattice/region-1-1", "@lattice/rules", "@lattice/viewpoint-avatar"],
  );
  for (const region of MODEL.layout.regions) {
    const record = byId.get(regionPackageId(region.id))!;
    assert.deepEqual(
      record.metadata.dependencies.map((dep) => dep.id).sort(),
      region.zoneIds.map((zoneId) => zonePackageId(zoneId)).sort(),
    );
  }
  for (const zone of MODEL.layout.zones) {
    const record = byId.get(zonePackageId(zone.id))!;
    assert.deepEqual(
      record.metadata.dependencies.map((dep) => dep.id).sort(),
      zone.chunkIds.map((chunkId) => chunkPackageId(chunkId)).sort(),
    );
  }
  // Leaves depend on nothing.
  for (const chunk of MODEL.chunks) {
    const record = byId.get(chunkPackageId(chunk.id))!;
    assert.equal(record.metadata.dependencies.length, 0);
  }
});

test("packages: chunk content digests equal the CAS blob digests (the PL-011 binding invariant)", async () => {
  const graph = await published();
  assert.equal(graph.chunkContentDigests.size, MODEL.chunkCount);
  for (const chunk of MODEL.chunks) {
    const content = chunkStaticContent(MODEL, chunk.id);
    // The stored CAS blob digest, the map's digest and the canonical bytes of
    // the chunk's static content all address the same bytes, and the blob
    // decodes back to the same value (content-addressed round-trip).
    const stored = graph.artifacts.fetch(`sha256:${graph.chunkContentDigests.get(chunk.id)}`);
    assert.ok(stored.ok, `CAS fetch of ${chunk.id} content refused`);
    assert.deepEqual([...stored.bytes], [...chunkContentBytes(content)]);
    assert.deepEqual(decodeGameIRValue(JSON.parse(new TextDecoder().decode(stored.bytes))), content);
    // Each chunk package ALSO carries a binary relief artifact (E7): the
    // record's CAS pointer resolves to the deterministic relief bytes.
    const record = graph.records.find((candidate) => candidate.identity.id === chunkPackageId(chunk.id))!;
    const reliefRef = record.metadata.artifacts.find((artifact) => artifact.storage === "cas" && artifact.mediaType === "application/octet-stream");
    if (reliefRef === undefined || reliefRef.storage !== "cas") throw new Error(`${chunk.id} declares no CAS relief artifact`);
    const relief = graph.artifacts.fetch(reliefRef.digest);
    assert.ok(relief.ok, `CAS fetch of ${chunk.id} relief refused`);
    assert.deepEqual([...relief.bytes], [...chunkReliefBytes(chunk.id)]);
  }
});

test("packages: the lock pins all 87 packages and verifies against BOTH authorities (lock rule 10)", async () => {
  const graph = await published();
  assert.equal(graph.lock.packages.length, LATTICE_PACKAGE_COUNT);
  const verification = verifyLatticeLock(graph);
  assert.equal(verification.pass, true);
  for (const pin of verification.pins) {
    assert.equal(pin.ok, true, `pin ${String(pin.pin.id)} must verify clean`);
    assert.equal(pin.problems.length, 0, `pin ${String(pin.pin.id)} must verify clean`);
  }
});

test("packages: the resolver streams fresh loads through registry + CAS (observable calls)", async () => {
  const graph = await published();
  const resolved = graph.resolver.resolve("chunk-5-5");
  if (!resolved.ok) throw new Error(`resolve refused: ${resolved.code}`);
  const chunk = MODEL.byChunkId.get("chunk-5-5")!;
  assert.deepEqual(
    resolved.content.entities.map((entity) => entity.key).sort(),
    chunk.entities.map((entity) => entityKeyOf(entity.ref)).sort(),
  );
  // The resolved entity states are the static document states.
  for (const entity of resolved.content.entities) {
    const expected = chunk.entities.find((candidate) => entityKeyOf(candidate.ref) === entity.key);
    assert.deepEqual(entity.state, expected!.state);
  }
  assert.deepEqual(graph.resolver.calls, ["chunk-5-5"]);
});

test("packages: publication is deterministic — two publications seal identical bytes (E9)", async () => {
  const first = await published();
  const second = await published();
  assert.deepEqual(
    first.records.map((record) => ({ id: record.identity.id, digest: record.identity.contentDigest })),
    second.records.map((record) => ({ id: record.identity.id, digest: record.identity.contentDigest })),
  );
  assert.equal(computeLockFingerprint(first.lock), computeLockFingerprint(second.lock));
  assert.deepEqual(
    [...first.chunkContentDigests.entries()].sort(),
    [...second.chunkContentDigests.entries()].sort(),
  );
});

test("packages: the resolver refuses typed — unknown chunk, unpublished package (E8)", async () => {
  const graph = await published();
  const unknown = graph.resolver.resolve("chunk-42-42");
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "chunk-unknown");
  // An empty registry cannot serve ANY chunk — typed, not silent.
  const opened = await openRegistry({ store: new InMemoryRegistryStore() });
  if (!opened.ok) throw new Error("registry refused to open");
  const orphan = createChunkResolver(MODEL, opened.registry, graph.artifacts);
  const refused = orphan.resolve("chunk-5-5");
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, "chunk-unpublished");
});
