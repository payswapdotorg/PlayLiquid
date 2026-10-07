import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_TRANSPORT_ERROR_KINDS,
  ARENA_TRANSPORT_PORT_KIND,
  inMemoryArenaTransport,
  isArenaTransportErrorKind,
} from "./transport.ts";
import { arenaAuthorizationScope } from "./authorization.ts";
import { ARENA_RESPONSE_ENVELOPE_KIND } from "./response.ts";
import type { ArenaRequestEnvelope, ArenaRequestKind } from "./request.ts";
import type { ArenaResponseEnvelope } from "./response.ts";
import type { ArenaContentDigest, ArenaEndpointRef } from "./primitives.ts";

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

function fixtureEndpoint(seed: string): ArenaEndpointRef {
  return { refKind: "arena-endpoint", endpointDigest: fixtureDigest(seed) };
}

function fixtureEnvelope(overrides: { requestKind?: ArenaRequestKind; endpoint?: ArenaEndpointRef } = {}): ArenaRequestEnvelope {
  const requestKind = overrides.requestKind ?? "result";
  return {
    envelopeKind: "arena-request",
    requestKind,
    cycle: {
      requestPayload: fixtureDigest("a1"),
      gapSummary: fixtureDigest("b1"),
      authorization: arenaAuthorizationScope(requestKind === "artifact.skill" ? ["skill"] : []),
    },
    endpoint: overrides.endpoint ?? fixtureEndpoint("e1"),
  };
}

function fixtureResponse(): ArenaResponseEnvelope {
  return {
    envelopeKind: ARENA_RESPONSE_ENVELOPE_KIND,
    requestPayload: fixtureDigest("a1"),
    respondent: fixtureEndpoint("e1"),
    results: [{ recordKind: "arena-result", origin: "arena-external", content: fixtureDigest("c1") }],
    evidence: [],
    artifacts: [],
    responseDigest: fixtureDigest("9c"),
  };
}

test("transport: error vocabulary is frozen and provider-neutral", () => {
  assert.deepEqual([...ARENA_TRANSPORT_ERROR_KINDS.values], ["arena-unreachable", "arena-timeout", "arena-protocol-violation"]);
  assert.ok(isArenaTransportErrorKind("arena-timeout"));
  assert.equal(isArenaTransportErrorKind("http-429"), false);
  assert.equal(isArenaTransportErrorKind("grpc-unavailable"), false);
  assert.equal(isArenaTransportErrorKind("vendor-rate-limited"), false);
});

test("transport: the fake answers deterministically and records what crossed the port", async () => {
  const response = fixtureResponse();
  const transport = inMemoryArenaTransport({ endpoint: fixtureEndpoint("e1"), respond: () => ({ ok: true, response }) });
  assert.equal(transport.portKind, ARENA_TRANSPORT_PORT_KIND);

  const first = await transport.send(fixtureEnvelope());
  const second = await transport.send(fixtureEnvelope());
  assert.deepEqual(first, { ok: true, response });
  assert.deepEqual(second, { ok: true, response });
  assert.equal(transport.sentEnvelopes().length, 2);
  assert.deepEqual(transport.sentEnvelopes()[0], fixtureEnvelope());

  // The recorded list is a defensive copy — callers cannot mutate history.
  assert.throws(() => {
    (transport.sentEnvelopes() as ArenaRequestEnvelope[]).pop();
  }, /read only|not extensible|Cannot delete/i);
});

test("transport: the fake surfaces transport errors as typed refusals", async () => {
  const transport = inMemoryArenaTransport({
    endpoint: fixtureEndpoint("e1"),
    respond: () => ({ ok: false, error: { errorKind: "arena-timeout", endpoint: fixtureEndpoint("e1") } }),
  });
  const result = await transport.send(fixtureEnvelope());
  assert.deepEqual(result, { ok: false, error: { errorKind: "arena-timeout", endpoint: fixtureEndpoint("e1") } });
  // The failed send still crossed the port and is recorded.
  assert.equal(transport.sentEnvelopes().length, 1);
});

test("transport: requests aimed at a different endpoint are protocol violations", async () => {
  const transport = inMemoryArenaTransport({
    endpoint: fixtureEndpoint("e1"),
    respond: () => ({ ok: true, response: fixtureResponse() }),
  });
  const stranger = fixtureEnvelope({ endpoint: fixtureEndpoint("e2") });
  const result = await transport.send(stranger);
  assert.ok(result.ok === false);
  assert.deepEqual(result.error, { errorKind: "arena-protocol-violation", endpoint: fixtureEndpoint("e2") });
  // Nothing was recorded: the request never reached the served endpoint.
  assert.equal(transport.sentEnvelopes().length, 0);
});

test("transport: malformed envelopes never cross the port", async () => {
  const transport = inMemoryArenaTransport({
    endpoint: fixtureEndpoint("e1"),
    respond: () => ({ ok: true, response: fixtureResponse() }),
  });
  const result = await transport.send({ nope: true } as unknown as ArenaRequestEnvelope);
  assert.ok(result.ok === false);
  assert.equal(result.ok === false && result.error.errorKind, "arena-protocol-violation");
  assert.equal(transport.sentEnvelopes().length, 0);
});

test("transport: application-level refusals are RESPONSES, not transport errors", async () => {
  // An Arena-side decline travels as a result payload (data for the
  // validator), keeping transport errors transport-only.
  const decline: ArenaResponseEnvelope = {
    ...fixtureResponse(),
    results: [{ recordKind: "arena-result", origin: "arena-external", content: fixtureDigest("cd") }],
  };
  const transport = inMemoryArenaTransport({ endpoint: fixtureEndpoint("e1"), respond: () => ({ ok: true, response: decline }) });
  const result = await transport.send(fixtureEnvelope());
  assert.ok(result.ok);
  assert.equal(result.ok && result.response.results[0]?.content, fixtureDigest("cd"));
});
