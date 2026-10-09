/**
 * Artifact codec tests: value round-trips under game-ir's frozen
 * canonicalization (bigint ints, canonical floats, -0 vs +0), envelope
 * round-trips (command + event + all cause kinds), fail-closed decoding.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalValueForm } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import { asEntityId, asSceneId, asWorldId } from "@playliquid/game-contracts";
import { asCommandId, asCommandKind, asEventId, asEventKind, asEventSequence, asSessionId, asTick, asTimestamp } from "@playliquid/runtime-contracts";
import {
  decodeCommandEnvelope,
  decodeEventEnvelope,
  decodeGameIRValue,
  encodeCommandEnvelope,
  encodeEventEnvelope,
  encodeGameIRValue,
} from "./artifact-codec.ts";
import { moveEnvelope } from "./test-fixtures.ts";

const ref = {
  world: asWorldId("world-primus")!,
  scene: asSceneId("scene-overworld")!,
  entity: asEntityId("entity-hero")!,
};

function roundTrips(value: GameIRValue): void {
  const decoded = decodeGameIRValue(encodeGameIRValue(value));
  assert.equal(canonicalValueForm(decoded), canonicalValueForm(value));
}

test("codec: every value kind round-trips under canonical equality", () => {
  roundTrips({ kind: "unit" });
  roundTrips({ kind: "bool", value: true });
  roundTrips({ kind: "int", value: 987654321098765432109876543210n });
  roundTrips({ kind: "int", value: -7n });
  roundTrips({ kind: "float", value: 2.25 });
  roundTrips({ kind: "float", value: -0 });
  roundTrips({ kind: "float", value: 0 });
  roundTrips({ kind: "float", value: Number.NaN });
  roundTrips({ kind: "float", value: Number.POSITIVE_INFINITY });
  roundTrips({ kind: "float", value: Number.NEGATIVE_INFINITY });
  roundTrips({ kind: "string", value: "café \u{1F600}" });
  roundTrips({ kind: "list", items: [{ kind: "int", value: 5n }, { kind: "float", value: -0 }] });
  roundTrips({
    kind: "record",
    fields: { z: { kind: "int", value: 1n }, a: { kind: "bool", value: false }, n: { kind: "list", items: [] } },
  });
  roundTrips({ kind: "entity-ref", ref });
});

test("codec: -0 and +0 stay distinct (game-ir frozen rule)", () => {
  const minus = decodeGameIRValue(encodeGameIRValue({ kind: "float", value: -0 }));
  const plus = decodeGameIRValue(encodeGameIRValue({ kind: "float", value: 0 }));
  assert.equal(canonicalValueForm(minus), "f(-0)");
  assert.equal(canonicalValueForm(plus), "f(0)");
  assert.notEqual(canonicalValueForm(minus), canonicalValueForm(plus));
});

test("codec: decoding garbage fails closed", () => {
  assert.throws(() => decodeGameIRValue("nope" as never));
  assert.throws(() => decodeGameIRValue({ k: "int", v: "zzz" }));
  assert.throws(() => decodeGameIRValue({ k: "mystery" }));
  assert.throws(() => decodeGameIRValue({ k: "eref", w: 1, s: 2, e: 3 }));
  assert.throws(() => decodeGameIRValue({ k: "bool", v: "yes" }));
});

test("codec: command envelopes round-trip byte-stably", () => {
  const envelope = moveEnvelope("s-codec", "c-1", [1, 2, 3]);
  const encoded = encodeCommandEnvelope(envelope);
  const decoded = decodeCommandEnvelope(encoded);
  // Byte stability: same envelope re-encodes to identical canonical data.
  assert.deepEqual(encodeCommandEnvelope(decoded), encoded);
  // Semantic equality on every field, including the payload value.
  assert.equal(decoded.commandId, envelope.commandId);
  assert.equal(decoded.sessionId, envelope.sessionId);
  assert.equal(decoded.kind, envelope.kind);
  assert.equal(decoded.epoch, envelope.epoch);
  assert.deepEqual(decoded.actor, envelope.actor);
  assert.deepEqual(decoded.origin, envelope.origin);
  assert.deepEqual(decoded.idempotencyKey, envelope.idempotencyKey);
  assert.equal(decoded.issuedAt, envelope.issuedAt);
  assert.equal(canonicalValueForm(decoded.payload), canonicalValueForm(envelope.payload));
});

test("codec: malformed command envelopes fail closed", () => {
  assert.throws(() => decodeCommandEnvelope("nope" as never));
  assert.throws(() => decodeCommandEnvelope({ commandId: 1 }));
  assert.throws(() => decodeCommandEnvelope({ commandId: "c", sessionId: "s", kind: "k", epoch: -1, issuedAt: 1 }));
  assert.throws(() =>
    decodeCommandEnvelope({
      commandId: "c",
      sessionId: "s",
      kind: "k",
      epoch: 1,
      issuedAt: 1,
      actor: { actorClass: "avatar-agent", actorId: "a" },
      origin: { kind: "broker-mediated" },
      idempotencyKey: { scope: "command", actor: "a", nonce: "n" },
      payload: { k: "unit" },
    }),
  );
  assert.throws(() =>
    decodeCommandEnvelope({
      commandId: "c",
      sessionId: "s",
      kind: "k",
      epoch: 1,
      issuedAt: 1,
      actor: { actorClass: "avatar-agent", actorId: "a" },
      origin: { kind: "weird" },
      idempotencyKey: { scope: "command", actor: "a", nonce: "n" },
      payload: { k: "unit" },
    }),
  );
});

test("codec: event envelopes round-trip across every cause kind", () => {
  const base = {
    eventId: asEventId("evt-1"),
    sessionId: asSessionId("s-codec"),
    kind: asEventKind("world.entity.moved"),
    seq: asEventSequence(1),
    tick: asTick(4),
    payload: { kind: "record", fields: { at: { kind: "int", value: 4n } } } satisfies GameIRValue,
  };
  const causes = [
    { kind: "system" } as const,
    { kind: "command", commandId: asCommandId("cmd-1") } as const,
    { kind: "event", causedByEventId: asEventId("evt-0") } as const,
  ];
  for (const cause of causes) {
    const event = { ...base, cause, kind: asEventKind("world.entity.drifted") };
    const encoded = encodeEventEnvelope(event);
    const decoded = decodeEventEnvelope(encoded);
    assert.deepEqual(encodeEventEnvelope(decoded), encoded);
    assert.deepEqual(decoded.cause, cause);
    assert.equal(canonicalValueForm(decoded.payload), canonicalValueForm(base.payload));
  }
});

test("codec: malformed event envelopes fail closed", () => {
  assert.throws(() => decodeEventEnvelope([] as never));
  assert.throws(() => decodeEventEnvelope({ eventId: "e", sessionId: "s", kind: "k", seq: 0, tick: 0, cause: { kind: "system" }, payload: { k: "unit" } }));
  assert.throws(() => decodeEventEnvelope({ eventId: "e", sessionId: "s", kind: "k", seq: 1, tick: -1, cause: { kind: "system" }, payload: { k: "unit" } }));
  assert.throws(() => decodeEventEnvelope({ eventId: "e", sessionId: "s", kind: "k", seq: 1, tick: 1, cause: { kind: "nope" }, payload: { k: "unit" } }));
  assert.throws(() => decodeEventEnvelope({ eventId: "e", sessionId: "s", kind: "k", seq: 1, tick: 1, cause: { kind: "command" }, payload: { k: "unit" } }));
});

test("codec: command kinds and ids survive the branded round-trip", () => {
  const envelope = {
    commandId: asCommandId("cmd-brand"),
    sessionId: asSessionId("s-brand"),
    kind: asCommandKind("world.move"),
    epoch: 2 as never,
    actor: { actorClass: "host-authority" as const, actorId: "actor-host" as never },
    origin: { kind: "host-authority" as const },
    idempotencyKey: { scope: "command" as const, actor: "actor-host" as never, nonce: "n-brand" as never },
    issuedAt: asTimestamp(99),
    payload: { kind: "unit" } satisfies GameIRValue,
  };
  const decoded = decodeCommandEnvelope(encodeCommandEnvelope(envelope));
  assert.equal(decoded.actor.actorClass, "host-authority");
  assert.deepEqual(decoded.origin, { kind: "host-authority" });
});
