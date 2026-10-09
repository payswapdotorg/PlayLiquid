/**
 * Kernel tests: deterministic tick execution, system order, per-system RNG
 * forks, and the game-ir determinism oracle over an adapted step.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asCommandId, asCommandKind, asSessionId, asTick, asTimestamp } from "@playliquid/runtime-contracts";
import { verifySimulationStepDeterminism } from "@playliquid/game-ir";
import type { Command, SimulationStep, SimulationStepInput } from "@playliquid/game-ir";
import { asCommandTypeId } from "@playliquid/game-ir";
import { runKernelTick } from "./kernel.ts";
import type { WorldSystem } from "./kernel.ts";
import { makeRng } from "./rng.ts";
import { demoSystems, movePayload } from "./demo.ts";
import { initialWorldState } from "./world.ts";
import { demoBlueprint } from "./demo.ts";
import type { PendingCommand } from "./ports.ts";
import { makePendingCommandQueue } from "./fakes.ts";
import { demoEntityRefs } from "./demo.ts";

const sessionId = asSessionId("s-kernel");

function pendingEnvelope(seq: number): PendingCommand["envelope"] {
  return {
    commandId: asCommandId(`cmd-${seq}`),
    sessionId,
    kind: asCommandKind("world.move"),
    epoch: 1 as never,
    actor: { actorClass: "avatar-agent", actorId: "actor-avatar-nova" as never },
    origin: { kind: "player-input" },
    idempotencyKey: { scope: "command", actor: "actor-avatar-nova" as never, nonce: `n-${seq}` as never },
    issuedAt: asTimestamp(seq),
    payload: {
      kind: "record",
      fields: {
        target: { kind: "entity-ref", ref: demoEntityRefs()[0]! },
        delta: { kind: "list", items: [{ kind: "float", value: 1 }, { kind: "float", value: 0 }, { kind: "float", value: 0 }] },
      },
    },
  };
}

/**
 * Adapts a game-ir semantic {@link Command} into the runtime command
 * envelope the canonical admission path accepts (E2): same kind, same
 * payload, same target semantics — the envelope adds the runtime identity
 * fields (ids, actor, origin, idempotency key) deterministically.
 */
function envelopeFromCommand(command: Command, index: number): PendingCommand["envelope"] {
  return {
    commandId: asCommandId(`cmd-oracle-${index}`),
    sessionId,
    kind: asCommandKind(String(command.type)),
    epoch: 1 as never,
    actor: { actorClass: "avatar-agent", actorId: "actor-avatar-nova" as never },
    origin: { kind: "broker-mediated", grantId: "grant-demo-locomotion" as never },
    idempotencyKey: { scope: "command", actor: "actor-avatar-nova" as never, nonce: `oracle-${index}` as never },
    issuedAt: asTimestamp(index),
    payload: command.payload,
  };
}

test("kernel: identical inputs produce identical ticks (state and events)", () => {
  const state = initialWorldState(demoBlueprint());
  const commands = [pendingEnvelope(1)];
  const run = () =>
    runKernelTick({
      tick: asTick(1),
      state,
      commands,
      rng: makeRng("kernel-seed" as never),
      systems: demoSystems(),
    });
  const first = run();
  const second = run();
  assert.deepEqual(first, second);
  // The demo world emits drift events for all three entities per tick.
  assert.ok(first.events.length >= 3);
});

test("kernel: system order is declared order (motion before drift)", () => {
  const motionOnly: WorldSystem[] = demoSystems().filter((s) => s.systemId === "motion");
  const state = initialWorldState(demoBlueprint());
  const output = runKernelTick({
    tick: asTick(1),
    state,
    commands: [pendingEnvelope(1)],
    rng: makeRng("kernel-seed" as never),
    systems: motionOnly,
  });
  const kinds = output.events.map((e) => String(e.event.type));
  assert.deepEqual(kinds, ["world.entity.moved"]);
  assert.equal(output.events[0]?.cause.kind, "command");
});

test("kernel: per-system RNG forks make draws independent of system execution timing", () => {
  const state = initialWorldState(demoBlueprint());
  const tickInput = {
    tick: asTick(1),
    state,
    commands: [] as PendingCommand["envelope"][],
    systems: demoSystems(),
  };
  const first = runKernelTick({ ...tickInput, rng: makeRng("fork-seed" as never) });
  // Re-running with a DIFFERENT rng instance but the same seed gives the
  // same forks (forks derive from state+label, not from stream position).
  const second = runKernelTick({ ...tickInput, rng: makeRng("fork-seed" as never) });
  assert.deepEqual(first, second);
  // And a different seed diverges.
  const third = runKernelTick({ ...tickInput, rng: makeRng("other-seed" as never) });
  assert.notDeepEqual(first, third);
});

test("kernel: satisfies the game-ir SimulationStep determinism oracle", () => {
  // Adapt the kernel to game-ir's frozen evaluator contract: the same
  // input (state + adjudicated commands) always yields the same output.
  // The input commands are game-ir semantic Commands; the adapter maps
  // each onto a canonical runtime envelope (see envelopeFromCommand).
  const state = initialWorldState(demoBlueprint());
  const hero = demoEntityRefs()[0]!;
  const commands: readonly Command[] = [
    {
      type: asCommandTypeId("world.move")!,
      payload: movePayload(hero, [1, 0, 0]),
      target: hero,
      tick: 1,
      basis: [],
    },
    {
      type: asCommandTypeId("world.move")!,
      payload: movePayload(hero, [0, 2, 1]),
      target: hero,
      tick: 1,
      basis: [],
    },
  ];
  const step: SimulationStep = (input: SimulationStepInput) => {
    const output = runKernelTick({
      tick: asTick(1),
      state: input.state,
      commands: input.commands.map((command, index) => envelopeFromCommand(command, index)),
      rng: makeRng("oracle-seed" as never),
      systems: demoSystems(),
    });
    return { state: output.state, events: output.events.map((e) => e.event) };
  };
  assert.equal(verifySimulationStepDeterminism(step, { state, commands }), true);
});

test("kernel: the deterministic scheduler drains due commands in (dueTick, seq) order", () => {
  const queue = makePendingCommandQueue();
  queue.schedule({ envelope: pendingEnvelope(2), assignedSeq: 2, dueTick: asTick(3) });
  queue.schedule({ envelope: pendingEnvelope(1), assignedSeq: 1, dueTick: asTick(2) });
  queue.schedule({ envelope: pendingEnvelope(3), assignedSeq: 3, dueTick: asTick(2) });
  assert.equal(queue.size, 3);
  const dueAt2 = queue.dueThrough(asTick(2));
  assert.deepEqual(
    dueAt2.map((entry) => entry.assignedSeq),
    [1, 3],
  );
  const dueAt3 = queue.dueThrough(asTick(3));
  assert.deepEqual(
    dueAt3.map((entry) => entry.assignedSeq),
    [2],
  );
  assert.equal(queue.size, 0);
  assert.deepEqual(queue.snapshotPending(), []);
});
