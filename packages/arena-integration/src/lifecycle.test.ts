import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_LIFECYCLE_STATES,
  ARENA_LIFECYCLE_TRANSITIONS,
  advanceArenaLifecycle,
  canTransitionArenaLifecycle,
  expireArenaEscalation,
  initialArenaLifecycle,
  isArenaLifecycleState,
  settleArenaSend,
} from "./lifecycle.ts";
import type { ArenaLifecycleRecord } from "./lifecycle.ts";
import { arenaAuthorizationScope } from "./authorization.ts";
import type { ArenaContentDigest, ArenaEndpointRef, ArenaTimestampMs } from "./primitives.ts";

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

function fixtureEndpoint(seed: string): ArenaEndpointRef {
  return { refKind: "arena-endpoint", endpointDigest: fixtureDigest(seed) };
}

function fixtureEnvelope(overrides: { requestKind?: "result" | "evidence" | "artifact.skill"; payloadSeed?: string; gapSeed?: string } = {}) {
  return {
    envelopeKind: "arena-request",
    requestKind: overrides.requestKind ?? "result",
    cycle: {
      requestPayload: fixtureDigest(overrides.payloadSeed ?? "a1"),
      gapSummary: fixtureDigest(overrides.gapSeed ?? "b1"),
      authorization: arenaAuthorizationScope(overrides.requestKind === "artifact.skill" ? ["skill"] : []),
    },
    endpoint: fixtureEndpoint("e1"),
  };
}

test("lifecycle: state vocabulary and transition table are frozen", () => {
  assert.deepEqual([...ARENA_LIFECYCLE_STATES.values], [
    "draft",
    "authorized",
    "sent",
    "responded",
    "ingested",
    "rejected",
    "expired",
  ]);
  assert.ok(isArenaLifecycleState("draft"));
  assert.equal(isArenaLifecycleState("live"), false);
  // Terminals have no outgoing transitions (E10: history immutable).
  for (const terminal of ["ingested", "rejected", "expired"] as const) {
    assert.deepEqual([...ARENA_LIFECYCLE_TRANSITIONS[terminal]], []);
  }
  // The spine is legal in order.
  assert.ok(canTransitionArenaLifecycle("draft", "authorized"));
  assert.ok(canTransitionArenaLifecycle("authorized", "sent"));
  assert.ok(canTransitionArenaLifecycle("sent", "responded"));
  assert.ok(canTransitionArenaLifecycle("responded", "ingested"));
});

test("lifecycle: illegal transitions are refused, terminals are absorbing", () => {
  assert.equal(canTransitionArenaLifecycle("draft", "sent"), false);
  assert.equal(canTransitionArenaLifecycle("draft", "ingested"), false);
  assert.equal(canTransitionArenaLifecycle("authorized", "responded"), false);
  assert.equal(canTransitionArenaLifecycle("sent", "ingested"), false);
  assert.equal(canTransitionArenaLifecycle("ingested", "draft"), false);
  assert.equal(canTransitionArenaLifecycle("rejected", "authorized"), false);
  assert.equal(canTransitionArenaLifecycle("expired", "sent"), false);
  assert.equal(canTransitionArenaLifecycle("responded", "responded"), false);
});

test("lifecycle: advance appends history immutably and refuses bad moves", () => {
  const draft = initialArenaLifecycle();
  assert.equal(draft.state, "draft");
  assert.deepEqual([...draft.history], []);

  const authorized = advanceArenaLifecycle(draft, "authorized", 100 as ArenaTimestampMs);
  assert.ok(authorized.ok);
  if (!authorized.ok) return;
  assert.equal(authorized.record.state, "authorized");
  assert.deepEqual([...authorized.record.history], [{ from: "draft", to: "authorized", at: 100 }]);

  // The input record was not mutated.
  assert.equal(draft.state, "draft");
  assert.equal(draft.history.length, 0);

  // Illegal move from authorized.
  const illegal = advanceArenaLifecycle(authorized.record, "responded");
  assert.deepEqual(illegal, { ok: false, reason: "illegal-transition" });

  // Self-transition is illegal.
  assert.deepEqual(advanceArenaLifecycle(authorized.record, "authorized"), { ok: false, reason: "illegal-transition" });

  // Full happy path to a terminal state, then absorbing.
  const sent = advanceArenaLifecycle(authorized.record, "sent");
  const responded = sent.ok ? advanceArenaLifecycle(sent.record, "responded") : undefined;
  const ingested = responded && responded.ok ? advanceArenaLifecycle(responded.record, "ingested") : undefined;
  assert.ok(ingested?.ok);
  if (!ingested || !ingested.ok) return;
  assert.equal(ingested.record.history.length, 4);
  assert.deepEqual(
    ingested.record.history.map((entry) => `${entry.from}->${entry.to}`),
    ["draft->authorized", "authorized->sent", "sent->responded", "responded->ingested"],
  );
  assert.deepEqual(advanceArenaLifecycle(ingested.record, "draft"), { ok: false, reason: "illegal-transition" });
});

test("lifecycle: rejection branches exist from draft and responded only", () => {
  assert.ok(canTransitionArenaLifecycle("draft", "rejected"));
  assert.ok(canTransitionArenaLifecycle("responded", "rejected"));
  assert.equal(canTransitionArenaLifecycle("authorized", "rejected"), false);
  assert.equal(canTransitionArenaLifecycle("sent", "rejected"), false);

  const denied = advanceArenaLifecycle(initialArenaLifecycle(), "rejected");
  assert.ok(denied.ok);
});

test("lifecycle: expiry is a pure deadline fold over caller-supplied time", () => {
  const record: ArenaLifecycleRecord = initialArenaLifecycle(500 as ArenaTimestampMs);
  // Before the deadline: not expired.
  assert.deepEqual(expireArenaEscalation(record, 499 as ArenaTimestampMs), { ok: false, reason: "illegal-transition" });
  // At/after the deadline: expired.
  const expired = expireArenaEscalation(record, 500 as ArenaTimestampMs);
  assert.ok(expired.ok);
  if (!expired.ok) return;
  assert.equal(expired.record.state, "expired");

  // No deadline: never auto-expires.
  const openEnded = initialArenaLifecycle();
  assert.deepEqual(expireArenaEscalation(openEnded, 1_000_000 as ArenaTimestampMs), { ok: false, reason: "illegal-transition" });

  // Expiry works from non-draft states too.
  const authorized = advanceArenaLifecycle(record, "authorized");
  assert.ok(authorized.ok);
  const expiredLater = authorized.ok ? expireArenaEscalation(authorized.record, 900 as ArenaTimestampMs) : undefined;
  assert.ok(expiredLater?.ok);
});

test("lifecycle: send oracle is idempotent — first send stands (E6)", () => {
  const envelope = fixtureEnvelope();
  const first = settleArenaSend(undefined, envelope);
  assert.equal(first.status, "sent");
  if (first.status !== "sent") return;
  assert.equal(first.receipt.requestKind, "result");
  assert.equal(first.receipt.gapSummary, fixtureDigest("b1"));

  // Replay the SAME envelope: duplicate, same receipt object.
  const replay = settleArenaSend(first.receipt, envelope);
  assert.equal(replay.status, "duplicate-send");
  if (replay.status !== "duplicate-send") return;
  assert.equal(replay.receipt, first.receipt);
});

test("lifecycle: same send key with a different envelope is a refused collision (E8)", () => {
  const first = settleArenaSend(undefined, fixtureEnvelope());
  assert.ok(first.status === "sent");
  if (first.status !== "sent") return;

  // Same endpoint + payload (same key) but a different KIND: collision.
  const differentKind = settleArenaSend(first.receipt, fixtureEnvelope({ requestKind: "evidence" }));
  assert.equal(differentKind.status, "send-collision");

  // Same key but a different gap summary: collision.
  const differentGap = settleArenaSend(first.receipt, fixtureEnvelope({ gapSeed: "b2" }));
  assert.equal(differentGap.status, "send-collision");
});

test("lifecycle: different key (payload or endpoint) is a fresh send; garbage is not sendable", () => {
  const first = settleArenaSend(undefined, fixtureEnvelope());
  assert.ok(first.status === "sent");
  if (first.status !== "sent") return;

  const otherPayload = settleArenaSend(first.receipt, fixtureEnvelope({ payloadSeed: "a2" }));
  assert.equal(otherPayload.status, "sent");

  assert.deepEqual(settleArenaSend(undefined, { nope: true }), { status: "not-sendable" });
  assert.deepEqual(settleArenaSend(undefined, null), { status: "not-sendable" });
});
