/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Builds a fake 3-event session on the canonical event path, validates the
 * order with the pure oracle, prints the result, then validates a
 * deliberately corrupted copy (a sequence gap) to show the oracle rejects
 * it. Prints machine-readable JSON; exits non-zero on any unexpected
 * outcome. No IO beyond stdout; no clock, no randomness.
 */

import { validateEventStream } from "./events.ts";
import {
  asCommandId,
  asEventId,
  asEventKind,
  asEventSequence,
  asSessionId,
  asTick,
} from "./primitives.ts";
import type { RuntimeEventEnvelope } from "./events.ts";

const sessionId = asSessionId("session-harness-1");
const commandMove = asCommandId("cmd-1");
const commandStop = asCommandId("cmd-2");

const goodStream: readonly RuntimeEventEnvelope[] = [
  {
    eventId: asEventId("evt-1"),
    sessionId,
    kind: asEventKind("world.actor-moved"),
    seq: asEventSequence(1),
    tick: asTick(0),
    cause: { kind: "command", commandId: commandMove },
    payload: { actor: "avatar-1", to: [3, 4] },
  },
  {
    eventId: asEventId("evt-2"),
    sessionId,
    kind: asEventKind("world.actor-stopped"),
    seq: asEventSequence(2),
    tick: asTick(1),
    cause: { kind: "command", commandId: commandStop },
    payload: { actor: "avatar-1" },
  },
  {
    eventId: asEventId("evt-3"),
    sessionId,
    kind: asEventKind("world.snapshot-boundary"),
    seq: asEventSequence(3),
    tick: asTick(1),
    cause: { kind: "event", causedByEventId: asEventId("evt-2") },
    payload: { atTick: 1 },
  },
];

const admitted = [commandMove, commandStop];
const good = validateEventStream(goodStream, { admittedCommandIds: admitted });

const corruptedStream: readonly RuntimeEventEnvelope[] = [
  goodStream[0] as RuntimeEventEnvelope,
  { ...(goodStream[2] as RuntimeEventEnvelope), seq: asEventSequence(3) },
];
const corrupted = validateEventStream(corruptedStream, { admittedCommandIds: admitted });

const report = {
  harness: "runtime-contracts/event-order",
  good: { ok: good.ok, span: good.ok ? good.span : null, code: good.ok ? null : good.code },
  corrupted: corrupted.ok
    ? { ok: true, unexpected: "corrupted stream validated" }
    : { ok: false, code: corrupted.code, index: corrupted.index },
};

console.log(JSON.stringify(report, null, 2));

if (!good.ok || good.span === undefined || good.span.count !== 3 || good.span.lastSeq !== 3) {
  throw new Error("HARNESS FAIL: good stream did not validate as span 1..3");
}
if (corrupted.ok || corrupted.code !== "sequence-gap") {
  throw new Error("HARNESS FAIL: corrupted stream was not rejected as sequence-gap");
}
console.log("HARNESS PASS: order oracle accepted the 3-event session and rejected the gap");
