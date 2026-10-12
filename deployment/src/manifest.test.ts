/**
 * THE MANIFEST EVIDENCE TESTS (PL-044) — the committed
 * `deployment/manifests/deployment-plan.json` is EVIDENCE, and this file
 * proves it:
 *
 * 1. the committed manifest re-verifies through the REAL doors (the
 *    committed plan is re-run, never trusted from the file);
 * 2. the committed seal re-derives at its recorded instant (E9/E8);
 * 3. regeneration reproduces the committed file BYTE-FOR-BYTE (E9
 *    determinism — the corpus is seeded, the clock is fixed);
 * 4. tampering the committed manifest (plan edit, seal edit, honesty
 *    lie) is a typed refusal, never a silent pass (E8/E11).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFixedClock } from "../../services/ops/src/index.ts";
import { createCorpusDoors } from "./corpus.ts";
import { DEPLOYMENT_MANIFEST_INSTANT, generateDeploymentManifest, parseDeploymentManifest, verifyDeploymentManifest } from "./manifest.ts";

const MANIFEST_URL = new URL("../manifests/deployment-plan.json", import.meta.url);

function committedJson(): string {
  return readFileSync(MANIFEST_URL, "utf8");
}

test("the committed manifest re-verifies through the REAL doors (registry + CAS + release gate + profiles + lattice)", () => {
  const verification = verifyDeploymentManifest(committedJson(), createCorpusDoors(), { clock: createFixedClock(99_000) });
  assert.ok(verification.ok, verification.ok ? "" : `${verification.code}: ${verification.detail}`);
  assert.equal(verification.seal.verifiedAt, DEPLOYMENT_MANIFEST_INSTANT);
  assert.equal(verification.seal.units, 7);
});

test("the committed manifest's seal re-derives at its recorded instant (E9) and regeneration is byte-identical (run twice)", () => {
  const first = generateDeploymentManifest();
  const second = generateDeploymentManifest();
  assert.ok(first.ok && second.ok);
  assert.equal(first.json, second.json, "generation is deterministic (E9 run-twice)");
  assert.equal(first.json, committedJson(), "the committed manifest is exactly what the corpus regenerates");
  assert.equal(first.manifest.seal.sealDigest, second.manifest.seal.sealDigest);
});

test("E8: a tampered committed manifest refuses — plan edit, seal edit, version lie, honesty lie", () => {
  const good = committedJson();
  const parsed = parseDeploymentManifest(good);
  assert.ok(parsed.ok);
  const planEdit = good.replace('"unit-ops-service"', '"unit-forged"');
  assert.ok(!verifyDeploymentManifest(planEdit, createCorpusDoors()).ok, "a renamed unit must refuse (seal/plan mismatch)");
  const sealEdit = good.replace(firstSealDigestOf(good), "f".repeat(64));
  assert.ok(!verifyDeploymentManifest(sealEdit, createCorpusDoors()).ok, "an edited seal digest must refuse");
  const honestyLie = flipLast(good, '"realInfrastructure":false', '"realInfrastructure":true');
  const parsedLie = parseDeploymentManifest(honestyLie);
  assert.ok(!parsedLie.ok && parsedLie.code === "honesty-violation", "a manifest claiming real infrastructure must refuse (E11)");
  const planTruthLie = good.replace('"realInfrastructure":false', '"realInfrastructure":true');
  const parsedPlanLie = parseDeploymentManifest(planTruthLie);
  assert.ok(!parsedPlanLie.ok && parsedPlanLie.code === "invalid-manifest", "a plan claiming real infrastructure is structurally refused");
  const versionLie = good.replace('"manifestVersion":1', '"manifestVersion":2');
  assert.ok(!parseDeploymentManifest(versionLie).ok, "an unknown manifest version must refuse");
  assert.ok(verifyDeploymentManifest(good, createCorpusDoors()).ok, "the untouched manifest still verifies (E8: tampering mutated nothing)");
});

test("E8: a manifest whose plan cites an unresolvable artifact refuses through the doors", () => {
  const good = committedJson();
  const tamperedArtifact = good.replace(/"artifactDigest":"sha256:[0-9a-f]{64}"/, `"artifactDigest":"sha256:${"0".repeat(64)}"`);
  const verification = verifyDeploymentManifest(tamperedArtifact, createCorpusDoors());
  assert.ok(!verification.ok, "pinning an unresolvable digest must refuse");
  assert.ok(verification.code === "unknown-artifact" || verification.code === "invalid-manifest", `expected a typed artifact refusal, got ${verification.code}`);
});

/** The first 64-hex seal digest literal in the committed JSON. */
function firstSealDigestOf(json: string): string {
  const parsed = JSON.parse(json) as { seal: { sealDigest: string } };
  assert.ok(/^[0-9a-f]{64}$/.test(parsed.seal.sealDigest));
  return parsed.seal.sealDigest;
}

/** Replaces only the LAST occurrence of `from` (canonical JSON sorts keys, so the top-level `truth` block is the final one). */
function flipLast(json: string, from: string, to: string): string {
  const at = json.lastIndexOf(from);
  assert.ok(at >= 0, `expected ${from} in the committed manifest`);
  return json.slice(0, at) + to + json.slice(at + from.length);
}
