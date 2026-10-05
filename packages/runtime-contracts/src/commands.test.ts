/**
 * Canonical command path admission tests (E2): the admission gate is the
 * ONLY door onto the command path. Includes the lock rule 14 negative:
 * an avatar-agent command without broker mediation is rejected.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  admitCommand,
  type CommandAdmissionPolicy,
  type CommandOrigin,
  type RuntimeCommandEnvelope,
} from "./commands.ts";
import {
  asActorId,
  asCapabilityGrantId,
  asCommandId,
  asCommandKind,
  asIdempotencyNonce,
  asSessionEpoch,
  asSessionId,
  asTick,
  asTimestamp,
  type ActorRef,
} from "./primitives.ts";
import type { RuntimeSessionSnapshotView } from "./session.ts";
import type { IdempotencyKey } from "./idempotency.ts";

const sessionId = asSessionId("s-cmd");
const player: ActorRef = { actorClass: "player", actorId: asActorId("player-1") };
const avatar: ActorRef = { actorClass: "avatar-agent", actorId: asActorId("avatar-1") };

const key = (nonce: string): IdempotencyKey => ({
  scope: "command",
  actor: asActorId("player-1"),
  nonce: asIdempotencyNonce(nonce),
});

const session = (
  over: Partial<RuntimeSessionSnapshotView> = {},
): RuntimeSessionSnapshotView => ({
  sessionId,
  role: "interactive",
  phase: "running",
  epoch: asSessionEpoch(1),
  tick: asTick(5),
  committedEventSeq: 4,
  admittedCommandSeq: 2,
  ...over,
});

const policy: CommandAdmissionPolicy = {
  "world.act": ["ready", "running"],
  "world.step": ["running"],
};

const envelope = (
  over: Partial<RuntimeCommandEnvelope<{ v: number }>> &
    Pick<RuntimeCommandEnvelope<{ v: number }>, "actor" | "origin">,
): RuntimeCommandEnvelope<{ v: number }> => ({
  commandId: asCommandId("cmd-x"),
  sessionId,
  kind: asCommandKind("world.act"),
  epoch: asSessionEpoch(1),
  idempotencyKey: key("n1"),
  issuedAt: asTimestamp(1000),
  payload: { v: 1 },
  ...over,
});

test("E2: admitted command receives the next sequence number", () => {
  const result = admitCommand(session(), policy, envelope({ actor: player, origin: { kind: "player-input" } }));
  assert.equal(result.status, "admitted");
  if (result.status === "admitted") {
    assert.equal(result.assignedSeq, 3, "sequencer is monotonic from the read model");
    assert.equal(String(result.commandId), "cmd-x");
  }
});

test("admission rejects commands aimed at a different session", () => {
  const result = admitCommand(session(), policy, envelope({
    actor: player,
    origin: { kind: "player-input" },
    sessionId: asSessionId("s-other"),
  }));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "session-mismatch");
  }
});

test("admission rejects commands once the session is terminal", () => {
  const result = admitCommand(session({ phase: "terminated" }), policy, envelope({ actor: player, origin: { kind: "player-input" } }));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "session-terminal");
  }
});

test("admission rejects command kinds unknown to the game policy", () => {
  const result = admitCommand(session(), policy, envelope({
    actor: player,
    origin: { kind: "player-input" },
    kind: asCommandKind("world.unknown"),
  }));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "unknown-command-kind");
  }
});

test("admission enforces per-kind phase policy", () => {
  const result = admitCommand(
    session({ phase: "ready" }),
    policy,
    envelope({ actor: player, origin: { kind: "player-input" }, kind: asCommandKind("world.step") }),
  );
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "phase-not-allowed");
  }
});

test("lock 14: avatar-agent commands REQUIRE broker-mediated origin", () => {
  const result = admitCommand(session(), policy, envelope({ actor: avatar, origin: { kind: "player-input" } }));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "avatar-agent-requires-broker-mediation");
  }
});

test("lock 14: broker-mediated avatar commands pass the origin check", () => {
  const origin: CommandOrigin = {
    kind: "broker-mediated",
    grantId: asCapabilityGrantId("grant-1"),
  };
  const result = admitCommand(session(), policy, envelope({ actor: avatar, origin }));
  assert.equal(result.status, "admitted");
});

test("admission rejects commands issued under a stale epoch", () => {
  const result = admitCommand(session({ epoch: asSessionEpoch(2) }), policy, envelope({
    actor: player,
    origin: { kind: "player-input" },
    epoch: asSessionEpoch(1),
  }));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "stale-epoch");
  }
});

test("admission rejects player commands arriving on non-player origins", () => {
  const result = admitCommand(session(), policy, envelope({
    actor: player,
    origin: { kind: "platform-system" },
  }));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "origin-actor-mismatch");
  }
});

test("type-level: an intent is not a command (lock 13)", () => {
  const proposal = {
    intentId: asCommandId("i-1"),
    kind: asCommandKind("move"),
    actor: player,
    payload: { to: 1 },
    issuedAt: asTimestamp(1),
  };
  // @ts-expect-error TS2741: TypedIntent shape cannot fill a RuntimeCommandEnvelope
  const command: RuntimeCommandEnvelope = proposal;
  void command;
  assert.ok(true, "compiler rejected the coercion");
});
