import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asChunkId,
  asEntityId,
  asRegionId,
  asSceneId,
  asWorldId,
  asZoneId,
} from "./ids.ts";
import {
  bounds3ContainsPoint,
  canonicalRefPath,
  isChunkRef,
  isFiniteVec2,
  isFiniteVec3,
  isRegionRef,
  isSceneRef,
  isSpatialLevel,
  isSpatialPartitionDescriptor,
  isStreamingPolicy,
  isValidBounds2,
  isValidBounds3,
  isZoneRef,
  sceneRefFromEntity,
  spatialLevelDepth,
  worldRefFromScene,
} from "./spatial.ts";
import type { Bounds3, ChunkRef, EntityRef, SceneRef, StreamingPolicy, Vec3 } from "./spatial.ts";

test("spatial: bounds validity (finite, min <= max)", () => {
  assert.ok(isValidBounds3({ min: [-1, -2, -3], max: [1, 2, 3] }));
  assert.ok(isValidBounds3({ min: [0, 0, 0], max: [0, 0, 0] }));
  assert.equal(isValidBounds3({ min: [1, 0, 0], max: [0, 0, 0] }), false);
  assert.equal(isValidBounds3({ min: [Number.NaN, 0, 0], max: [1, 1, 1] }), false);
  assert.equal(isValidBounds3({ min: [Number.POSITIVE_INFINITY, 0, 0], max: [1, 1, 1] }), false);
  assert.ok(isValidBounds2({ min: [0, 0], max: [1, 1] }));
  assert.equal(isValidBounds2({ min: [1, 1], max: [0, 0] }), false);
});

test("spatial: vector finiteness", () => {
  assert.ok(isFiniteVec2([0, 0]));
  assert.equal(isFiniteVec2([Number.NaN, 0]), false);
  assert.ok(isFiniteVec3([1, 2, 3]));
  assert.equal(isFiniteVec3([1, Number.POSITIVE_INFINITY, 3]), false);
});

test("spatial: bounds containment is inclusive", () => {
  const bounds: Bounds3 = { min: [0, 0, 0], max: [10, 10, 10] };
  const inside: Vec3 = [0, 5, 10];
  const outside: Vec3 = [10.1, 0, 0];
  assert.ok(bounds3ContainsPoint(bounds, inside));
  assert.equal(bounds3ContainsPoint(bounds, outside), false);
});

test("spatial: hierarchy levels (R15)", () => {
  assert.ok(isSpatialLevel("region"));
  assert.ok(isSpatialLevel("zone"));
  assert.ok(isSpatialLevel("chunk"));
  assert.equal(isSpatialLevel("tile"), false);
  assert.equal(spatialLevelDepth("region"), 1);
  assert.equal(spatialLevelDepth("zone"), 2);
  assert.equal(spatialLevelDepth("chunk"), 3);
});

test("spatial: partition descriptors are typed declarations only", () => {
  assert.ok(isSpatialPartitionDescriptor({ scheme: "uniform-grid", cellSize: [8, 8, 8], bounds: { min: [0, 0, 0], max: [64, 64, 64] } }));
  assert.equal(
    isSpatialPartitionDescriptor({ scheme: "uniform-grid", cellSize: [0, 8, 8], bounds: { min: [0, 0, 0], max: [1, 1, 1] } }),
    false,
  );
  assert.ok(isSpatialPartitionDescriptor({ scheme: "quadtree", bounds: { min: [0, 0], max: [100, 100] }, maxDepth: 8 }));
  assert.equal(isSpatialPartitionDescriptor({ scheme: "quadtree", bounds: { min: [0, 0], max: [100, 100] }, maxDepth: 0 }), false);
  assert.ok(isSpatialPartitionDescriptor({ scheme: "octree", bounds: { min: [0, 0, 0], max: [9, 9, 9] }, maxDepth: 3 }));
  assert.ok(isSpatialPartitionDescriptor({ scheme: "explicit" }));
  assert.equal(isSpatialPartitionDescriptor({ scheme: "bsp" }), false);
  assert.equal(isSpatialPartitionDescriptor(null), false);
});

test("spatial: streaming policy is a declarative permit (R15)", () => {
  const policy: StreamingPolicy = { streamable: true, cacheable: true, independentlyBuilt: false };
  assert.ok(isStreamingPolicy(policy));
  assert.equal(isStreamingPolicy({ streamable: "yes", cacheable: true, independentlyBuilt: false }), false);
  assert.equal(isStreamingPolicy(null), false);
});

test("spatial: reference guards", () => {
  const scene: SceneRef = { world: asWorldId("world-primus")!, scene: asSceneId("scene-overworld")! };
  const entity: EntityRef = {
    world: asWorldId("world-primus")!,
    scene: asSceneId("scene-overworld")!,
    entity: asEntityId("entity-hero")!,
  };
  const chunk: ChunkRef = {
    world: asWorldId("world-primus")!,
    region: asRegionId("region-north")!,
    zone: asZoneId("zone-frost")!,
    chunk: asChunkId("chunk-0-0")!,
  };
  assert.ok(isSceneRef(scene));
  assert.ok(isRegionRef({ world: chunk.world, region: chunk.region }));
  assert.ok(isZoneRef({ world: chunk.world, region: chunk.region, zone: chunk.zone }));
  assert.ok(isChunkRef(chunk));
  assert.equal(isSceneRef({ world: "BAD", scene: "scene-overworld" }), false);
  assert.equal(isChunkRef({ world: chunk.world, region: chunk.region, zone: chunk.zone }), false);
  assert.deepEqual(sceneRefFromEntity(entity), scene);
  assert.deepEqual(worldRefFromScene(scene), { world: scene.world });
});

test("spatial: canonical ref paths are deterministic and unambiguous", () => {
  const world = asWorldId("world-primus")!;
  const scene = asSceneId("scene-overworld")!;
  const entity = asEntityId("entity-hero")!;
  const region = asRegionId("region-north")!;
  const zone = asZoneId("zone-frost")!;
  const chunk = asChunkId("chunk-0-0")!;
  assert.equal(canonicalRefPath({ world }), "world/world-primus");
  assert.equal(canonicalRefPath({ world, scene }), "world/world-primus/scene/scene-overworld");
  assert.equal(
    canonicalRefPath({ world, scene, entity }),
    "world/world-primus/scene/scene-overworld/entity/entity-hero",
  );
  assert.equal(canonicalRefPath({ world, region }), "world/world-primus/region/region-north");
  assert.equal(canonicalRefPath({ world, region, zone }), "world/world-primus/region/region-north/zone/zone-frost");
  assert.equal(
    canonicalRefPath({ world, region, zone, chunk }),
    "world/world-primus/region/region-north/zone/zone-frost/chunk/chunk-0-0",
  );
});
