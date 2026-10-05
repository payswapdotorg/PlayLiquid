/**
 * Idempotency + stale-result semantics tests: key equality, duplicate vs
 * collision classification, and the epoch-based stale-result rule.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStaleResultRule,
  classifyEncounter,
  idempotencyKeyEquals,
  retainCurrentResults,
  type EpochedResult,
  type IdempotencyKey,
} from "./idempotency.ts";
import { asActorId, asIdempotencyNonce, asSessionEpoch } from "./primitives.ts";

const key = (over: Partial<IdempotencyKey> = {}): IdempotencyKey => ({
  scope: "command",
  actor: asActorId("actor-1"),
  nonce: asIdempotencyNonce("nonce-1"),
  ...over,
});

test("key equality is structural over scope, actor and nonce", () => {
  assert.equal(idempotencyKeyEquals(key(), key()), true);
  assert.equal(idempotencyKeyEquals(key(), key({ scope: "action" })), false);
  assert.equal(idempotencyKeyEquals(key(), key({ actor: asActorId("actor-2") })), false);
  assert.equal(idempotencyKeyEquals(key(), key({ nonce: asIdempotencyNonce("nonce-2") })), false);
});

test("same actor and nonce in different scopes are DIFFERENT keys", () => {
  const command = key();
  const action = key({ scope: "action" });
  assert.equal(idempotencyKeyEquals(command, action), false, "scopes partition the key space");
});

test("classification: distinct keys are first encounters", () => {
  const result = classifyEncounter(
    { key: key(), fingerprint: "fp-1" },
    { key: key({ nonce: asIdempotencyNonce("other") }), fingerprint: "fp-1" },
  );
  assert.deepEqual(result, { classification: "first" });
});

test("classification: same key + same fingerprint is a duplicate (E2/E6 idempotent replay)", () => {
  const result = classifyEncounter(
    { key: key(), fingerprint: "fp-1" },
    { key: key(), fingerprint: "fp-1" },
  );
  assert.deepEqual(result, { classification: "duplicate", firstFingerprint: "fp-1" });
});

test("classification: same key + different fingerprint is a COLLISION, never a rerun", () => {
  const result = classifyEncounter(
    { key: key(), fingerprint: "fp-original" },
    { key: key(), fingerprint: "fp-attack" },
  );
  assert.deepEqual(result, {
    classification: "collision",
    firstFingerprint: "fp-original",
    repeatedFingerprint: "fp-attack",
  });
});

test("stale-result rule: only the current epoch is current", () => {
  const result: EpochedResult = { epoch: asSessionEpoch(2) };
  assert.deepEqual(applyStaleResultRule(result, asSessionEpoch(2)), {
    stale: false,
    disposition: "current",
  });
  assert.deepEqual(applyStaleResultRule(result, asSessionEpoch(3)), {
    stale: true,
    disposition: "superseded",
  }, "epoch bumped by reset/restore");
  assert.deepEqual(applyStaleResultRule(result, asSessionEpoch(1)), {
    stale: true,
    disposition: "superseded",
  }, "future-epoch results fail closed as stale");
});

test("retainCurrentResults filters and preserves order", () => {
  const results: readonly EpochedResult[] = [
    { epoch: asSessionEpoch(1) },
    { epoch: asSessionEpoch(2) },
    { epoch: asSessionEpoch(1) },
    { epoch: asSessionEpoch(2) },
  ];
  const kept = retainCurrentResults(results, asSessionEpoch(2));
  assert.equal(kept.length, 2);
  assert.ok(kept.every((r) => r.epoch === asSessionEpoch(2)));
});

test("type-level: fingerprints are opaque, not interpreted", () => {
  const recorded = { key: key(), fingerprint: "anything-opaque" };
  // @ts-expect-error TS2339: no semantic accessor exists on a fingerprint
  const score = recorded.fingerprint.score;
  assert.equal(score, undefined, "fingerprints are opaque strings");
});
