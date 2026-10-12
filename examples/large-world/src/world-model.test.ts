/**
 * WORLD-MODEL TESTS (PL-039; R15, static/runtime) — the derived STATIC
 * side of the large world: the per-chunk streaming contract table, entity
 * placements READ from the document (the document is the entity
 * authority), and the canonical chunk-content projection that publishes
 * into the CAS.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { hashGameIRValue } from "../../../packages/game-ir/src/index.ts";
import { CORE_CHUNK_ID, floraEntityIds, latticeDocument } from "./document.ts";
import { CHUNK_COUNT, chunkIdOf } from "./layout.ts";
import {
  chunkContentDigest,
  chunkPackageId,
  chunkPolicyOf,
  chunkStaticContent,
  deriveWorldModel,
  entityKeyOf,
  isCoreChunk,
  regionPackageId,
  zonePackageId,
} from "./world-model.ts";

test("world-model: derives the full static model from the document", () => {
  const model = deriveWorldModel(latticeDocument());
  assert.equal(model.chunkCount, CHUNK_COUNT);
  assert.equal(model.chunks.length, CHUNK_COUNT);
  assert.equal(model.coreChunkId, CORE_CHUNK_ID);
  assert.ok(isCoreChunk(model, CORE_CHUNK_ID));
  // Every chunk's entities are three flora, placed by the document.
  for (const chunk of model.chunks) {
    assert.deepEqual(chunk.entities.map((entity) => String(entity.ref.entity)), floraEntityIds(chunk.id).map(String));
  }
});

test("world-model: the streaming contract table is deterministic policy, not per-chunk state", () => {
  const model = deriveWorldModel(latticeDocument());
  for (const chunk of model.chunks) {
    const [cx, cy] = chunk.cell.index;
    assert.deepEqual(chunk.policy, chunkPolicyOf(cx, cy), `${chunk.id} must carry its authored policy`);
    const isCore = chunk.id === CORE_CHUNK_ID;
    const coreZone = Math.floor(cx / 2) === 1 && Math.floor(cy / 2) === 1;
    const frontier = cx === 0 || cy === 0 || cx === 7 || cy === 7;
    assert.equal(chunk.policy.streamable, !isCore);
    assert.equal(chunk.policy.cacheable, !frontier);
    assert.equal(chunk.policy.independentlyBuilt, !coreZone);
  }
  // The core chunk (the spawn's chunk) is the always-resident exception.
  assert.deepEqual(chunkPolicyOf(2, 2), { streamable: false, cacheable: true, independentlyBuilt: false });
  // Frontier chunks discard state on stream-out (never cacheable).
  assert.equal(chunkPolicyOf(0, 3).cacheable, false);
  assert.equal(chunkPolicyOf(7, 7).cacheable, false);
});

test("world-model: entity placements are READ from the document (the static authority)", () => {
  const document = latticeDocument();
  const model = deriveWorldModel(document);
  const viewpointNode = document.nodes.find((node) => node.kind === "entity" && String(node.entity) === "entity-viewpoint");
  if (viewpointNode?.kind !== "entity") throw new Error("viewpoint node missing");
  assert.deepEqual(model.viewpoint.state, viewpointNode.state);
  const floraNode = document.nodes.find((node) => node.kind === "entity" && String(node.entity) === "entity-4-4-2");
  if (floraNode?.kind !== "entity") throw new Error("flora node missing");
  const chunk = model.byChunkId.get(chunkIdOf(4, 4));
  if (chunk === undefined) throw new Error("chunk-4-4 missing");
  const placement = chunk.entities.find((entity) => String(entity.ref.entity) === "entity-4-4-2");
  if (placement === undefined) throw new Error("placement missing");
  assert.deepEqual(placement.state, floraNode.state);
});

test("world-model: package coordinates are canonical and deterministic", () => {
  const model = deriveWorldModel(latticeDocument());
  assert.equal(chunkPackageId("chunk-3-6"), "@lattice/chunk-3-6");
  assert.equal(zonePackageId("zone-1-1"), "@lattice/zone-1-1");
  assert.equal(regionPackageId("region-0-0"), "@lattice/region-0-0");
  for (const chunk of model.chunks) {
    assert.equal(chunk.packageId, chunkPackageId(chunk.id));
    assert.equal(chunk.zoneId, chunk.cell.zoneId);
    assert.equal(chunk.regionId, chunk.cell.regionId);
  }
});

test("world-model: chunk static content keys entities by canonical path; digests are stable", () => {
  const model = deriveWorldModel(latticeDocument());
  for (const chunkId of ["chunk-2-2", "chunk-5-5", "chunk-0-7"]) {
    const content = chunkStaticContent(model, chunkId);
    if (content.kind !== "record") throw new Error("content must be a record");
    const chunk = model.byChunkId.get(chunkId);
    if (chunk === undefined) throw new Error("chunk missing");
    assert.deepEqual(
      Object.keys(content.fields).sort(),
      chunk.entities.map((entity) => entityKeyOf(entity.ref)).sort(),
    );
    assert.equal(chunkContentDigest(content), hashGameIRValue(chunkStaticContent(model, chunkId)));
  }
});

test("world-model: deriving twice yields identical static data (E9)", () => {
  const first = deriveWorldModel(latticeDocument());
  const second = deriveWorldModel(latticeDocument());
  assert.deepEqual(first, second);
});
