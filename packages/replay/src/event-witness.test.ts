/**
 * Event witness tests: content addressing, the rolling digest chain,
 * contiguous-sequence validation, tamper detection, form round-trips.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asEventId, asEventKind, asEventSequence, asSessionId, asTick } from "@playliquid/runtime-contracts";
import type { RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import { sealEventWitness, verifyEventWitness, decodeEventWitnessForm, eventEnvelopeForm } from "./event-witness.ts";
import type { GameIRValue } from "@playliquid/game-ir";

function event(sessionId: string, seq: number, tick: number, salt: string): RuntimeEventEnvelope<GameIRValue> {
  return {
    eventId: asEventId(`evt-${seq}`),
    sessionId: asSessionId(sessionId),
    kind: asEventKind("world.entity.drifted"),
    seq: asEventSequence(seq),
    tick: asTick(tick),
    cause: { kind: "system" },
    payload: { kind: "record", fields: { salt: { kind: "string", value: salt } } },
  };
}

test("witness: sealing produces a chain link per event", () => {
  const events = [event("s-w", 1, 1, "a"), event("s-w", 2, 1, "b"), event("s-w", 3, 2, "c")];
  const artifact = sealEventWitness(events);
  assert.equal(artifact.chain.length, 3);
  const verification = verifyEventWitness(artifact);
  assert.equal(verification.ok, true);
  if (verification.ok) assert.equal(verification.eventCount, 3);
});

test("witness: identical events seal to identical bytes and digests (E9)", () => {
  const events = [event("s-w", 1, 1, "a"), event("s-w", 2, 2, "b")];
  const first = sealEventWitness(events);
  const second = sealEventWitness([...events]);
  assert.equal(first.form, second.form);
  assert.equal(first.witnessDigest, second.witnessDigest);
  assert.deepEqual(first.chain, second.chain);
  // Mutating one event's payload diverges form, digest AND chain tail.
  const mutated = [event("s-w", 1, 1, "a"), event("s-w", 2, 2, "MUTATED")];
  const other = sealEventWitness(mutated);
  assert.notEqual(other.form, first.form);
  assert.notEqual(other.witnessDigest, first.witnessDigest);
  assert.equal(other.chain[0], first.chain[0]);
  assert.notEqual(other.chain[1], first.chain[1]);
});

test("witness: the chain is order-sensitive (tamper-evidence)", () => {
  const ordered = [event("s-w", 1, 1, "a"), event("s-w", 2, 1, "b")];
  const swapped = [event("s-w", 2, 1, "b"), event("s-w", 1, 1, "a")];
  // Note: swapped is NOT contiguous ascending, so it must fail at seal.
  assert.throws(() => sealEventWitness(swapped), /contiguous/);
  // Re-encoding the same events in the same order yields the same chain.
  assert.deepEqual(sealEventWitness(ordered).chain, sealEventWitness([...ordered]).chain);
});

test("witness: sequence gaps and mixed sessions fail closed at seal time", () => {
  assert.throws(() => sealEventWitness([event("s-w", 1, 1, "a"), event("s-w", 3, 2, "c")]), /contiguous/);
  assert.throws(
    () => sealEventWitness([event("s-w", 1, 1, "a"), event("s-other", 2, 1, "b")]),
    /sessions/,
  );
  assert.throws(() => sealEventWitness([event("s-w", 0, 1, "a")]));
});

test("witness: tampering with events is detected by verification", () => {
  const artifact = sealEventWitness([event("s-w", 1, 1, "a"), event("s-w", 2, 2, "b")]);
  // Events mutated, form left stale.
  const formMismatch = { ...artifact, events: [event("s-w", 1, 1, "X"), artifact.events[1]!] };
  const formVerdict = verifyEventWitness(formMismatch);
  assert.equal(formVerdict.ok, false);
  if (!formVerdict.ok) assert.equal(formVerdict.code, "form-mismatch");
  // Events + form recomputed honestly, digest left stale.
  const honestOfMutated = sealEventWitness([event("s-w", 1, 1, "X"), artifact.events[1]!]);
  const digestMismatch = { ...honestOfMutated, witnessDigest: artifact.witnessDigest };
  const digestVerdict = verifyEventWitness(digestMismatch);
  assert.equal(digestVerdict.ok, false);
  if (!digestVerdict.ok) assert.equal(digestVerdict.code, "digest-mismatch");
  // Form + digest recomputed honestly, chain left stale.
  const chainMismatch = { ...honestOfMutated, chain: artifact.chain };
  const chainVerdict = verifyEventWitness(chainMismatch);
  assert.equal(chainVerdict.ok, false);
  if (!chainVerdict.ok) assert.equal(chainVerdict.code, "chain-mismatch");
});

test("witness: the canonical form decodes back to the same typed events", () => {
  const events = [event("s-w", 5, 3, "a"), event("s-w", 6, 4, "b")];
  const artifact = sealEventWitness(events);
  const decoded = decodeEventWitnessForm(artifact.form);
  assert.equal(decoded.length, 2);
  assert.deepEqual(decoded.map((e) => String(e.eventId)), ["evt-5", "evt-6"]);
  // Re-sealing the decoded events reproduces the same artifact.
  const resealed = sealEventWitness(decoded);
  assert.equal(resealed.form, artifact.form);
  assert.equal(resealed.witnessDigest, artifact.witnessDigest);
});

test("witness: event forms are byte-stable across constructions", () => {
  const a = event("s-w", 1, 1, "a");
  const b = event("s-w", 1, 1, "a");
  assert.equal(eventEnvelopeForm(a), eventEnvelopeForm(b));
  assert.notEqual(eventEnvelopeForm(a), eventEnvelopeForm(event("s-w", 1, 1, "z")));
});

test("witness: decoding malformed forms fails closed", () => {
  assert.throws(() => decodeEventWitnessForm('{"not":"an array"}'));
  assert.throws(() => decodeEventWitnessForm('[{"eventId":"e","sessionId":"s","kind":"k","seq":0,"tick":0,"cause":{"kind":"system"},"payload":{"k":"unit"}}]'));
});
