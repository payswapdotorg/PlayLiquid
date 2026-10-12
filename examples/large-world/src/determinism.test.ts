/**
 * DETERMINISM TESTS (PL-039; E9) — same inputs ⇒ same outputs, everywhere
 * a derivation exists: the composition digests, the document bytes, and the
 * full canonical scenario (two independent runs produce identical evidence
 * trails). A different seed changes the seeded surfaces and ONLY those.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { ALTERNATE_SEED, CANONICAL_SEED } from "./ids.ts";
import { latticeDocument } from "./document.ts";
import { documentArtifactBytes } from "./composition.ts";
import { runCanonicalScenario, scenarioEvidenceOf } from "./scenario.ts";

test("determinism: two independent canonical scenario runs produce identical evidence (E9)", async () => {
  const first = await runCanonicalScenario();
  const second = await runCanonicalScenario();
  assert.deepEqual(scenarioEvidenceOf(first), scenarioEvidenceOf(second));
});

test("determinism: the seed drives the ecology — a different seed diverges, the streaming does not", async () => {
  const canonical = await runCanonicalScenario();
  const alternate = await runCanonicalScenario({ seed: ALTERNATE_SEED });
  const driftsOf = (run: typeof canonical): readonly GameIRValue[] =>
    run.allEvents.filter((event) => String(event.kind) === "lattice.entity.drifted").map((event) => event.payload);
  // The seeded surface (ecology drift) differs…
  assert.notDeepEqual(driftsOf(canonical), driftsOf(alternate));
  // …the trajectory/streaming surface (position-driven) is identical…
  const movesOf = (run: typeof canonical): readonly GameIRValue[] =>
    run.allEvents.filter((event) => String(event.kind) === "lattice.view.moved").map((event) => event.payload);
  assert.deepEqual(movesOf(canonical), movesOf(alternate));
  assert.deepEqual(canonical.schedule, alternate.schedule);
  assert.deepEqual(
    canonical.stats.loads + canonical.stats.casFetches + canonical.stats.checkpointReloads,
    alternate.stats.loads + alternate.stats.casFetches + alternate.stats.checkpointReloads,
  );
  // …and the sealed digests differ because the witness differs.
  assert.notEqual(canonical.sealed.witness.witnessDigest, alternate.sealed.witness.witnessDigest);
  // Both runs still replay byte-identically (each under its own seed).
  assert.equal(canonical.comparison.equal, true);
  assert.equal(alternate.comparison.equal, true);
  assert.equal(alternate.verdict.kind, "match");
});

test("determinism: the document derivation is stable bytes (E9)", () => {
  const first = latticeDocument();
  const second = latticeDocument();
  assert.deepEqual(first, second);
  assert.deepEqual(documentArtifactBytes(first), documentArtifactBytes(second));
});

test("determinism: the canonical seed is pinned and the event stream is order-valid", async () => {
  assert.equal(CANONICAL_SEED, "lattice-seed-v1");
  assert.notEqual(CANONICAL_SEED, ALTERNATE_SEED);
  const run = await runCanonicalScenario();
  // The whole committed stream passes the runtime-contracts order oracle (E2).
  const check = run.session.checkEventStream();
  assert.equal(check.ok, true);
});
