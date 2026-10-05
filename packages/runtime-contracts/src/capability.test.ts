/**
 * Capability Broker boundary tests (lock rules 4, 13, 14): every path from
 * intent to canonical command passes the boundary; grants carry the
 * authority; budgets are pure data.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeBudget,
  EMPTY_BUDGET_LEDGER,
  resolveActionRequest,
  type ActionRequest,
  type BrokerContext,
  type BudgetLedger,
  type CapabilityGrant,
} from "./capability.ts";
import { admitCommand, type CommandAdmissionPolicy } from "./commands.ts";
import {
  asActionRequestId,
  asActorId,
  asCapabilityGrantId,
  asCapabilityId,
  asCommandId,
  asCommandKind,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
  asSessionId,
  asTick,
  asTimestamp,
  type ActorRef,
} from "./primitives.ts";
import type { IdempotencyKey } from "./idempotency.ts";
import type { TypedIntent } from "./experience.ts";

const sessionId = asSessionId("s-cap");
const avatar: ActorRef = { actorClass: "avatar-agent", actorId: asActorId("avatar-1") };
const capability = asCapabilityId("world.movement");

const grant = (over: Partial<CapabilityGrant> = {}): CapabilityGrant => ({
  grantId: asCapabilityGrantId("grant-1"),
  holder: avatar,
  capability,
  scope: { sessionId },
  constraints: [],
  issuedBy: "host-game-policy",
  epoch: asSessionEpoch(1),
  ...over,
});

const intent = (kind: string): TypedIntent<{ to: number[] }> => ({
  intentId: asIntentId("i-1"),
  kind: asIntentKind(kind),
  actor: avatar,
  payload: { to: [2, 2] },
  issuedAt: asTimestamp(10),
});

const request = (over: Partial<ActionRequest<{ to: number[] }>> = {}): ActionRequest<{ to: number[] }> => ({
  requestId: asActionRequestId("req-1"),
  sessionId,
  actor: avatar,
  intent: intent("move.to"),
  grantId: asCapabilityGrantId("grant-1"),
  idempotencyKey: {
    scope: "action",
    actor: asActorId("avatar-1"),
    nonce: asIdempotencyNonce("n-1"),
  } satisfies IdempotencyKey,
  ...over,
});

const context = (over: Partial<BrokerContext> = {}): BrokerContext => ({
  grants: [grant()],
  epoch: asSessionEpoch(1),
  tick: asTick(3),
  capabilityIntentKinds: { [capability]: [asIntentKind("move.to")] },
  ledger: EMPTY_BUDGET_LEDGER,
  ...over,
});

test("lock 4: a valid request is resolved to a broker-mediated command", () => {
  const { resolution, ledger } = resolveActionRequest(
    request(),
    context(),
    asCommandId("cmd-9"),
    asCommandKind("world.move"),
    asTimestamp(11),
  );
  assert.equal(resolution.status, "granted");
  if (resolution.status === "granted") {
    assert.equal(resolution.command.origin.kind, "broker-mediated");
    assert.equal(String(resolution.command.commandId), "cmd-9");
    assert.deepEqual(resolution.command.payload, { to: [2, 2] });
  }
  assert.deepEqual(ledger, EMPTY_BUDGET_LEDGER, "no constraints -> ledger unchanged");
});

test("lock 4 + 14: granted commands still pass the canonical admission gate", () => {
  const { resolution } = resolveActionRequest(
    request(),
    context(),
    asCommandId("cmd-9"),
    asCommandKind("world.move"),
    asTimestamp(11),
  );
  assert.equal(resolution.status, "granted");
  if (resolution.status !== "granted") {
    return;
  }
  const policy: CommandAdmissionPolicy = { "world.move": ["running"] };
  const admitted = admitCommand(
    {
      sessionId,
      role: "simulation",
      phase: "running",
      epoch: asSessionEpoch(1),
      tick: asTick(3),
      committedEventSeq: 0,
      admittedCommandSeq: 0,
    },
    policy,
    resolution.command,
  );
  assert.equal(admitted.status, "admitted", "broker output is gate-compatible");
});

test("boundary denials: each rule fires with its typed reason", () => {
  const cases: readonly { name: string; ctx: Partial<BrokerContext>; req?: Partial<ActionRequest<{ to: number[] }>>; reason: string }[] = [
    { name: "unknown grant", ctx: { grants: [] }, reason: "grant-not-found" },
    {
      name: "holder mismatch",
      req: { actor: { actorClass: "avatar-agent", actorId: asActorId("avatar-2") } },
      ctx: {},
      reason: "grant-holder-mismatch",
    },
    {
      name: "wrong session scope",
      req: { sessionId: asSessionId("s-other") },
      ctx: {},
      reason: "grant-wrong-session",
    },
    {
      name: "expired tick",
      ctx: { tick: asTick(11), grants: [grant({ expiresAfterTick: asTick(10) })] },
      reason: "grant-expired-tick",
    },
    { name: "stale epoch", ctx: { epoch: asSessionEpoch(2) }, reason: "grant-epoch-stale" },
    {
      name: "intent kind outside grant",
      req: { intent: intent("speak.say") },
      ctx: {},
      reason: "intent-kind-outside-grant",
    },
  ];
  for (const testCase of cases) {
    const { resolution } = resolveActionRequest(
      request(testCase.req),
      context(testCase.ctx),
      asCommandId("cmd-x"),
      asCommandKind("world.move"),
      asTimestamp(11),
    );
    assert.equal(resolution.status, "denied", testCase.name);
    if (resolution.status === "denied") {
      assert.equal(resolution.reason, testCase.reason, testCase.name);
    }
  }
});

test("budgets: per-tick-count limits consumption within one tick", () => {
  const g = grant({ constraints: [{ kind: "per-tick-count", max: 2 }] });
  const t = asTick(5);
  const first = consumeBudget(g, 0, EMPTY_BUDGET_LEDGER, t);
  assert.equal(first.ok, true);
  let ledger: BudgetLedger = first.ok ? first.ledger : EMPTY_BUDGET_LEDGER;
  const second = consumeBudget(g, 0, ledger, t);
  assert.equal(second.ok, true);
  ledger = second.ok ? second.ledger : ledger;
  const third = consumeBudget(g, 0, ledger, t);
  assert.equal(third.ok, false);
  if (!third.ok) {
    assert.equal(third.reason, "budget-exhausted");
  }
  const nextTick = consumeBudget(g, 0, ledger, asTick(6));
  assert.equal(nextTick.ok, true, "counter resets on tick advance");
});

test("budgets: total-count never resets; rate windows roll over lazily", () => {
  const total = grant({ constraints: [{ kind: "total-count", max: 2 }] });
  const a = consumeBudget(total, 0, EMPTY_BUDGET_LEDGER, asTick(1));
  const b = consumeBudget(total, 0, a.ok ? a.ledger : EMPTY_BUDGET_LEDGER, asTick(50));
  assert.equal(b.ok, true);
  const c = consumeBudget(total, 0, b.ok ? b.ledger : EMPTY_BUDGET_LEDGER, asTick(99));
  assert.equal(c.ok, false, "total budget ignores tick distance");

  const rate = grant({ constraints: [{ kind: "rate-per-ticks", max: 1, windowTicks: 10 }] });
  const r1 = consumeBudget(rate, 0, EMPTY_BUDGET_LEDGER, asTick(5));
  assert.equal(r1.ok, true);
  const r2 = consumeBudget(rate, 0, r1.ok ? r1.ledger : EMPTY_BUDGET_LEDGER, asTick(7));
  assert.equal(r2.ok, false, "same window is capped");
  const r3 = consumeBudget(rate, 0, r1.ok ? r1.ledger : EMPTY_BUDGET_LEDGER, asTick(15));
  assert.equal(r3.ok, true, "window rolled over at 5+10");
});

test("budgets: time regression into a counter is refused", () => {
  const g = grant({ constraints: [{ kind: "per-tick-count", max: 5 }] });
  const first = consumeBudget(g, 0, EMPTY_BUDGET_LEDGER, asTick(10));
  const regressed = consumeBudget(g, 0, first.ok ? first.ledger : EMPTY_BUDGET_LEDGER, asTick(9));
  assert.equal(regressed.ok, false);
  if (!regressed.ok) {
    assert.equal(regressed.reason, "tick-regression");
  }
});

test("budgets: unknown constraint index is refused", () => {
  const g = grant();
  const result = consumeBudget(g, 3, EMPTY_BUDGET_LEDGER, asTick(1));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unknown-constraint");
  }
});

test("boundary enforces budgets during resolution", () => {
  const g = grant({ constraints: [{ kind: "total-count", max: 1 }] });
  const ctx = context({ grants: [g] });
  const first = resolveActionRequest(request(), ctx, asCommandId("c1"), asCommandKind("world.move"), asTimestamp(1));
  assert.equal(first.resolution.status, "granted");
  const second = resolveActionRequest(
    request({ requestId: asActionRequestId("req-2"), idempotencyKey: { scope: "action", actor: asActorId("avatar-1"), nonce: asIdempotencyNonce("n-2") } satisfies IdempotencyKey }),
    context({ grants: [g], ledger: first.ledger }),
    asCommandId("c2"),
    asCommandKind("world.move"),
    asTimestamp(2),
  );
  assert.equal(second.resolution.status, "denied");
  if (second.resolution.status === "denied") {
    assert.equal(second.resolution.reason, "budget-exhausted");
  }
});

test("type-level: an ActionRequest is a proposal, not a command (lock 14)", () => {
  const req = request();
  // @ts-expect-error TS2322: ActionRequest cannot masquerade as a command envelope
  const command: Parameters<typeof admitCommand>[2] = req;
  void command;
  assert.ok(true, "compiler rejected the coercion");
});
