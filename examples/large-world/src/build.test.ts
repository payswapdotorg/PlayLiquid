/**
 * CHUNK-BUILD TESTS (PL-039; §Build, E6, E8, R20) — the per-chunk staged
 * build seam over the REAL build-orchestrator pipeline: independent chunks
 * cook, core-zone chunks refuse, idempotent re-cooks classify as
 * duplicates, and the orchestrator's own tenant-scoped doors refuse
 * cross-tenant reads.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeLatticeWorld } from "./composition.ts";
import { composeChunkBuildInputs, createChunkKitchen } from "./build.ts";
import type { ChunkBuildIdentity } from "./build.ts";
import { LATTICE_TENANT, OTHER_TENANT } from "./build.ts";

async function kitchen() {
  const composition = await composeLatticeWorld();
  if (!composition.ok) throw new Error("canonical composition refused");
  return { composition, kitchen: createChunkKitchen(composition) };
}

const identity = (nonce: string): ChunkBuildIdentity => ({ requester: "lattice-builder", nonce, requestedAt: 1_700_000_000_000 });

test("build: an independently-buildable chunk cooks through the staged pipeline", async () => {
  const { kitchen: cook } = await kitchen();
  const built = await cook.cook("chunk-5-5", identity("cook-a"));
  if (!built.ok) throw new Error(`chunk-5-5 build refused: ${built.code} — ${built.message}`);
  assert.equal(built.classification, "first");
  assert.equal(built.phase, "succeeded");
  assert.match(String(built.buildManifestDigest), /^sha256:[0-9a-f]{64}$/);
  assert.ok(built.artifactCount >= 1);
  assert.ok(built.eventCount > 0);
});

test("build: idempotency is the orchestrator's own — same key duplicates, same payload refuses (E6/E8)", async () => {
  const { kitchen: cook } = await kitchen();
  const first = await cook.cook("chunk-6-6", identity("cook-dup"));
  if (!first.ok) throw new Error("first build refused");
  assert.equal(first.classification, "first");
  // The SAME idempotency key re-cooks as a duplicate (same build, same manifest).
  const again = await cook.cook("chunk-6-6", identity("cook-dup"));
  if (!again.ok) throw new Error("re-cook refused");
  assert.equal(again.classification, "duplicate");
  assert.equal(String(again.buildManifestDigest), String(first.buildManifestDigest));
  assert.equal(String(again.buildId), String(first.buildId));
  // A DIFFERENT nonce with the identical payload is a typed duplicate-payload
  // refusal — the orchestrator never silently builds the same thing twice.
  const echo = await cook.cook("chunk-6-6", identity("cook-other"));
  assert.equal(echo.ok, false);
  if (!echo.ok) {
    assert.equal(echo.code, "intake-refused");
    assert.equal(echo.source, "duplicate-payload");
    assert.ok(echo.message.length > 0);
  }
  // A genuinely different chunk builds fresh (content-derived id, never random).
  const other = await cook.cook("chunk-1-4", identity("cook-other"));
  if (!other.ok) throw new Error("other build refused");
  assert.equal(other.classification, "first");
  assert.equal(String(other.buildManifestDigest) === String(first.buildManifestDigest), false);
});

test("build: core-zone chunks refuse — they cook as one zone unit, never per chunk (E8)", async () => {
  const { kitchen: cook } = await kitchen();
  for (const chunkId of ["chunk-2-2", "chunk-2-3", "chunk-3-2", "chunk-3-3"]) {
    const refused = await cook.cook(chunkId, identity(`cook-${chunkId}`));
    assert.equal(refused.ok, false, `${chunkId} must refuse`);
    if (!refused.ok) {
      assert.equal(refused.code, "chunk-not-independently-built");
      assert.ok(refused.message.length > 0);
    }
  }
  // Unknown chunks refuse too.
  const unknown = await cook.cook("chunk-9-9", identity("cook-unknown"));
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "chunk-unknown");
});

test("build: the orchestrator's tenant doors refuse cross-tenant reads (R20)", async () => {
  const { kitchen: cook } = await kitchen();
  const built = await cook.cook("chunk-1-4", identity("cook-tenant"));
  if (!built.ok) throw new Error("build refused");
  // The lattice tenant reads its own build fine…
  const own = cook.statusAs(LATTICE_TENANT, String(built.buildId));
  assert.equal(own.ok, true);
  assert.equal(own.phase, "succeeded");
  // …another tenant is refused by the orchestrator's OWN typed door.
  const foreign = cook.statusAs(OTHER_TENANT, String(built.buildId));
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, "wrong-tenant");
  assert.match(foreign.message ?? "", /tenant isolation/);
  // Unknown builds refuse as unknown-build, not as a silent empty result.
  const missing = cook.statusAs(LATTICE_TENANT, "bld-nonexistent");
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "unknown-build");
});

test("build: the composed inputs validate against build-contracts (typed refusals)", async () => {
  const { composition, kitchen: cook } = await kitchen();
  void cook;
  const digest = composition.graph.chunkContentDigests.get("chunk-5-5")!;
  const inputs = composeChunkBuildInputs(composition.model, composition.graph.lock, digest, "chunk-5-5");
  assert.equal(inputs.ok, true);
  // Contract violations are typed refusals, never exceptions.
  const unknown = composeChunkBuildInputs(composition.model, composition.graph.lock, digest, "chunk-42-42");
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "chunk-unknown");
  const zoneUnit = composeChunkBuildInputs(composition.model, composition.graph.lock, digest, "chunk-2-2");
  assert.equal(zoneUnit.ok, false);
  if (!zoneUnit.ok) assert.equal(zoneUnit.code, "chunk-not-independently-built");
  // A malformed digest is refused by the build-contracts validation.
  const malformed = composeChunkBuildInputs(composition.model, composition.graph.lock, "not-a-digest", "chunk-5-5");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, "invalid-inputs");
});
