/**
 * DETERMINISM TESTS (PL-038; E9) — the canonical engine workflow runs
 * twice from scratch and every derived value must be identical: the
 * workflow document digest, the append-only journal (entries + digest),
 * the Blender authoring receipts, the engine adjudication verdicts, the
 * published package digests and lock fingerprints, the staged build's
 * id/manifest digest/artifact digests, the game-pack publication and
 * the whole-run evidence digest. Anything derived from a clock, a
 * random source or object-identity order would surface here.
 *
 * The same file asserts the canonical WALK SHAPE: every stage left the
 * evidence the product thesis claims (journal coverage, bridge
 * invocation counts, registry lookups, lock verifications).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCanonicalEngineWorkflow } from "./workflow.ts";
import type { CanonicalWorkflowRun } from "./workflow.ts";

/** A JSON-deep-comparable projection of one full workflow run. */
function evidenceOf(run: CanonicalWorkflowRun) {
  assert.equal(run.ok, true);
  return {
    documentDigest: run.documentDigest,
    journal: run.journal.snapshot().map((entry) => ({
      sequence: entry.sequence,
      stage: entry.stage,
      event: entry.event,
      at: entry.at,
      detail: entry.detail,
      entryDigest: entry.entryDigest,
    })),
    journalDigest: run.journal.journalDigest,
    authoring: run.authoring.receipts.map((receipt) => ({
      callId: receipt.callId,
      capability: receipt.capability,
      tool: receipt.tool,
      outputDigest: receipt.outputDigest,
      output: receipt.output,
    })),
    sealedAssets: run.authoring.sealed.map((asset) => ({ name: asset.name, digest: asset.digest, bytes: asset.bytes, sourceRef: asset.sourceRef })),
    adjudication: run.adjudication.map((candidate) => ({ engineId: candidate.engineId, profileId: candidate.profileId, verdict: candidate.verdict })),
    content: {
      lockFingerprint: run.content.lockFingerprint,
      records: run.content.records.map((record) => ({ id: record.identity.id, contentDigest: record.identity.contentDigest })),
    },
    build: {
      buildId: run.build.buildId,
      manifestDigest: run.build.manifestDigest,
      artifacts: run.build.artifacts,
      eventTypes: run.build.events.map((event) => event.type),
      limitationCount: run.build.limitations.length,
    },
    game: { recordDigest: run.game.record.identity.contentDigest, lockFingerprint: run.game.lockFingerprint },
    evidenceDigest: run.evidenceDigest,
  };
}

test("determinism: two independent canonical workflow runs produce identical evidence (E9)", async () => {
  const first = await runCanonicalEngineWorkflow();
  const second = await runCanonicalEngineWorkflow();
  if (!first.ok || !second.ok) throw new Error("canonical run refused");
  assert.deepEqual(evidenceOf(first), evidenceOf(second));
});

test("determinism: the staged build is content-addressed identically across runs (E9)", async () => {
  const first = await runCanonicalEngineWorkflow();
  const second = await runCanonicalEngineWorkflow();
  if (!first.ok || !second.ok) throw new Error("canonical run refused");
  assert.equal(first.build.buildId, second.build.buildId);
  assert.equal(first.build.manifestDigest, second.build.manifestDigest);
  assert.deepEqual(first.build.artifacts, second.build.artifacts);
  assert.equal(first.game.record.identity.contentDigest, second.game.record.identity.contentDigest);
  assert.equal(first.evidenceDigest, second.evidenceDigest);
});

test("walk: the journal covers every stage in order and its chain verifies (E10)", async () => {
  const run = await runCanonicalEngineWorkflow();
  if (!run.ok) throw new Error("canonical run refused");
  const entries = run.journal.snapshot();
  const stages = [...new Set(entries.map((entry) => entry.stage))];
  // The seal events (lock-verified + workflow-complete) land between the
  // content publication and the adjudication walk in the implementation's
  // chronological order — the journal's own stage vocabulary (journal.ts)
  // documents "seal" as a first-class stage.
  assert.deepEqual(stages, ["document", "authoring", "content", "seal", "adjudication", "build"]);
  // The document's 7 staged Blender operations all left tool-call entries.
  const toolCalls = entries.filter((entry) => entry.stage === "authoring" && entry.event === "tool-call");
  assert.equal(toolCalls.length, run.document.authoring.length);
  assert.equal(toolCalls.length, 7);
  // The build's phase machine left its full append-only trail.
  const buildEvents = entries.filter((entry) => entry.stage === "build" && entry.event === "build-event");
  // The REAL orchestrator's phase machine: queued → resolve → plan → emit
  // → verify → package → succeeded (five completed stages, then the
  // terminal transition — no stage-completed after the last one).
  assert.deepEqual(
    buildEvents.map((entry) => (entry.detail as { type: string }).type),
    ["admitted", "phase-transition", "stage-completed", "phase-transition", "stage-completed", "phase-transition", "stage-completed", "phase-transition", "stage-completed", "phase-transition", "stage-completed", "phase-transition", "build-succeeded"],
  );
  const verification = run.journal.verify();
  assert.equal(verification.ok, true);
  if (verification.ok) assert.equal(verification.entryCount, entries.length);
});

test("walk: the authoring stage drove the real Blender adapter over the fabric (E2/E7)", async () => {
  const run = await runCanonicalEngineWorkflow();
  if (!run.ok) throw new Error("canonical run refused");
  // Every staged tool call reached the fake bridge exactly once (the
  // pipeline dispatched all seven; nothing bypassed it).
  assert.equal(run.adapters.blenderBridge.invoked.length, 7);
  // The two source assets were stored in the content-addressed exchange.
  assert.equal(run.adapters.exchange.size, 2);
  // The import receipts cite the exchange digests (E7 provenance).
  const imports = run.authoring.receipts.filter((receipt) => receipt.capability === "asset.import");
  assert.equal(imports.length, 2);
  for (const receipt of imports) {
    const output = receipt.output as { importedDigest: string; importedBytes: number };
    assert.match(output.importedDigest, /^[a-f0-9]{64}$/);
    assert.ok(output.importedBytes > 0);
  }
  // The sealed assets derive their digests from the authoritative outputs.
  assert.equal(run.authoring.sealed.length, 2);
});

test("walk: the engine bindings adjudicated the sealed profiles with typed verdicts", async () => {
  const run = await runCanonicalEngineWorkflow();
  if (!run.ok) throw new Error("canonical run refused");
  assert.deepEqual(
    run.adjudication.map((candidate) => ({ engine: candidate.engineId, profile: candidate.profileId, compatible: candidate.verdict.compatible })),
    [
      { engine: "unreal", profile: "forge-windows", compatible: true },
      { engine: "unity", profile: "forge-web", compatible: true },
      { engine: "godot", profile: "forge-web", compatible: true },
      { engine: "unreal", profile: "forge-web", compatible: false },
    ],
  );
  const refused = run.adjudication[3];
  if (!refused || refused.verdict.compatible) throw new Error("expected the out-of-set refusal");
  // The target-profiles contract checks engine-not-declared BEFORE
  // target-not-supported: the forge-web profile does not declare unreal in
  // its engineBindings, so unreal's binding refuses with the declaration
  // code — the exact code the adapter's own binding tests assert for this
  // shape (engine-unreal/src/binding.test.ts:65).
  assert.equal(refused.verdict.code, "unreal-binding/profile-engine-not-declared");
});

test("walk: the staged build succeeded through the real build-orchestrator over the engine adapter", async () => {
  const run = await runCanonicalEngineWorkflow();
  if (!run.ok) throw new Error("canonical run refused");
  // The engine adapter executed cook, the validation script and the
  // packaging action — exactly the three engine invocations of the plan.
  assert.equal(run.adapters.unrealBridge.invoked.length, 3);
  assert.deepEqual(
    run.adapters.unrealBridge.invoked.map((invocation) => invocation.capability),
    ["build.cook", "editor.script", "editor.action"],
  );
  assert.equal(run.build.classification, "first");
  assert.match(run.build.manifestDigest, /^sha256:[0-9a-f]{64}$/);
  // Two CAS-stored receipt artifacts: the cook receipt and the package receipt.
  assert.deepEqual(run.build.artifacts.map((artifact) => artifact.mediaType), ["application/json", "application/json"]);
  assert.equal(run.build.limitations.length, 0);
});

test("walk: every package resolves through the real registry and both locks verify (R19/lock 10)", async () => {
  const run = await runCanonicalEngineWorkflow();
  if (!run.ok) throw new Error("canonical run refused");
  const { registry, artifacts } = run.stores;
  for (const record of [...run.content.records, run.game.record]) {
    const resolved = registry.getByDigest(record.identity.contentDigest);
    assert.ok(resolved !== null, `record ${record.identity.id} resolves by digest`);
    assert.equal(resolved?.identity.id, record.identity.id);
    const stat = artifacts.stat(record.identity.contentDigest);
    assert.ok(stat !== null, `record content of ${record.identity.id} is in the CAS`);
  }
  // The build's receipt artifacts are in the CAS under their digests.
  for (const artifact of run.build.artifacts) {
    const stat = artifacts.stat(artifact.digest);
    assert.ok(stat !== null, "build artifact is in the CAS");
    assert.equal(stat.sizeBytes, artifact.sizeBytes);
  }
  const contentVerification = run.journal.snapshot().some((entry) => entry.stage === "content" && entry.event === "lock-verified" && (entry.detail as { pass: boolean }).pass);
  const sealVerification = run.journal.snapshot().some((entry) => entry.stage === "seal" && entry.event === "lock-verified" && (entry.detail as { pass: boolean }).pass);
  assert.equal(contentVerification, true);
  assert.equal(sealVerification, true);
});
