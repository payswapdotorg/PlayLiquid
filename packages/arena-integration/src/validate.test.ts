import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_RESPONSE_REJECTION_REASONS,
  isArenaResponseRejectionReason,
  validateArenaResponse,
} from "./validate.ts";
import { arenaAuthorizationScope } from "./authorization.ts";
import { ARENA_RESPONSE_ENVELOPE_KIND } from "./response.ts";
import type {
  ArenaArtifactPayload,
  ArenaEvidencePayload,
  ArenaResponseEnvelope,
  ArenaResultPayload,
} from "./response.ts";
import type { ArenaRequestEnvelope } from "./request.ts";
import type { ArenaContentDigest, ArenaEndpointRef } from "./primitives.ts";

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

function fixtureEndpoint(seed: string): ArenaEndpointRef {
  return { refKind: "arena-endpoint", endpointDigest: fixtureDigest(seed) };
}

function fixtureRequest(overrides: {
  requestKind?: ArenaRequestEnvelope["requestKind"];
  artifactClasses?: readonly ("capability" | "tool" | "skill" | "knowledge")[];
  payloadSeed?: string;
} = {}): ArenaRequestEnvelope {
  return {
    envelopeKind: "arena-request",
    requestKind: overrides.requestKind ?? "result",
    cycle: {
      requestPayload: fixtureDigest(overrides.payloadSeed ?? "a1"),
      gapSummary: fixtureDigest("b1"),
      authorization: arenaAuthorizationScope(overrides.artifactClasses ?? []),
    },
    endpoint: fixtureEndpoint("e1"),
  };
}

function fixtureResult(seed: string): ArenaResultPayload {
  return { recordKind: "arena-result", origin: "arena-external", content: fixtureDigest(seed) };
}

function fixtureEvidence(seed: string, substantiates: readonly string[] = []): ArenaEvidencePayload {
  return {
    recordKind: "arena-evidence",
    origin: "arena-external",
    evidence: [fixtureDigest(seed)],
    substantiates: substantiates.map((entry) => fixtureDigest(entry)),
  };
}

function fixtureArtifact(seed: string, artifactClass: ArenaArtifactPayload["artifactClass"]): ArenaArtifactPayload {
  return {
    recordKind: "arena-artifact",
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

test("validate: rejection reason vocabulary is frozen and closed", () => {
  assert.deepEqual([...ARENA_RESPONSE_REJECTION_REASONS.values], [
    "malformed-request",
    "malformed-response",
    "request-digest-mismatch",
    "respondent-mismatch",
    "artifact-not-authorized",
    "evidence-linkage-broken",
    "request-kind-incoherent",
  ]);
  assert.equal(isArenaResponseRejectionReason("request-digest-mismatch"), true);
  assert.equal(isArenaResponseRejectionReason("arena-is-wrong"), false);
});

test("validate: a coherent response for its request is admitted", () => {
  const request = fixtureRequest({ requestKind: "result" });
  const response = fixtureResponse();
  const verdict = validateArenaResponse(response, request);
  assert.deepEqual(verdict, { valid: true, response });
});

test("validate: request-digest matching is enforced", () => {
  const request = fixtureRequest({ payloadSeed: "a1" });
  const wrongPayload = fixtureResponse({ requestPayload: fixtureDigest("a2") });
  const verdict = validateArenaResponse(wrongPayload, request);
  assert.ok(verdict.valid === false);
  assert.deepEqual([...verdict.reasons], ["request-digest-mismatch"]);

  // Same digest, correct match, different gap summary does not matter here.
  const rightPayload = fixtureResponse({ requestPayload: fixtureDigest("a1") });
  assert.ok(validateArenaResponse(rightPayload, request).valid);
});

test("validate: respondent must be the endpoint the request targeted", () => {
  const request = fixtureRequest();
  const stranger = fixtureResponse({ respondent: fixtureEndpoint("e2") });
  const verdict = validateArenaResponse(stranger, request);
  assert.ok(verdict.valid === false);
  assert.ok(verdict.reasons.includes("respondent-mismatch"));
});

test("validate: artifacts are returned only where explicitly authorized (scope enforcement)", () => {
  // Artifact kind + matching scope + artifact payload of that class: admitted.
  const authorized = fixtureRequest({ requestKind: "artifact.skill", artifactClasses: ["skill"] });
  const ok = fixtureResponse({ artifacts: [fixtureArtifact("7a", "skill")] });
  assert.ok(validateArenaResponse(ok, authorized).valid);

  // Same response against a scope that does NOT include the class: refused.
  const narrowScope = fixtureRequest({ requestKind: "artifact.skill", artifactClasses: ["tool"] });
  const refused = validateArenaResponse(ok, narrowScope);
  assert.ok(refused.valid === false);
  assert.ok(refused.reasons.includes("artifact-not-authorized"));

  // Artifact payload with an EMPTY scope: refused — no silent defaults.
  const emptyScope = fixtureRequest({ requestKind: "artifact.skill" });
  const refusedEmpty = validateArenaResponse(ok, emptyScope);
  assert.ok(refusedEmpty.valid === false);
  assert.ok(refusedEmpty.reasons.includes("artifact-not-authorized"));
});

test("validate: artifact responses to non-artifact request kinds are incoherent", () => {
  const resultKind = fixtureRequest({ requestKind: "result", artifactClasses: ["skill"] });
  const artifactResponse = fixtureResponse({ artifacts: [fixtureArtifact("7a", "skill")] });
  const verdict = validateArenaResponse(artifactResponse, resultKind);
  assert.ok(verdict.valid === false);
  assert.ok(verdict.reasons.includes("request-kind-incoherent"));
});

test("validate: evidence linkage must resolve against the response's own results", () => {
  const request = fixtureRequest({ requestKind: "evidence" });
  // Standalone evidence (empty substantiates) is fine.
  assert.ok(validateArenaResponse(fixtureResponse({ results: [], evidence: [fixtureEvidence("50")] }), request).valid);

  // Evidence substantiating a result content that IS present: fine.
  const linked = fixtureResponse({ results: [fixtureResult("c1")], evidence: [fixtureEvidence("50", ["c1"])] });
  assert.ok(validateArenaResponse(linked, request).valid);

  // Evidence substantiating a phantom result: refused.
  const phantom = fixtureResponse({ results: [fixtureResult("c1")], evidence: [fixtureEvidence("50", ["c9"])] });
  const verdict = validateArenaResponse(phantom, request);
  assert.ok(verdict.valid === false);
  assert.deepEqual([...verdict.reasons], ["evidence-linkage-broken"]);
});

test("validate: malformed request or response is refused before any deeper check", () => {
  const malformedResponse = validateArenaResponse({ nope: true }, fixtureRequest());
  assert.ok(malformedResponse.valid === false);
  assert.deepEqual([...malformedResponse.reasons], ["malformed-response"]);

  const malformedRequest = validateArenaResponse(fixtureResponse(), { nope: true });
  assert.ok(malformedRequest.valid === false);
  assert.deepEqual([...malformedRequest.reasons], ["malformed-request"]);

  // Provenance marking is structural: a response whose payloads claim a
  // non-Arena origin never reaches scope/linkage checks. Note the fixture
  // must be built as raw data — the typed payload constructors REFUSE a
  // foreign origin at compile time (that refusal is itself the guarantee).
  const foreignOrigin: unknown = {
    ...fixtureResponse(),
    results: [{ recordKind: "arena-result", origin: "platform-authority", content: fixtureDigest("c1") }],
  };
  const foreignVerdict = validateArenaResponse(foreignOrigin, fixtureRequest());
  assert.ok(foreignVerdict.valid === false);
  assert.deepEqual([...foreignVerdict.reasons], ["malformed-response"]);
});

test("validate: the validator is pure — identical inputs give identical verdicts", () => {
  const request = fixtureRequest();
  const response = fixtureResponse();
  const first = validateArenaResponse(response, request);
  const second = validateArenaResponse(response, request);
  assert.deepEqual(first, second);
  // Inputs are not mutated by validation.
  assert.deepEqual(request, fixtureRequest());
  assert.deepEqual(response, fixtureResponse());
});
