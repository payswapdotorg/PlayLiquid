/**
 * Command stream tests: content addressing (byte-stable digests), admission
 * ordering, structural validation, tamper detection and form round-trips.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sealCommandStream, verifyCommandStream, decodeCommandStreamForm } from "./command-stream.ts";
import type { RecordedCommand } from "./command-stream.ts";
import { demoEntityRefs, movePayload } from "@playliquid/simulation";
import { moveEnvelope } from "./test-fixtures.ts";

function entries(sessionId: string): RecordedCommand[] {
  return [
    { admissionSeq: 2, dueTick: 5, envelope: moveEnvelope(sessionId, "b", [0, 1, 0]) },
    { admissionSeq: 1, dueTick: 3, envelope: moveEnvelope(sessionId, "a", [1, 0, 0]) },
    { admissionSeq: 3, dueTick: 7, envelope: moveEnvelope(sessionId, "c", [0, 0, 2]) },
  ];
}

test("stream: sealing sorts entries into admission order", () => {
  const artifact = sealCommandStream(entries("s-stream"));
  assert.deepEqual(artifact.entries.map((entry) => entry.admissionSeq), [1, 2, 3]);
  assert.deepEqual(artifact.entries.map((entry) => entry.envelope.commandId), ["cmd-a", "cmd-b", "cmd-c"]);
});

test("stream: identical entries seal to identical bytes and digests (E9)", () => {
  const first = sealCommandStream(entries("s-stream"));
  const second = sealCommandStream([...entries("s-stream")].reverse());
  assert.equal(first.form, second.form);
  assert.equal(first.streamDigest, second.streamDigest);
  // A different payload diverges.
  const mutated = entries("s-stream").map((entry, index) =>
    index === 0 ? { ...entry, envelope: { ...entry.envelope, payload: movePayload(demoEntityRefs()[0]!, [9, 9, 9]) } } : entry,
  );
  assert.notEqual(sealCommandStream(mutated).streamDigest, first.streamDigest);
});

test("stream: artifacts verify end-to-end", () => {
  const artifact = sealCommandStream(entries("s-stream"));
  const verification = verifyCommandStream(artifact);
  assert.equal(verification.ok, true);
  if (verification.ok) assert.equal(verification.streamDigest, artifact.streamDigest);
});

test("stream: structural violations fail closed at seal time", () => {
  assert.throws(() => sealCommandStream([{ admissionSeq: 0, dueTick: 3, envelope: moveEnvelope("s", "x", [1, 0, 0]) }]));
  assert.throws(() =>
    sealCommandStream([
      { admissionSeq: 1, dueTick: 3, envelope: moveEnvelope("s", "x", [1, 0, 0]) },
      { admissionSeq: 1, dueTick: 4, envelope: moveEnvelope("s", "y", [1, 0, 0]) },
    ]),
  );
  assert.throws(() => sealCommandStream([{ admissionSeq: 1, dueTick: 0, envelope: moveEnvelope("s", "x", [1, 0, 0]) }]));
  assert.throws(() =>
    sealCommandStream([
      { admissionSeq: 1, dueTick: 3, envelope: moveEnvelope("s", "x", [1, 0, 0]) },
      { admissionSeq: 2, dueTick: 4, envelope: moveEnvelope("s", "x", [1, 0, 0]) },
    ]),
  );
});

test("stream: tampering with entries is detected by verification", () => {
  const artifact = sealCommandStream(entries("s-stream"));
  // Same digest + form, but the ENTRIES were swapped after sealing.
  const tampered = {
    streamDigest: artifact.streamDigest,
    form: artifact.form,
    entries: [...artifact.entries].reverse(),
  };
  const verdict = verifyCommandStream(tampered);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "malformed-entries");
  // Entries mutated but form/digest left stale.
  const stale = {
    streamDigest: artifact.streamDigest,
    form: artifact.form,
    entries: artifact.entries.map((entry, index) =>
      index === 0 ? { ...entry, dueTick: 99 } : entry,
    ),
  };
  const staleVerdict = verifyCommandStream(stale);
  assert.equal(staleVerdict.ok, false);
  if (!staleVerdict.ok) assert.equal(staleVerdict.code, "form-mismatch");
});

test("stream: the canonical form decodes back to the same typed entries", () => {
  const artifact = sealCommandStream(entries("s-stream"));
  const decoded = decodeCommandStreamForm(artifact.form);
  assert.equal(decoded.length, artifact.entries.length);
  for (let i = 0; i < decoded.length; i += 1) {
    assert.equal(decoded[i]?.admissionSeq, artifact.entries[i]?.admissionSeq);
    assert.equal(decoded[i]?.dueTick, artifact.entries[i]?.dueTick);
    assert.equal(decoded[i]?.envelope.commandId, artifact.entries[i]?.envelope.commandId);
  }
  // Re-sealing the decoded entries reproduces the SAME artifact bytes.
  const resealed = sealCommandStream(decoded);
  assert.equal(resealed.form, artifact.form);
  assert.equal(resealed.streamDigest, artifact.streamDigest);
});

test("stream: decoding malformed forms fails closed", () => {
  assert.throws(() => decodeCommandStreamForm('{"not":"an array"}'));
  assert.throws(() => decodeCommandStreamForm('[{"s":0,"d":1,"c":{}}]'));
  assert.throws(() => decodeCommandStreamForm('[{"s":1,"d":1}]'));
  // An empty stream is a legal (command-less) capture: it decodes to [].
  assert.deepEqual(decodeCommandStreamForm("[]"), []);
});
