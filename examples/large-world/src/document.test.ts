/**
 * GAMEIR DOCUMENT TESTS (PL-039) — the STATIC world definition as
 * engine-independent semantic data: validation, node census (topology,
 * scenes, entities, mechanics, event declarations, platform declarations),
 * determinism of the derivation and the frozen streaming contract.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { countNodeKinds, validate } from "../../../packages/game-ir/src/index.ts";
import { CORE_CHUNK_ID, LATTICE_WORLD, WORLD_STREAMING, entryScene, floraEntityIds, latticeDocument, viewpointState } from "./document.ts";
import { CHUNK_PARTITIONING, SPAWN, deriveLayout, chunkIdOf } from "./layout.ts";

test("document: validates against the game-ir authority (no diagnostics)", () => {
  const result = validate(latticeDocument());
  if (!result.ok) {
    throw new Error(`lattice document failed validation: ${result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`);
  }
  // Warnings alone do not fail validation; the canonical document has none.
  assert.equal(result.diagnostics.length, 0);
});

test("document: node census — 1 world, 16 scenes, 193 entities, 3 rules, 4 events, 1 capability, 1 avatar binding", () => {
  const counts = countNodeKinds(latticeDocument());
  assert.deepEqual(counts, {
    world: 1,
    scene: 16,
    entity: 193,
    rule: 3,
    "event-declaration": 4,
    "capability-declaration": 1,
    "avatar-binding": 1,
  });
});

test("document: the world node declares the one partitioning descriptor and the streaming contract", () => {
  const document = latticeDocument();
  const worldNode = document.nodes.find((node) => node.kind === "world");
  if (worldNode?.kind !== "world") throw new Error("no world node");
  assert.deepEqual(worldNode.partitioning, CHUNK_PARTITIONING);
  assert.deepEqual(worldNode.streaming, WORLD_STREAMING);
  assert.equal(worldNode.scenes.length, 16);
  // The declared scenes are exactly the layout's zone scenes.
  const layout = deriveLayout();
  assert.deepEqual([...worldNode.scenes].sort(), layout.zones.map((zone) => zone.scene).sort());
});

test("document: every scene lists exactly its zone's entities; the core zone also holds the viewpoint", () => {
  const document = latticeDocument();
  const layout = deriveLayout();
  const entitiesByScene = new Map<string, string[]>();
  for (const node of document.nodes) {
    if (node.kind !== "scene") continue;
    entitiesByScene.set(String(node.scene), [...node.entities].map(String));
  }
  for (const zone of layout.zones) {
    const listed = entitiesByScene.get(String(zone.scene));
    if (listed === undefined) throw new Error(`scene ${String(zone.scene)} has no scene node`);
    const expected = zone.chunkIds.flatMap((chunkId) => floraEntityIds(chunkId).map(String));
    if (zone.chunkIds.includes(CORE_CHUNK_ID)) expected.push("entity-viewpoint");
    assert.deepEqual([...listed].sort(), [...expected].sort());
  }
});

test("document: entity initial states are deterministic data (flora + viewpoint)", () => {
  const document = latticeDocument();
  const flora = document.nodes.find((node) => node.kind === "entity" && String(node.entity) === "entity-5-5-1");
  if (flora?.kind !== "entity") throw new Error("flora entity missing");
  const chunk = deriveLayout().chunks.find((candidate) => candidate.id === chunkIdOf(5, 5));
  if (chunk === undefined) throw new Error("chunk-5-5 missing");
  const floraAgain = document.nodes.find((node) => node.kind === "entity" && String(node.entity) === "entity-5-5-1");
  if (floraAgain?.kind !== "entity") throw new Error("unreachable");
  assert.deepEqual(flora.state, floraAgain.state);
  const viewpoint = viewpointState();
  if (viewpoint.kind !== "record") throw new Error("viewpoint state must be a record");
  const position = viewpoint.fields.position;
  if (position?.kind !== "list") throw new Error("viewpoint position must be a list");
  assert.deepEqual(position, {
    kind: "list",
    items: [
      { kind: "float", value: SPAWN[0] },
      { kind: "float", value: SPAWN[1] },
      { kind: "float", value: SPAWN[2] },
    ],
  });
  // The viewpoint lives in the core chunk's zone scene (the entry scene).
  const viewpointNode = document.nodes.find((node) => node.kind === "entity" && String(node.entity) === "entity-viewpoint");
  if (viewpointNode?.kind !== "entity") throw new Error("viewpoint node missing");
  assert.equal(String(viewpointNode.scene), String(entryScene()));
  assert.deepEqual(document.entry, { world: LATTICE_WORLD, scene: viewpointNode.scene });
});

test("document: the replay capability is DECLARED with the frozen platform vocabulary (lock 18)", () => {
  const document = latticeDocument();
  const declaration = document.nodes.find((node) => node.kind === "capability-declaration");
  if (declaration?.kind !== "capability-declaration") throw new Error("replay capability declaration missing");
  assert.deepEqual(declaration.requirement, {
    capability: "replay",
    required: true,
    policy: { capture: "intent-log", determinismRequired: true, consumers: ["player", "qa", "integrity", "simulation"] },
  });
});

test("document: derivation is pure — two documents are structurally identical", () => {
  assert.deepEqual(latticeDocument(), latticeDocument());
});
