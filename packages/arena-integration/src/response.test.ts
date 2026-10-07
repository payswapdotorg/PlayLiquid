import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_ARTIFACT_RECORD_KIND,
  ARENA_EVIDENCE_RECORD_KIND,
  ARENA_RESPONSE_ENVELOPE_KIND,
  ARENA_RESULT_RECORD_KIND,
  arenaResponseResultContents,
  isArenaArtifactPayload,
  isArenaEvidencePayload,
  isArenaResponseEnvelope,
  isArenaResultPayload,
} from "./response.ts";
import type {
  ArenaArtifactPayload,
  ArenaEvidencePayload,
  ArenaResponseEnvelope,
  ArenaResultPayload,
} from "./response.ts";
import type { ArenaContentDigest, ArenaEndpointRef } from "./primitives.ts";

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

function fixtureEndpoint(seed: string): ArenaEndpointRef {
  return { refKind: "arena-endpoint", endpointDigest: fixtureDigest(seed) };
}

function fixtureResult(seed: string): ArenaResultPayload {
  return { recordKind: ARENA_RESULT_RECORD_KIND, origin: "arena-external", content: fixtureDigest(seed) };
}

function fixtureEvidence(seed: string, substantiates: readonly string[] = []): ArenaEvidencePayload {
  return {
    recordKind: ARENA_EVIDENCE_RECORD_KIND,
    origin: "arena-external",
    evidence: [fixtureDigest(seed)],
    substantiates: substantiates.map((entry) => fixtureDigest(entry)),
  };
}

function fixtureArtifact(seed: string, artifactClass: ArenaArtifactPayload["artifactClass"]): ArenaArtifactPayload {
  return {
    recordKind: ARENA_ARTIFACT_RECORD_KIND,
    origin: "arena-external",
    artifactClass,
    artifact: fixtureDigest(seed),
  };
}

function fixtureResponse(overrides: Partial<ArenaResponseEnvelope> = {}): ArenaResponseEnvelope {
  return {
    envelopeKind: ARENA_RESPONSE_ENVELOPE_KIND,
    requestPayload: fixtureDigest("a1"),
    respondent: fixtureEndpoint("e1"),
    results: [fixtureResult("c1")],
    evidence: [fixtureEvidence("50", ["c1"])],
    artifacts: [],
    responseDigest: fixtureDigest("9c"),
    ...overrides,
  };
}

test("response: result payloads are provenance-marked content-addressed records", () => {
  const result = fixtureResult("c1");
  assert.ok(isArenaResultPayload(result));
  assert.equal(result.origin, "arena-external");
  // Wrong provenance marker is structurally invalid.
  assert.equal(isArenaResultPayload({ ...result, origin: "platform-authority" }), false);
  assert.equal(isArenaResultPayload({ ...result, origin: "lab-evidence" }), false);
  // Malformed content digest is invalid.
  assert.equal(isArenaResultPayload({ ...result, content: "sha256:xx" }), false);
  assert.equal(isArenaResultPayload({ ...result, recordKind: "arena-evidence" }), false);
  assert.equal(isArenaResultPayload(null), false);
});

test("response: evidence payloads require non-empty well-formed evidence lists", () => {
  const evidence = fixtureEvidence("50", ["c1"]);
  assert.ok(isArenaEvidencePayload(evidence));
  assert.deepEqual([...evidence.substantiates], [fixtureDigest("c1")]);

  assert.equal(isArenaEvidencePayload({ ...evidence, evidence: [] }), false);
  assert.equal(isArenaEvidencePayload({ ...evidence, evidence: ["sha256:bad"] }), false);
  assert.equal(isArenaEvidencePayload({ ...evidence, substantiates: ["nope"] }), false);
  // Substantiates may be empty (standalone evidence).
  assert.ok(isArenaEvidencePayload(fixtureEvidence("51")));
  assert.equal(isArenaEvidencePayload({ ...evidence, origin: "game-declared" }), false);
});

test("response: artifact payloads carry a declared class and a digest-pinned reference", () => {
  const artifact = fixtureArtifact("7a", "capability");
  assert.ok(isArenaArtifactPayload(artifact));
  assert.equal(isArenaArtifactPayload({ ...artifact, artifactClass: "plugin" }), false);
  assert.equal(isArenaArtifactPayload({ ...artifact, artifactClass: "Capability" }), false);
  assert.equal(isArenaArtifactPayload({ ...artifact, artifact: "sha256:zz" }), false);
  assert.equal(isArenaArtifactPayload({ ...artifact, origin: "platform-authority" }), false);
  // All four declared classes are representable.
  for (const artifactClass of ["capability", "tool", "skill", "knowledge"] as const) {
    assert.ok(isArenaArtifactPayload(fixtureArtifact("7b", artifactClass)));
  }
});

test("response: envelopes carry the three return classes and correlation pins", () => {
  const response = fixtureResponse();
  assert.ok(isArenaResponseEnvelope(response));
  assert.deepEqual([...arenaResponseResultContents(response)], [fixtureDigest("c1")]);

  assert.equal(isArenaResponseEnvelope({ ...response, envelopeKind: "arena-request" }), false);
  assert.equal(isArenaResponseEnvelope({ ...response, requestPayload: "sha256:bad" }), false);
  assert.equal(isArenaResponseEnvelope({ ...response, respondent: fixtureEndpoint("e2") ? { refKind: "nope" } : null }), false);
  assert.equal(isArenaResponseEnvelope({ ...response, responseDigest: "not-a-digest" }), false);
  assert.equal(isArenaResponseEnvelope({ ...response, results: [fixtureResult("c1"), { nope: true }] }), false);
  assert.equal(isArenaResponseEnvelope({ ...response, artifacts: [fixtureArtifact("7a", "tool")] }), true);
  assert.equal(isArenaResponseEnvelope(null), false);
  assert.equal(isArenaResponseEnvelope("arena-response"), false);
});

test("response: payload record kinds are frozen literals (compile-time misuse)", () => {
  // @ts-expect-error — "arena-outcome" is not a result record kind literal
  const badKind: ArenaResultPayload["recordKind"] = "arena-outcome";
  // @ts-expect-error — an evidence payload is not an artifact payload (distinct record kinds)
  const wrongPayload: ArenaArtifactPayload = fixtureEvidence("50");
  assert.equal(typeof badKind, "string");
  assert.equal(typeof wrongPayload, "object");
});
