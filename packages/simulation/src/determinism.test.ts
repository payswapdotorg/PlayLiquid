/**
 * Determinism tests (E9, tested hard): identical seeds + identical command
 * streams produce byte-identical event streams and world digests across
 * fresh instances; different seeds and permuted command orders diverge.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTimestamp } from "@playliquid/runtime-contracts";
import { SimulationSession } from "./session.ts";
import { FixedClock, InMemorySnapshotStore } from "./fakes.ts";
import { DEMO_ACTOR_ID, demoEntityRefs, demoGameBinding, demoSeed, movePayload } from "./demo.ts";
import { canonicalValueForm } from "@playliquid/game-ir";
import { createHash } from "node:crypto";

interface ScriptedCommand {
  readonly nonce: string;
  readonly delta: readonly [number, number, number];
  readonly atTick: number;
}

/** The fixed command script both runs execute (identical order + payloads). */
const SCRIPT: readonly ScriptedCommand[] = [
  { nonce: "c-1", delta: [3, 0, 0], atTick: 2 },
  { nonce: "c-2", delta: [0, 5, 0], atTick: 4 },
  { nonce: "c-3", delta: [-2, -1, 4], atTick: 5 },
  { nonce: "c-4", delta: [1, 1, 1], atTick: 7 },
];

function runScriptedSession(id: string, seedVariant: number, script: readonly ScriptedCommand[]): {
  events: string[];
  worldDigest: string;
  finalTick: number;
} {
  const sessionId = id;
  const session = new SimulationSession({
    sessionId: sessionId as never,
    binding: demoGameBinding(sessionId),
    ports: { clock: new FixedClock([10, 11, 12, 13, 14]), snapshotStore: new InMemorySnapshotStore() },
  });
  session.begin(demoSeed(seedVariant));
  let currentTick = 0;
  for (const command of script) {
    // Advance to the command's tick (session must be running to act).
    if (currentTick < command.atTick) {
      session.advanceToTick(command.atTick);
      currentTick = command.atTick;
    }
    const submitted = session.submitRecordedCommand(
      {
        commandId: `cmd-${command.nonce}` as never,
        sessionId: sessionId as never,
        kind: "world.move" as never,
        epoch: 1 as never,
        actor: { actorClass: "avatar-agent", actorId: DEMO_ACTOR_ID },
        origin: { kind: "broker-mediated", grantId: "grant-demo-locomotion" as never },
        idempotencyKey: { scope: "command", actor: DEMO_ACTOR_ID, nonce: command.nonce as never },
        issuedAt: asTimestamp(1),
        payload: movePayload(demoEntityRefs()[0]!, command.delta),
      },
      command.atTick + 1,
    );
    if (submitted.status !== "submitted") {
      throw new Error(`scripted command ${command.nonce} was not admitted: ${JSON.stringify(submitted)}`);
    }
    currentTick = Number(session.view().tick);
  }
  session.advanceToTick(10);
  const events = session.eventLog.map((event) =>
    createHash("sha256")
      .update(
        JSON.stringify({
          eventId: event.eventId,
          kind: event.kind,
          seq: event.seq,
          tick: event.tick,
          cause: event.cause,
          payload: canonicalValueForm(event.payload),
        }),
      )
      .digest("hex"),
  );
  return {
    events,
    worldDigest: session.currentWorldDigest,
    finalTick: Number(session.view().tick),
  };
}

test("determinism: two fully independent runs are byte-identical (E9)", () => {
  const first = runScriptedSession("s-det-a", 1, SCRIPT);
  const second = runScriptedSession("s-det-b", 1, SCRIPT);
  assert.deepEqual(first.events, second.events);
  assert.equal(first.worldDigest, second.worldDigest);
  assert.equal(first.finalTick, 10);
  assert.ok(first.events.length >= 30);
});

test("determinism: a different seed diverges", () => {
  const first = runScriptedSession("s-det-c", 1, SCRIPT);
  const second = runScriptedSession("s-det-d", 2, SCRIPT);
  assert.notDeepEqual(first.events, second.events);
  assert.notEqual(first.worldDigest, second.worldDigest);
});

test("determinism: permuting the command order diverges (order is semantic)", () => {
  // Two commands due at the SAME tick, submitted in opposite orders: the
  // admission sequence (and therefore the execution order within the tick)
  // differs. The EVENT STREAMS diverge (event payloads and causes record
  // the intermediate states in execution order). The final world digest is
  // order-insensitive HERE only because the demo deltas commute — order
  // semantics is asserted on the observable stream, which is the canonical
  // evidence path (E2).
  const pair: readonly ScriptedCommand[] = [
    { nonce: "c-a", delta: [3, 0, 0], atTick: 2 },
    { nonce: "c-b", delta: [0, 7, 0], atTick: 2 },
  ];
  const first = runScriptedSession("s-det-e", 1, pair);
  const second = runScriptedSession("s-det-f", 1, [pair[1]!, pair[0]!]);
  assert.notDeepEqual(first.events, second.events);
});

test("determinism: mutating one command payload diverges", () => {
  const first = runScriptedSession("s-det-g", 1, SCRIPT);
  const mutated = SCRIPT.map((command, index) =>
    index === 1 ? { ...command, delta: [0, 5.5, 0] as readonly [number, number, number] } : command,
  );
  const second = runScriptedSession("s-det-h", 1, mutated);
  assert.notDeepEqual(first.events, second.events);
  assert.notEqual(first.worldDigest, second.worldDigest);
});

test("determinism: stepping in different batch sizes yields identical results", () => {
  // Run A: one step of 10 ticks. Run B: ten steps of 1 tick. Same seed and
  // commands applied at the same ticks -> identical streams (fixed-tick
  // determinism, independent of batching).
  // Batched: single step of 10.
  const sessionA = new SimulationSession({
    sessionId: "s-det-i" as never,
    binding: demoGameBinding("s-det-i"),
    ports: { clock: new FixedClock([1]), snapshotStore: new InMemorySnapshotStore() },
  });
  sessionA.begin(demoSeed(3));
  sessionA.submitRecordedCommand(
    {
      commandId: "cmd-b1" as never,
      sessionId: "s-det-i" as never,
      kind: "world.move" as never,
      epoch: 1 as never,
      actor: { actorClass: "avatar-agent", actorId: DEMO_ACTOR_ID },
      origin: { kind: "broker-mediated", grantId: "grant-demo-locomotion" as never },
      idempotencyKey: { scope: "command", actor: DEMO_ACTOR_ID, nonce: "b1" as never },
      issuedAt: asTimestamp(1),
      payload: movePayload(demoEntityRefs()[1]!, [2, 2, 2]),
    },
    5,
  );
  sessionA.step({ op: "step", sessionId: "s-det-i" as never, ticks: 10 });

  // Incremental: ten steps of 1.
  const sessionB = new SimulationSession({
    sessionId: "s-det-j" as never,
    binding: demoGameBinding("s-det-j"),
    ports: { clock: new FixedClock([1]), snapshotStore: new InMemorySnapshotStore() },
  });
  sessionB.begin(demoSeed(3));
  sessionB.submitRecordedCommand(
    {
      commandId: "cmd-b1" as never,
      sessionId: "s-det-j" as never,
      kind: "world.move" as never,
      epoch: 1 as never,
      actor: { actorClass: "avatar-agent", actorId: DEMO_ACTOR_ID },
      origin: { kind: "broker-mediated", grantId: "grant-demo-locomotion" as never },
      idempotencyKey: { scope: "command", actor: DEMO_ACTOR_ID, nonce: "b1" as never },
      issuedAt: asTimestamp(1),
      payload: movePayload(demoEntityRefs()[1]!, [2, 2, 2]),
    },
    5,
  );
  for (let i = 0; i < 10; i += 1) {
    sessionB.step({ op: "step", sessionId: "s-det-j" as never, ticks: 1 });
  }
  assert.equal(sessionA.currentWorldDigest, sessionB.currentWorldDigest);
  assert.equal(sessionA.eventLog.length, sessionB.eventLog.length);
  const fingerprint = (log: readonly { eventId: unknown; kind: unknown; seq: unknown; tick: unknown }[]): string =>
    createHash("sha256")
      .update(log.map((e) => `${e.eventId}:${e.kind}:${e.seq}:${e.tick}`).join("|"))
      .digest("hex");
  assert.equal(fingerprint(sessionA.eventLog), fingerprint(sessionB.eventLog));
});
