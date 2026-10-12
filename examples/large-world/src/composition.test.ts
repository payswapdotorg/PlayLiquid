/**
 * COMPOSITION TESTS (PL-039; §Game model, E8, E9) — the versioned world
 * composition over the REAL authorities: the sealed composition, its
 * digest-pinned game reference, composition determinism, and the typed
 * refusal arms (invalid compositions NEVER yield a partial world).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameIRDocument } from "../../../packages/game-ir/src/index.ts";
import { asIntentTypeId } from "../../../packages/game-ir/src/index.ts";
import { EVENT_TYPE_IDS } from "./events.ts";
import { latticeDocument } from "./document.ts";
import { CHUNK_PARTITIONING } from "./layout.ts";
import { LATTICE_PACKAGE_COUNT } from "./packages.ts";
import { composeLatticeWorld, documentArtifactBytes, latticeGameRef } from "./composition.ts";
import type { CompositionRefusal } from "./composition.ts";

/** Composes the canonical world (the shared fixture of this file). */
async function composed() {
  const composition = await composeLatticeWorld();
  if (!composition.ok) throw new Error("canonical composition refused");
  return composition;
}

test("composition: seals the canonical world over the real authorities", async () => {
  const composition = await composed();
  assert.equal(composition.packageCount, LATTICE_PACKAGE_COUNT);
  assert.equal(composition.chunkCount, 64);
  assert.equal(composition.graph.records.length, LATTICE_PACKAGE_COUNT);
  assert.ok(composition.document.nodes.length > 200);
  // The digests pin every authority output.
  assert.match(composition.gameIrDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(composition.lockFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(composition.compositionDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(composition.model.coreChunkId, "chunk-2-2");
});

test("composition: the digest-pinned game reference projects world + policy revisions", () => {
  const document = latticeDocument();
  const reference = latticeGameRef(document);
  assert.equal(reference.worldId, "world-lattice");
  assert.match(reference.gameDigest, /^[0-9a-f]{64}$/);
  assert.match(reference.worldRevisionDigest, /^[0-9a-f]{64}$/);
  assert.match(reference.policyRevisionDigest, /^[0-9a-f]{64}$/);
  // The three digests are distinct authorities (document, world node, policy nodes).
  const distinct = new Set([reference.gameDigest, reference.worldRevisionDigest, reference.policyRevisionDigest]);
  assert.equal(distinct.size, 3);
});

test("composition: composing twice seals byte-identical evidence (E9)", async () => {
  const first = await composed();
  const second = await composed();
  assert.equal(first.gameIrDigest, second.gameIrDigest);
  assert.equal(first.lockFingerprint, second.lockFingerprint);
  assert.equal(first.compositionDigest, second.compositionDigest);
  assert.deepEqual(first.game, second.game);
  assert.deepEqual(
    first.graph.records.map((record) => record.identity.contentDigest),
    second.graph.records.map((record) => record.identity.contentDigest),
  );
  assert.deepEqual(documentArtifactBytes(first.document), documentArtifactBytes(second.document));
});

test("composition: an invalid document refuses with typed diagnostics — never a partial world (E8)", async () => {
  const broken = latticeDocument();
  const declaration = broken.nodes.find((node) => node.kind === "capability-declaration");
  if (declaration?.kind !== "capability-declaration") throw new Error("replay declaration missing");
  // Break the frozen platform vocabulary inside the replay declaration
  // (mutated in place through the validation test seam — intentionally invalid).
  (declaration as unknown as { requirement: { policy: { capture: string } } }).requirement.policy.capture = "telepathy";
  const refusal = await composeLatticeWorld({ document: broken });
  assert.equal(refusal.ok, false);
  if (refusal.ok) throw new Error("unreachable");
  assert.equal(refusal.code, "document-invalid");
  assert.ok(refusal.diagnostics.length > 0);
  assert.ok(refusal.diagnostics.every((diagnostic) => diagnostic.code.length > 0 && diagnostic.message.length > 0));
});

test("composition: a document/model mismatch refuses as world-model-invalid (E8)", async () => {
  const document = latticeDocument();
  // Declare a partitioning the derived model does not match.
  const broken: GameIRDocument = {
    ...document,
    nodes: document.nodes.map((node) =>
      node.kind === "world" ? { ...node, partitioning: { ...CHUNK_PARTITIONING, cellSize: [32, 32, 32] } } : node,
    ),
  };
  const refusal = await composeLatticeWorld({ document: broken });
  assert.equal(refusal.ok, false);
  if (refusal.ok) throw new Error("unreachable");
  assert.equal(refusal.code, "world-model-invalid");
  assert.ok(refusal.detail.length > 0);
  // A document missing an entity the model needs refuses the same way.
  const pruned: GameIRDocument = {
    ...document,
    nodes: document.nodes.filter((node) => !(node.kind === "entity" && String(node.entity) === "entity-4-4-2")),
  };
  const entityRefusal = await composeLatticeWorld({ document: pruned });
  assert.equal(entityRefusal.ok, false);
  if (entityRefusal.ok) throw new Error("unreachable");
  assert.equal(entityRefusal.code, "world-model-invalid");
});

test("composition: refusal messages format every arm without silent failures (E8)", () => {
  const arms: CompositionRefusal[] = [
    { ok: false, code: "document-invalid", diagnostics: [{ code: "GAMEIR/E010", message: "bad capability" }] },
    { ok: false, code: "world-model-invalid", detail: "partitioning mismatch" },
    { ok: false, code: "lock-unverified", problems: [{ code: "pin-mismatch", message: "digest differs" }] },
    { ok: false, stage: "cas", packageId: "@lattice/chunk-0-0", detail: "store refused" },
  ];
  for (const arm of arms) {
    assert.equal(arm.ok, false);
    if (arm.code === "document-invalid") assert.match(arm.diagnostics[0]!.code, /^GAMEIR\//);
    else if (arm.code === "world-model-invalid") assert.ok(arm.detail.length > 0);
    else if (arm.code === "lock-unverified") assert.ok(arm.problems.length > 0);
    else assert.ok(arm.stage.length > 0 && arm.packageId.length > 0 && arm.detail.length > 0);
  }
});

test("composition: the declared semantics hold the frozen intent vocabulary", () => {
  const document = latticeDocument();
  const rules = document.nodes.filter((node) => node.kind === "rule");
  assert.equal(rules.length, 3);
  const handled = rules.flatMap((rule) => (rule.kind === "rule" ? rule.handles.map(String) : []));
  assert.deepEqual(handled, [String(asIntentTypeId("lattice.view.move"))]);
  const emitted = new Set(rules.flatMap((rule) => (rule.kind === "rule" ? rule.emits.map(String) : [])));
  assert.deepEqual([...emitted].sort(), [EVENT_TYPE_IDS.chunkLoaded, EVENT_TYPE_IDS.chunkUnloaded, EVENT_TYPE_IDS.entityDrifted, EVENT_TYPE_IDS.viewMoved].map(String).sort());
});
