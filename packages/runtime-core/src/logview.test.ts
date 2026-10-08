/**
 * Epoch-segmented log validation tests: boundary splitting, cross-segment
 * tick resets, and the contract order oracle applied per segment.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asCommandId, asEventId, asEventKind, asEventSequence, asSessionId, asTick } from "@playliquid/runtime-contracts";
import type { CommandId, RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import {
  SESSION_BOUNDARY_EVENT_KINDS,
  isSessionBoundaryEvent,
  splitLogSegments,
  validateKernelEventLog,
} from "./logview.ts";

const SESSION = asSessionId("log-1");
const CMD: CommandId = asCommandId("cmd-1");

function event(seq: number, tick: number, kind = "world.counted"): RuntimeEventEnvelope {
  return {
    eventId: asEventId(`log-1#e${String(seq)}`),
    sessionId: SESSION,
    kind: asEventKind(kind),
    seq: asEventSequence(seq),
    tick: asTick(tick),
    cause: { kind: "system" },
    payload: { seq, tick },
  };
}

test("boundary kinds are exactly the epoch markers", () => {
  assert.deepEqual([...SESSION_BOUNDARY_EVENT_KINDS].sort(), ["runtime.session-reset", "runtime.session-restored"]);
  assert.equal(isSessionBoundaryEvent(event(1, 0, "runtime.session-reset")), true);
  assert.equal(isSessionBoundaryEvent(event(1, 0, "runtime.session-restored")), true);
  assert.equal(isSessionBoundaryEvent(event(1, 0, "runtime.session-loaded")), false);
});

test("splitLogSegments: a log without boundaries is one segment", () => {
  const events = [event(1, 0), event(2, 1), event(3, 1)];
  const segments = splitLogSegments(events);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.length, 3);
});

test("splitLogSegments: boundary events START new segments", () => {
  const events = [
    event(1, 0),
    event(2, 1),
    event(3, 0, "runtime.session-reset"),
    event(4, 0),
    event(5, 2, "runtime.session-restored"),
    event(6, 7),
  ];
  const segments = splitLogSegments(events);
  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((segment) => segment.map((item) => Number(item.seq))),
    [[1, 2], [3, 4], [5, 6]],
  );
});

test("validateKernelEventLog: tick regression across a boundary is legitimate", () => {
  const events = [
    event(1, 0),
    event(2, 5),
    event(3, 0, "runtime.session-reset"),
    event(4, 1),
    event(5, 0, "runtime.session-restored"),
    event(6, 0),
  ];
  const validation = validateKernelEventLog(events, []);
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.deepEqual(validation.span, { sessionId: SESSION, firstSeq: 1, lastSeq: 6, count: 6 });
  }
});

test("validateKernelEventLog: tick regression WITHIN a segment is a violation", () => {
  const events = [event(1, 3), event(2, 1)];
  const validation = validateKernelEventLog(events, []);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.code, "tick-regression");
});

test("validateKernelEventLog: sequence gaps are violations", () => {
  const events = [event(1, 0), event(3, 1)];
  const validation = validateKernelEventLog(events, []);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.code, "sequence-gap");
});

test("validateKernelEventLog: unadmitted command causes are violations", () => {
  const events: RuntimeEventEnvelope[] = [
    { ...event(1, 0), cause: { kind: "command", commandId: CMD } },
  ];
  const validation = validateKernelEventLog(events, []);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.code, "unresolved-command-cause");
});

test("validateKernelEventLog: admitted command causes validate", () => {
  const events: RuntimeEventEnvelope[] = [
    { ...event(1, 0), cause: { kind: "command", commandId: CMD } },
  ];
  const validation = validateKernelEventLog(events, [CMD]);
  assert.equal(validation.ok, true);
});

test("validateKernelEventLog: empty logs are reported as empty", () => {
  const validation = validateKernelEventLog([], []);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.code, "empty-stream");
});
