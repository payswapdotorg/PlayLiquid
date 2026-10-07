import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_EVIDENCE_PACKAGE_KIND,
  arenaEvidencePackageEquals,
  arenaIngestIdempotencyKey,
  arenaIngestIdempotencyKeyEquals,
  arenaIngestIdempotencyKeyText,
  settleArenaIngest,
} from "./ingestion.ts";
import type { ArenaEvidencePackage, ArenaIngestReceipt } from "./ingestion.ts";
import { arenaAuthorizationScope } from "./authorization.ts";
import { ARENA_RESPONSE_ENVELOPE_KIND } from "./response.ts";
import type {
  ArenaArtifactPayload,
  ArenaEvidencePayload,
  ArenaResponseEnvelope,
  ArenaResultPayload,
} from "./response.ts";
import type { ArenaRequestEnvelope } from "./request.ts";
import type { ArenaContentDigest, ArenaEndpointRef, ArenaTimestampMs } from "./primitives.ts";

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

function fixtureEndpoint(seed: string): ArenaEndpointRef {
  return { refKind: "arena-endpoint", endpointDigest: fixtureDigest(seed) };
}

function fixtureRequest(overrides: { requestKind?: ArenaRequestEnvelope["requestKind"]; artifactClasses?: readonly ("capability" | "tool" | "skill" | "knowledge")[] } = {}): ArenaRequestEnvelope {
  return {
    envelopeKind: "arena-request",
    requestKind: overrides.requestKind ?? "result",
    cycle: {
      requestPayload: fixtureDigest("a1"),
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
  return { recordKind: "arena-artifact", origin: "arena-external", artifactClass, artifact: fixtureDigest(seed) };
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

test("ingestion: admitted responses produce validated evidence packages", () => {
  const request = fixtureRequest();
  const disposition = settleArenaIngest(undefined, fixtureResponse(), request);
  assert.equal(disposition.status, "ingested");
  if (disposition.status !== "ingested") return;
  const pkg = disposition.receipt.evidencePackage;
  assert.equal(pkg.packageKind, ARENA_EVIDENCE_PACKAGE_KIND);
  assert.equal(pkg.verdict, "admitted");
  assert.deepEqual([...pkg.reasons], []);
  assert.equal(pkg.results.length, 1);
  assert.equal(pkg.evidence.length, 1);
  assert.equal(pkg.artifacts.length, 0);
  assert.equal(pkg.respondent.endpointDigest, fixtureEndpoint("e1").endpointDigest);
});

test("ingestion: rejected responses produce refusal-only packages with frozen reasons", () => {
  const request = fixtureRequest();
  // Artifact returned without authorization scope.
  const unauthorized = fixtureResponse({ artifacts: [fixtureArtifact("7a", "skill")] });
  const disposition = settleArenaIngest(undefined, unauthorized, request);
  assert.equal(disposition.status, "ingested"); // the REFUSAL is ingested once, as evidence
  if (disposition.status !== "ingested") return;
  const pkg = disposition.receipt.evidencePackage;
  assert.equal(pkg.verdict, "rejected");
  assert.ok(pkg.reasons.includes("artifact-not-authorized"));
  // Rejected packages carry pins but never payload data.
  assert.equal(pkg.results.length, 0);
  assert.equal(pkg.evidence.length, 0);
  assert.equal(pkg.artifacts.length, 0);
  assert.equal(pkg.responseDigest, fixtureDigest("9c"));
});

test("ingestion: garbage responses are not ingestible (no key, no package)", () => {
  assert.deepEqual(settleArenaIngest(undefined, { nope: true }, fixtureRequest()), { status: "not-ingestible" });
  assert.deepEqual(settleArenaIngest(undefined, null, fixtureRequest()), { status: "not-ingestible" });
  assert.deepEqual(settleArenaIngest(undefined, "arena-response", fixtureRequest()), { status: "not-ingestible" });
});

test("ingestion: idempotent ingest — the first receipt stands (E6)", () => {
  const request = fixtureRequest();
  const response = fixtureResponse();
  const first = settleArenaIngest(undefined, response, request);
  assert.equal(first.status, "ingested");
  if (first.status !== "ingested") return;

  // Replay the same response: duplicate, same package object, no re-processing.
  const replay = settleArenaIngest(first.receipt, response, request);
  assert.equal(replay.status, "duplicate-ingest");
  if (replay.status !== "duplicate-ingest") return;
  assert.equal(replay.receipt, first.receipt);

  // Key derivation and equality.
  const key = arenaIngestIdempotencyKey(response);
  assert.ok(arenaIngestIdempotencyKeyEquals(key, first.receipt.key));
  assert.equal(arenaIngestIdempotencyKeyText(key), `${fixtureDigest("a1")}:${fixtureDigest("9c")}`);
});

test("ingestion: same key with a different package is a refused collision (E8)", () => {
  const request = fixtureRequest();
  const response = fixtureResponse();
  const first = settleArenaIngest(undefined, response, request, 1000 as ArenaTimestampMs);
  assert.equal(first.status, "ingested");
  if (first.status !== "ingested") return;

  // Same response, DIFFERENT ingest time: different package under the same
  // key → collision, the first receipt is not replaced.
  const collision = settleArenaIngest(first.receipt, response, request, 2000 as ArenaTimestampMs);
  assert.equal(collision.status, "ingest-collision");
  assert.ok(collision.status === "ingest-collision" && arenaIngestIdempotencyKeyEquals(collision.key, first.receipt.key));
});

test("ingestion: a different response under a different key ingests normally", () => {
  const request = fixtureRequest();
  const first = settleArenaIngest(undefined, fixtureResponse(), request);
  assert.equal(first.status, "ingested");
  if (first.status !== "ingested") return;

  const secondResponse = fixtureResponse({ responseDigest: fixtureDigest("9d"), results: [fixtureResult("c2")], evidence: [] });
  const second = settleArenaIngest(first.receipt, secondResponse, request);
  assert.equal(second.status, "ingested");
  if (second.status !== "ingested") return;
  assert.equal(second.receipt.key.responseDigest, fixtureDigest("9d"));
});

test("ingestion: the oracle is pure — inputs are never mutated", () => {
  const request = fixtureRequest();
  const response = fixtureResponse();
  const requestSnapshot = structuredClone(request);
  const responseSnapshot = structuredClone(response);
  const prior: ArenaIngestReceipt | undefined = undefined;
  settleArenaIngest(prior, response, request);
  settleArenaIngest(prior, response, request);
  assert.deepEqual(request, requestSnapshot);
  assert.deepEqual(response, responseSnapshot);
});

test("ingestion: package equality is field-sensitive", () => {
  const request = fixtureRequest();
  const first = settleArenaIngest(undefined, fixtureResponse(), request);
  const second = settleArenaIngest(undefined, fixtureResponse(), request);
  assert.ok(first.status === "ingested" && second.status === "ingested");
  if (first.status !== "ingested" || second.status !== "ingested") return;
  assert.ok(arenaEvidencePackageEquals(first.receipt.evidencePackage, second.receipt.evidencePackage));

  const different = settleArenaIngest(undefined, fixtureResponse({ responseDigest: fixtureDigest("9d") }), request);
  assert.ok(different.status === "ingested");
  if (different.status !== "ingested") return;
  assert.equal(
    arenaEvidencePackageEquals(first.receipt.evidencePackage, different.receipt.evidencePackage),
    false,
  );
});

test("ingestion: evidence packages are passive data — no callable members (lock)", () => {
  const disposition = settleArenaIngest(undefined, fixtureResponse(), fixtureRequest());
  assert.ok(disposition.status === "ingested");
  if (disposition.status !== "ingested") return;
  const pkg: ArenaEvidencePackage = disposition.receipt.evidencePackage;
  for (const value of Object.values(pkg)) {
    assert.notEqual(typeof value, "function");
  }
  // @ts-expect-error — evidence packages expose no apply/commit/execute surface
  const asApply = pkg.apply;
  // @ts-expect-error — and no patch/mutation surface either
  const asMutate = pkg.mutateLiveState;
  assert.equal(asApply, undefined);
  assert.equal(asMutate, undefined);
});
