/**
 * Type-level misuse tests and validator tests for the primitive value
 * space. The `@ts-expect-error` directives prove the compiler REJECTS the
 * misuse written beneath them; if any misuse were to start compiling, the
 * unused-directive error fails the typecheck gate instead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asEventId,
  asSessionId,
  isPositiveSequence,
  isValidDigest,
  type EventId,
  type SessionId,
} from "./primitives.ts";

test("brand isolation: a SessionId is not an EventId", () => {
  const sessionId: SessionId = asSessionId("s-1");
  // @ts-expect-error TS2322: branded id spaces are not interchangeable
  const asEvent: EventId = sessionId;
  void asEvent;
  assert.equal(String(sessionId), "s-1");
});

test("brand isolation: plain strings are not branded ids", () => {
  // @ts-expect-error TS2322: unbranded string cannot enter a branded id space
  const sessionId: SessionId = "s-plain";
  void sessionId;
  assert.ok(true);
});

test("brand isolation: unrelated branded scalars do not cross", () => {
  const eventId: EventId = asEventId("e-1");
  // @ts-expect-error TS2322: EventId is not a SessionId
  const sessionId: SessionId = eventId;
  void sessionId;
  assert.ok(true);
});

test("isValidDigest accepts only 64-char lowercase hex", () => {
  assert.equal(isValidDigest("a".repeat(64)), true);
  assert.equal(isValidDigest("A".repeat(64)), false, "uppercase rejected");
  assert.equal(isValidDigest("a".repeat(63)), false, "too short rejected");
  assert.equal(isValidDigest("z".repeat(64)), false, "non-hex rejected");
});

test("isPositiveSequence enforces 1-based safe integers", () => {
  assert.equal(isPositiveSequence(1), true);
  assert.equal(isPositiveSequence(0), false);
  assert.equal(isPositiveSequence(-3), false);
  assert.equal(isPositiveSequence(1.5), false);
  assert.equal(isPositiveSequence(Number.MAX_SAFE_INTEGER), true);
});
