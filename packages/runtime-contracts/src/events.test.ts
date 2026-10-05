/**
 * Canonical event path tests (E2): the pure order oracle over event
 * streams, plus the one-command/one-event-per-behavior registry check.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCanonicalPaths,
  validateEventStream,
  type CanonicalBehaviorPath,
  type RuntimeEventEnvelope,
} from "./events.ts";
import {
  asCommandId,
  asEventId,
  asEventKind,
  asEventSequence,
  asSessionId,
  asTick,
} from "./primitives.ts";

const sessionId = asSessionId("s-evt");
const cmd1 = asCommandId("cmd-1");
const cmd2 = asCommandId("cmd-2");

function event(
  n: number,
  over: Partial<RuntimeEventEnvelope> = {},
): RuntimeEventEnvelope {
  return {
    eventId: asEventId(`evt-${n}`),
    sessionId,
    kind: asEventKind("world.changed"),
    seq: asEventSequence(n),
    tick: asTick(n),
    cause: { kind: "system" },
    payload: {},
    ...over,
  };
}

test("a well-formed 3-event session validates with span 1..3", () => {
  const stream = [
    event(1),
    event(2, { cause: { kind: "command", commandId: cmd2 } }),
    event(3, { cause: { kind: "event", causedByEventId: asEventId("evt-2") } }),
  ];
  const result = validateEventStream(stream, { admittedCommandIds: [cmd1, cmd2] });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.span.firstSeq, 1);
    assert.equal(result.span.lastSeq, 3);
    assert.equal(result.span.count, 3);
    assert.equal(result.span.sessionId, sessionId);
  }
});

test("empty streams are rejected as empty-stream", () => {
  const result = validateEventStream([]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "empty-stream");
  }
});

test("streams mixing sessions are rejected", () => {
  const stream = [
    event(1),
    event(2, { sessionId: asSessionId("s-other") }),
  ];
  const result = validateEventStream(stream);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "session-mixed");
    assert.equal(result.index, 1);
  }
});

test("sequence regressions are rejected", () => {
  const stream = [event(1), event(2), event(2, { eventId: asEventId("evt-2b") })];
  const result = validateEventStream(stream);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "sequence-regression");
    assert.equal(result.index, 2);
  }
});

test("sequence gaps are rejected", () => {
  const stream = [event(1), event(3)];
  const result = validateEventStream(stream);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "sequence-gap");
  }
});

test("resumed streams may start at a declared cursor", () => {
  const stream = [event(5), event(6)];
  const result = validateEventStream(stream, { startAtSeq: 5 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.span.firstSeq, 5);
    assert.equal(result.span.count, 2);
  }
});

test("equal ticks are legal; regressions are not", () => {
  const sameTick = [event(1, { tick: asTick(7) }), event(2, { tick: asTick(7) })];
  assert.equal(validateEventStream(sameTick).ok, true);
  const regression = [event(1, { tick: asTick(7) }), event(2, { tick: asTick(6) })];
  const result = validateEventStream(regression);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "tick-regression");
  }
});

test("events citing unadmitted commands are rejected (E2 causality)", () => {
  const stream = [event(1, { cause: { kind: "command", commandId: asCommandId("cmd-ghost") } })];
  const result = validateEventStream(stream, { admittedCommandIds: [cmd1] });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "unresolved-command-cause");
  }
});

test("events citing later events are rejected (forward reference)", () => {
  const stream = [event(1, { cause: { kind: "event", causedByEventId: asEventId("evt-2") } }), event(2)];
  const result = validateEventStream(stream);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "forward-event-cause");
    assert.equal(result.index, 0);
  }
});

test("system-caused events need no proof", () => {
  const stream = [event(1, { cause: { kind: "system" } }), event(2, { cause: { kind: "system" } })];
  assert.equal(validateEventStream(stream).ok, true);
});

test("E2 registry: one command kind and event kinds per behavior", () => {
  const paths: CanonicalBehaviorPath[] = [
    { behaviorId: "move", commandKind: "world.move", eventKinds: ["world.moved"] },
    { behaviorId: "speak", commandKind: "world.speak", eventKinds: ["world.spoke"] },
  ];
  assert.deepEqual(validateCanonicalPaths(paths), []);
});

test("E2 registry: shared command kind across behaviors is a violation", () => {
  const paths: CanonicalBehaviorPath[] = [
    { behaviorId: "move", commandKind: "world.move", eventKinds: ["world.moved"] },
    { behaviorId: "fast-move", commandKind: "world.move", eventKinds: ["world.fast-moved"] },
  ];
  const violations = validateCanonicalPaths(paths);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.code, "command-kind-shared");
});

test("E2 registry: duplicate behavior ids and shared event kinds are violations", () => {
  const paths: CanonicalBehaviorPath[] = [
    { behaviorId: "move", commandKind: "a", eventKinds: ["world.moved"] },
    { behaviorId: "move", commandKind: "b", eventKinds: ["world.moved"] },
    { behaviorId: "speak", commandKind: "c", eventKinds: ["world.moved"] },
  ];
  const violations = validateCanonicalPaths(paths);
  const codes = violations.map((v) => v.code).sort();
  assert.deepEqual(codes, ["duplicate-behavior", "event-kind-shared"]);
});
