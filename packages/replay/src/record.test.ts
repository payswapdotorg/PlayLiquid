/**
 * Replay record tests: content-addressed identity (same body → same id),
 * the boundary rule (seq 1 or snapshot boundary + 1), provenance
 * validation (frozen R8 vocabulary), and E10 immutability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTimestamp } from "@playliquid/runtime-contracts";
import { sealReplayRecord, validateReplayRecordBody, replayRecordIdentity } from "./record.ts";
import type { ReplayRecordBody } from "./record.ts";
import { captureBoundaryScenario, captureOriginScenario } from "./test-fixtures.ts";

const STREAM_DIGEST = "sha256:" + "a".repeat(64);
const WITNESS_DIGEST = "sha256:" + "b".repeat(64);

function body(overrides: Partial<ReplayRecordBody> = {}): ReplayRecordBody {
  return {
    sessionId: "s-record" as never,
    game: {
      gameDigest: "9".repeat(64) as never,
      world: { worldId: "world-primus", revisionDigest: "7".repeat(64) as never },
      policy: { policyId: "policy-demo", revisionDigest: "5".repeat(64) as never },
    },
    determinism: "demo-seed-1" as never,
    capture: { fromEventSeq: 1, toEventSeq: 10, toTick: 10 },
    commandStream: STREAM_DIGEST,
    eventWitness: WITNESS_DIGEST,
    provenance: {
      capturedBy: "qa-harness",
      capturedAt: asTimestamp(1000),
      runtimeRole: "simulation",
      tool: "replay-test/1.0",
      consumers: ["qa", "integrity"],
    },
    ...overrides,
  };
}

test("record: same body seals to the same identity; any change diverges (E10)", () => {
  const first = sealReplayRecord(body());
  const second = sealReplayRecord(body());
  assert.equal(first.replayId, second.replayId);
  assert.ok(first.replayId.startsWith("replay-"));
  assert.equal(first.replayId.length, "replay-".length + 64);
  // Changing ANY semantic field changes the identity.
  const changedSeed = sealReplayRecord(body({ determinism: "demo-seed-2" as never }));
  assert.notEqual(changedSeed.replayId, first.replayId);
  const changedStream = sealReplayRecord(body({ commandStream: "sha256:" + "c".repeat(64) }));
  assert.notEqual(changedStream.replayId, first.replayId);
  const changedRange = sealReplayRecord(body({ capture: { fromEventSeq: 1, toEventSeq: 9, toTick: 10 } }));
  assert.notEqual(changedRange.replayId, first.replayId);
});

test("record: the identity oracle re-derives the id from the fields", () => {
  const record = sealReplayRecord(body());
  assert.equal(replayRecordIdentity(record), record.replayId);
});

test("record: boundary captures must start at boundary.afterEventSeq + 1", () => {
  const boundary = {
    snapshotId: "snap-" + "d".repeat(64),
    formDigest: "e".repeat(64),
    afterEventSeq: 12,
    tick: 5,
    artifact: { snapshotId: "snap-" + "d".repeat(64) },
  };
  const ok = body({ capture: { fromEventSeq: 13, toEventSeq: 20, toTick: 10, boundary } });
  assert.equal(validateReplayRecordBody(ok).ok, true);
  const midStream = body({ capture: { fromEventSeq: 14, toEventSeq: 20, toTick: 10, boundary } });
  const verdict = validateReplayRecordBody(midStream);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "mid-stream-start");
  const beforeBoundary = body({ capture: { fromEventSeq: 13, toEventSeq: 12, toTick: 10, boundary } });
  const backward = validateReplayRecordBody(beforeBoundary);
  assert.equal(backward.ok, false);
});

test("record: origin captures must start at seq 1 (no mid-stream starts)", () => {
  const midStream = body({ capture: { fromEventSeq: 2, toEventSeq: 9, toTick: 10 } });
  const verdict = validateReplayRecordBody(midStream);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "mid-stream-start");
});

test("record: malformed references and provenance fail closed", () => {
  const badStream = body({ commandStream: "not-a-digest" });
  assert.equal(validateReplayRecordBody(badStream).ok, false);
  const badWitness = body({ eventWitness: "sha256:xyz" });
  assert.equal(validateReplayRecordBody(badWitness).ok, false);
  const noSeed = body({ determinism: "" as never });
  const seedVerdict = validateReplayRecordBody(noSeed);
  assert.equal(seedVerdict.ok, false);
  if (!seedVerdict.ok) assert.equal(seedVerdict.code, "determinism-seed-missing");
  const badConsumers = body({
    provenance: {
      capturedBy: "qa",
      capturedAt: asTimestamp(1),
      runtimeRole: "simulation",
      tool: "t",
      consumers: ["player", "cheater"] as never,
    },
  });
  const consumerVerdict = validateReplayRecordBody(badConsumers);
  assert.equal(consumerVerdict.ok, false);
  if (!consumerVerdict.ok) assert.equal(consumerVerdict.code, "provenance-malformed");
  const badRole = body({
    provenance: {
      capturedBy: "qa",
      capturedAt: asTimestamp(1),
      runtimeRole: "mystic" as never,
      tool: "t",
      consumers: ["player"],
    },
  });
  assert.equal(validateReplayRecordBody(badRole).ok, false);
  // Seal itself throws on invalid bodies (fail closed at write time).
  assert.throws(() => sealReplayRecord(badStream));
});

test("record: sealed records are frozen (E10 immutability)", () => {
  const record = sealReplayRecord(body());
  assert.throws(() => {
    (record as unknown as { replayId: string }).replayId = "replay-forged";
  }, TypeError);
  assert.throws(() => {
    (record as unknown as { commandStream: string }).commandStream = "sha256:" + "f".repeat(64);
  }, TypeError);
});

test("record: scenario captures seal and re-verify their identities", () => {
  const origin = captureOriginScenario("s-record-origin");
  assert.equal(replayRecordIdentity(origin.record), origin.record.replayId);
  assert.equal(origin.record.capture.fromEventSeq, 1);
  const boundary = captureBoundaryScenario("s-record-boundary");
  assert.equal(replayRecordIdentity(boundary.record), boundary.record.replayId);
  assert.equal(boundary.record.capture.fromEventSeq, boundary.boundarySeq + 1);
  assert.ok(boundary.record.capture.boundary !== undefined);
  if (boundary.record.capture.boundary !== undefined) {
    assert.equal(boundary.record.capture.boundary.afterEventSeq, boundary.boundarySeq);
  }
});
