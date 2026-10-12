/**
 * SPATIAL LAYOUT TESTS (PL-039; R15) — the pure grid math of the large
 * world: the World → Region → Zone → Chunk hierarchy, typed spatial refs,
 * half-open bounds and the typed out-of-bounds lookup.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHUNK_COUNT,
  CHUNK_SPAN,
  CHUNKS_PER_AXIS,
  REGIONS_PER_AXIS,
  WORLD_BOUNDS,
  ZONES_PER_AXIS,
  chunkBoundsOf,
  chunkIdOf,
  chunkIndexOfPosition,
  chunkRefOf,
  deriveLayout,
  regionIdOf,
  regionIndexOfZone,
  zoneIdOf,
  zoneIndexOfChunk,
} from "./layout.ts";

test("layout: the lattice is 4 regions · 16 zones · 64 chunks of 16-unit cells", () => {
  const layout = deriveLayout();
  assert.equal(layout.chunks.length, CHUNK_COUNT);
  assert.equal(layout.zones.length, ZONES_PER_AXIS * ZONES_PER_AXIS);
  assert.equal(layout.regions.length, REGIONS_PER_AXIS * REGIONS_PER_AXIS);
  assert.equal(CHUNKS_PER_AXIS, 8);
  assert.equal(CHUNK_SPAN, 16);
  assert.deepEqual(WORLD_BOUNDS, { min: [0, 0, 0], max: [128, 128, 16] });
});

test("layout: chunk ids, bounds and hierarchy coordinates agree x-major", () => {
  const layout = deriveLayout();
  const seen = new Set<string>();
  let index = 0;
  for (let cx = 0; cx < CHUNKS_PER_AXIS; cx += 1) {
    for (let cy = 0; cy < CHUNKS_PER_AXIS; cy += 1) {
      const chunk = layout.chunks[index];
      index += 1;
      if (chunk === undefined) throw new Error("layout shorter than the grid");
      assert.equal(chunk.id, chunkIdOf(cx, cy));
      assert.deepEqual(chunk.index, [cx, cy]);
      assert.deepEqual(chunk.bounds, chunkBoundsOf(cx, cy));
      const [zx, zy] = zoneIndexOfChunk(cx, cy);
      assert.equal(chunk.zoneId, zoneIdOf(zx, zy));
      const [rx, ry] = regionIndexOfZone(zx, zy);
      assert.equal(chunk.regionId, regionIdOf(rx, ry));
      // The typed chunk-ref carries the whole hierarchy (R15).
      assert.deepEqual(chunk.ref, chunkRefOf(cx, cy));
      assert.equal(String(chunk.ref.chunk), chunkIdOf(cx, cy));
      assert.equal(String(chunk.ref.zone), zoneIdOf(zx, zy));
      assert.equal(String(chunk.ref.region), regionIdOf(rx, ry));
      seen.add(chunk.id);
    }
  }
  assert.equal(seen.size, CHUNK_COUNT);
  // Chunks are x-major ordered (cx outer, cy inner).
  assert.equal(layout.chunks[0]!.id, "chunk-0-0");
  assert.equal(layout.chunks[1]!.id, "chunk-0-1");
  assert.equal(layout.chunks[8]!.id, "chunk-1-0");
});

test("layout: zones group 2×2 chunks; regions group 2×2 zones (the full R15 tree)", () => {
  const layout = deriveLayout();
  for (const zone of layout.zones) {
    assert.equal(zone.chunkIds.length, 4);
    const [zx, zy] = zone.index;
    for (const chunkId of zone.chunkIds) {
      const chunk = layout.chunks.find((candidate) => candidate.id === chunkId);
      if (chunk === undefined) throw new Error(`zone lists unknown chunk ${chunkId}`);
      assert.deepEqual(zoneIndexOfChunk(chunk.index[0], chunk.index[1]), [zx, zy]);
    }
  }
  for (const region of layout.regions) {
    assert.equal(region.zoneIds.length, 4);
    for (const zoneId of region.zoneIds) {
      const zone = layout.zones.find((candidate) => candidate.id === zoneId);
      if (zone === undefined) throw new Error(`region lists unknown zone ${zoneId}`);
      assert.equal(zone.regionId, region.id);
    }
  }
});

test("layout: chunk cell lookup is half-open and out-of-bounds is typed, never clamped", () => {
  const inside = chunkIndexOfPosition(0, 0);
  assert.ok(inside.ok);
  assert.deepEqual(inside.index, [0, 0]);
  const corner = chunkIndexOfPosition(127.999, 127.999);
  assert.ok(corner.ok);
  assert.deepEqual(corner.index, [7, 7]);
  const center = chunkIndexOfPosition(40.5, 40.5);
  assert.ok(center.ok);
  assert.deepEqual(center.index, [2, 2]);
  // max is EXCLUDED (half-open): exactly 128 belongs to no chunk.
  for (const [x, y] of [[128, 64], [64, 128], [-0.001, 64], [64, -1], [Number.NaN, 64], [64, Number.POSITIVE_INFINITY]] as const) {
    const outside = chunkIndexOfPosition(x, y);
    assert.equal(outside.ok, false, `${String(x)},${String(y)} must be out of bounds`);
  }
});

test("layout: derivation is pure — two derivations are structurally identical", () => {
  assert.deepEqual(deriveLayout(), deriveLayout());
});
