/**
 * Canonical serialization tests: byte stability, key-order independence,
 * domain rejection, and snapshot payload codec validation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalEncodeError,
  SNAPSHOT_FORMAT,
  SnapshotDecodeError,
  canonicalJson,
  decodeSnapshotPayload,
  encodeSnapshotBytes,
  isJsonSafeValue,
} from "./serialize.ts";
import type { KernelSnapshotPayload } from "./serialize.ts";

test("canonicalJson: object key order never changes the bytes", () => {
  const a = canonicalJson({ b: 2, a: 1, nested: { y: true, x: null } });
  const b = canonicalJson({ nested: { x: null, y: true }, a: 1, b: 2 });
  assert.equal(a, b);
  assert.equal(a, '{"a":1,"b":2,"nested":{"x":null,"y":true}}');
});

test("canonicalJson: array order is preserved (order is semantic)", () => {
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  assert.notEqual(canonicalJson([1, 2, 3]), canonicalJson([3, 2, 1]));
});

test("canonicalJson: strings escape identically to JSON", () => {
  assert.equal(canonicalJson({ path: "a\"b\\c\nd", unicode: "é" }), '{"path":"a\\"b\\\\c\\nd","unicode":"é"}');
});

test("canonicalJson: safe integers render as plain decimals", () => {
  assert.equal(canonicalJson({ n: 42, zero: 0, neg: -7, max: Number.MAX_SAFE_INTEGER }), '{"max":9007199254740991,"n":42,"neg":-7,"zero":0}');
});

test("canonicalJson: booleans and null are stable", () => {
  assert.equal(canonicalJson([true, false, null]), "[true,false,null]");
});

test("canonicalJson: rejects values outside the JSON-safe domain", () => {
  const bad: unknown[] = [
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
    undefined,
    () => 1,
    Symbol("x"),
    new Map(),
    new (class Thing {})(),
    new Date(0),
    [undefined],
    { nested: { deep: 1.5 } },
  ];
  for (const value of bad) {
    assert.throws(() => canonicalJson(value), CanonicalEncodeError, `must reject ${String(value)}`);
  }
});

test("isJsonSafeValue: guards the domain", () => {
  assert.equal(isJsonSafeValue({ a: [1, "x", null], b: false }), true);
  assert.equal(isJsonSafeValue({ a: 0.25 }), false);
  assert.equal(isJsonSafeValue(new Map()), false);
});

test("canonicalJson: nested structure round-trips deterministically", () => {
  const value = { list: [{ z: 1, a: 2 }, { z: 3, a: 4 }], flag: true };
  const once = canonicalJson(value);
  const twice = canonicalJson(JSON.parse(once));
  assert.equal(once, twice);
});

test("snapshot codec: encode is byte-stable for identical payloads", () => {
  const payload: KernelSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    sessionId: "s-1",
    epoch: 1,
    tick: 7,
    committedEventSeq: 12,
    admittedCommandSeq: 3,
    worldKind: "kind@1",
    world: { count: 9, moves: [1, 2, 3] },
    determinism: "seed-1",
  };
  const sameValues: KernelSnapshotPayload = {
    world: { moves: [1, 2, 3], count: 9 },
    determinism: "seed-1",
    worldKind: "kind@1",
    admittedCommandSeq: 3,
    committedEventSeq: 12,
    tick: 7,
    epoch: 1,
    sessionId: "s-1",
    format: SNAPSHOT_FORMAT,
  };
  assert.equal(encodeSnapshotBytes(payload), encodeSnapshotBytes(sameValues));
});

test("snapshot codec: decode validates the frozen format", () => {
  const payload: KernelSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    sessionId: "s-1",
    epoch: 1,
    tick: 0,
    committedEventSeq: 0,
    admittedCommandSeq: 0,
    worldKind: "kind@1",
    world: {},
  };
  const decoded = decodeSnapshotPayload(JSON.parse(encodeSnapshotBytes(payload)), {
    sessionId: "s-1",
    worldKind: "kind@1",
  });
  assert.deepEqual({ ...decoded, determinism: decoded.determinism ?? undefined }, { ...payload, determinism: undefined });
});

test("snapshot codec: decode refuses foreign formats", () => {
  assert.throws(
    () =>
      decodeSnapshotPayload(
        { format: "playliquid.runtime-core.snapshot/0", sessionId: "s-1", epoch: 1, tick: 0, committedEventSeq: 0, admittedCommandSeq: 0, worldKind: "k", world: {} },
        { sessionId: "s-1", worldKind: "k" },
      ),
    SnapshotDecodeError,
  );
});

test("snapshot codec: decode refuses malformed payloads", () => {
  const expectations: unknown[] = [
    null,
    [],
    "nope",
    { format: SNAPSHOT_FORMAT, sessionId: 1, tick: 0, committedEventSeq: 0, admittedCommandSeq: 0, worldKind: "k", world: {} },
    { format: SNAPSHOT_FORMAT, sessionId: "s-1", epoch: -1, tick: 0, committedEventSeq: 0, admittedCommandSeq: 0, worldKind: "k", world: {} },
    { format: SNAPSHOT_FORMAT, sessionId: "s-1", epoch: 1, tick: 0.5, committedEventSeq: 0, admittedCommandSeq: 0, worldKind: "k", world: {} },
    { format: SNAPSHOT_FORMAT, sessionId: "s-1", epoch: 1, tick: 0, committedEventSeq: 0, admittedCommandSeq: 0, worldKind: "k", world: { bad: 0.5 } },
    { format: SNAPSHOT_FORMAT, sessionId: "s-1", epoch: 1, tick: 0, committedEventSeq: 0, admittedCommandSeq: 0, worldKind: "k", world: {}, determinism: 5 },
  ];
  for (const raw of expectations) {
    assert.throws(() => decodeSnapshotPayload(raw, { sessionId: "s-1", worldKind: "k" }), SnapshotDecodeError);
  }
});

test("snapshot codec: decode enforces session and world identity", () => {
  const base = {
    format: SNAPSHOT_FORMAT,
    epoch: 1,
    tick: 0,
    committedEventSeq: 0,
    admittedCommandSeq: 0,
    world: { count: 0 },
  };
  assert.throws(
    () => decodeSnapshotPayload({ ...base, sessionId: "other", worldKind: "k" }, { sessionId: "s-1", worldKind: "k" }),
    (error: unknown) => error instanceof SnapshotDecodeError && error.code === "session-mismatch",
  );
  assert.throws(
    () => decodeSnapshotPayload({ ...base, sessionId: "s-1", worldKind: "other" }, { sessionId: "s-1", worldKind: "k" }),
    (error: unknown) => error instanceof SnapshotDecodeError && error.code === "world-kind-mismatch",
  );
});
