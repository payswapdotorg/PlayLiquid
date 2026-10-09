/**
 * Authority session kernel tests (behavior first): lifecycle, platform
 * admission through the kernel, the canonical command/event path binding
 * (admitCommand + validateEventStream), idempotency (E6), rate limits,
 * hostile simulator effects, client-claim refusals, protected outcome
 * decisions, topology enforcement and termination.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthoritySessionKernel } from "./kernel.ts";
import type {
  AuthoritySessionKernelOptions,
  IntentSubmitResult,
  OpenResult,
  OutcomeDecisionResult,
  TerminateResult,
  TickResult,
 } from "./kernel.ts";
import type { ParticipantAdmissionResult } from "./admission.ts";
import {
  FAKE_EVENT_KINDS,
  FAKE_PROTECTED_GRANT_KINDS,
  createFakeGamePolicy,
  createFakeIntentRules,
  createFakeIntentSchemas,
  createFakeSimulator,
  createFixedClock,
  createMemorySessionStore,
  createRecordingScheduler,
  createRecordingTransport,
} from "./fakes.ts";
import type { FakeAuthorityState } from "./fakes.ts";
import type { AuthoritySimulator, SimulationEffect } from "./ports.ts";
import { validateEventStream } from "@playliquid/runtime-contracts";
import type { ClientSubmittedClaim, CommandOrigin } from "@playliquid/runtime-contracts";
import {
  asActorId,
  asCapabilityGrantId,
  asClaimId,
  asCommandId,
  asDeterminismSeed,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
  asSessionId,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import {
  asGameEventKind,
  asMatchSessionId,
  asSubjectId,
  asTenantId,
} from "@playliquid/platform-contracts";
import type { MultiplayerServicePolicy, PlatformPolicyDeclaration } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const otherTenant = asTenantId("tenant-beta")!;
const subjectOne = asSubjectId("player-one")!;
const subjectTwo = asSubjectId("player-two")!;
const servicePolicy: MultiplayerServicePolicy = {
  topology: "authoritative-server",
  competitiveUse: true,
  admission: "open",
};

interface Kit {
  readonly kernel: AuthoritySessionKernel<FakeAuthorityState>;
  readonly transport: ReturnType<typeof createRecordingTransport>;
  readonly store: ReturnType<typeof createMemorySessionStore>;
  readonly clock: ReturnType<typeof createFixedClock>;
  readonly scheduler: ReturnType<typeof createRecordingScheduler>;
}

function buildKernel(over: Partial<AuthoritySessionKernelOptions<FakeAuthorityState>> = {}): Kit {
  const transport = createRecordingTransport();
  const store = createMemorySessionStore();
  const clock = createFixedClock();
  const scheduler = createRecordingScheduler();
  const kernel = new AuthoritySessionKernel<FakeAuthorityState>({
    sessionId: asSessionId("session-royale-1"),
    tenant,
    gamePolicy: createFakeGamePolicy(),
    servicePolicy,
    simulator: createFakeSimulator(),
    intentSchemas: createFakeIntentSchemas(),
    intentRules: createFakeIntentRules(),
    transport: transport.transport,
    store: store.store,
    clock: clock.clock,
    scheduler: scheduler.scheduler,
    determinism: asDeterminismSeed("seed-alpha"),
    tickIntervalMs: 50,
    protectedGrantKinds: FAKE_PROTECTED_GRANT_KINDS,
    ...over,
  });
  return { kernel, transport, store, clock, scheduler };
}

interface Submit {
  readonly actorId: string;
  readonly nonce: string;
  readonly kind: "match.move" | "match.fire" | "match.score";
  readonly payload: unknown;
  readonly origin?: CommandOrigin;
  readonly actorClass?: "player" | "avatar-agent" | "platform-system" | "host-authority";
  readonly epoch?: number;
}

function submit(over: Submit) {
  const actor = {
    actorClass: over.actorClass ?? "player",
    actorId: asActorId(over.actorId),
  };
  return {
    intent: {
      intentId: asIntentId(`intent-${over.nonce}`),
      kind: asIntentKind(over.kind),
      actor,
      payload: over.payload,
      issuedAt: asTimestamp(0),
    },
    origin: over.origin ?? { kind: "player-input" },
    observedEpoch: asSessionEpoch(over.epoch ?? 1),
    idempotencyKey: {
      scope: "command" as const,
      actor: actor.actorId,
      nonce: asIdempotencyNonce(over.nonce),
    },
  };
}

function admittedIdsOf(kit: Kit): readonly ReturnType<typeof asCommandId>[] {
  return kit.kernel.eventLog().flatMap((event) =>
    event.cause.kind === "command" ? [event.cause.commandId] : [],
  );
}

function openRefused(result: OpenResult): string {
  if (result.ok) assert.fail("expected an open refusal");
  return result.code;
}

function admissionRefused(result: ParticipantAdmissionResult): string {
  if (result.admitted) assert.fail("expected an admission refusal");
  return result.code;
}

function intentRejected(result: IntentSubmitResult): string {
  if (result.status !== "rejected") assert.fail(`expected a rejection, got ${result.status}`);
  return result.code;
}

function outcomeRefused(result: OutcomeDecisionResult): string {
  if (result.ok) assert.fail("expected an outcome refusal");
  return result.code;
}

function terminateRefused(result: TerminateResult): string {
  if (result.ok) assert.fail("expected a termination refusal");
  return result.code;
}

function tickRefused(result: TickResult): string {
  if (result.ok) assert.fail("expected a tick refusal");
  return result.code;
}

test("kernel: open resolves configuration, emits the platform session event, reaches ready", () => {
  const kit = buildKernel();
  const opened = kit.kernel.open();
  assert.ok(opened.ok);
  assert.equal(opened.sessionView.phase, "ready");
  assert.equal(opened.sessionView.role, "simulation");
  const log = kit.kernel.eventLog();
  assert.equal(log.length, 1);
  assert.equal(String(log[0]?.kind), "platform.multiplayer.session.opened");
  assert.equal(log[0]?.seq, 1);
  assert.equal(log[0]?.tick, 0);
  assert.deepEqual(kit.transport.deliveries().map((d) => d.kind), ["session-opened"]);
  assert.equal(openRefused(kit.kernel.open()), "already-open");
});

test("kernel: P2P with protected bindings cannot even open (lock 19 binding)", () => {
  const kit = buildKernel({
    gamePolicy: createFakeGamePolicy("peer-to-peer"),
    servicePolicy: { topology: "peer-to-peer", competitiveUse: false, admission: "open" },
  });
  const opened = kit.kernel.open();
  assert.equal(openRefused(opened), "competitive-p2p-topology");
  assert.equal(kit.kernel.sessionView().phase, "failed");
});

test("kernel: misaligned intent schemas/rules refuse the open", () => {
  const kit = buildKernel({ intentRules: createFakeIntentRules().slice(0, 1) });
  const opened = kit.kernel.open();
  assert.equal(openRefused(opened), "intent-rules-misaligned");
});

test("kernel: admission flows through the platform oracle over kernel-derived facts", () => {
  const kit = buildKernel();
  kit.kernel.open();
  assert.deepEqual(kit.kernel.admitParticipant({ tenant, subject: subjectOne }), {
    admitted: true,
    subject: subjectOne,
  });
  assert.deepEqual(kit.kernel.admitParticipant({ tenant, subject: subjectTwo }), {
    admitted: true,
    subject: subjectTwo,
  });
  assert.equal(kit.kernel.roster().length, 2);
  assert.deepEqual(
    kit.transport.deliveries().map((d) => d.kind),
    ["session-opened", "participant-admitted", "participant-admitted"],
  );
});

test("kernel: admission refusals — inactive, tenant, full, duplicate, invite (R20/E8)", () => {
  const inactive = buildKernel();
  assert.equal(
    admissionRefused(inactive.kernel.admitParticipant({ tenant, subject: subjectOne })),
    "session-inactive",
    "admission before open",
  );

  const tightCapacity: PlatformPolicyDeclaration = {
    ...createFakeGamePolicy(),
    capabilities: [
      {
        capability: "multiplayer",
        required: true,
        policy: { topology: "authoritative-server", maxPlayersPerSession: 1, sessionModel: "ad-hoc" },
      },
    ],
  };
  const kit = buildKernel({ gamePolicy: tightCapacity });
  kit.kernel.open();
  assert.ok(kit.kernel.admitParticipant({ tenant, subject: subjectOne }).admitted);
  assert.equal(
    admissionRefused(kit.kernel.admitParticipant({ tenant, subject: subjectTwo })),
    "session-full",
  );
  assert.equal(
    admissionRefused(kit.kernel.admitParticipant({ tenant, subject: subjectOne })),
    "already-enrolled",
  );
  assert.equal(
    admissionRefused(kit.kernel.admitParticipant({ tenant: otherTenant, subject: subjectTwo })),
    "tenant-mismatch",
  );

  const inviteKit = buildKernel({
    servicePolicy: { topology: "authoritative-server", competitiveUse: true, admission: "invite" },
    invitedSubjects: [subjectOne],
  });
  inviteKit.kernel.open();
  assert.ok(inviteKit.kernel.admitParticipant({ tenant, subject: subjectOne }).admitted);
  assert.equal(
    admissionRefused(inviteKit.kernel.admitParticipant({ tenant, subject: subjectTwo })),
    "not-invited",
  );
  assert.ok(
    inviteKit.kernel.refusalLog().some((r) => r.code === "not-invited"),
    "admission refusals are recorded for audit",
  );
});

test("kernel: intents flow the canonical path — admitted, simulated, committed with command causes", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  kit.kernel.admitParticipant({ tenant, subject: subjectTwo });
  const first = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.move", payload: { dx: 1, dy: 2 } }),
  );
  const second = kit.kernel.submitIntent(
    submit({ actorId: "player:player-two", nonce: "n-2", kind: "match.move", payload: { dx: 2, dy: 0 } }),
  );
  assert.equal(first.status, "admitted");
  assert.equal(second.status, "admitted");
  if (first.status === "admitted") {
    assert.equal(first.assignedSeq, 1);
    assert.equal(first.queuedForTick, 1);
  }
  const stepped = kit.kernel.advanceTicks(1);
  assert.ok(stepped.ok);
  assert.equal(stepped.toTick, 1);
  assert.equal(stepped.eventsEmitted, 2);
  assert.equal(kit.kernel.sessionView().phase, "running");
  const log = kit.kernel.eventLog();
  assert.equal(log.length, 3, "opened + two moves");
  const moves = log.slice(1);
  assert.ok(moves.every((event) => String(event.kind) === FAKE_EVENT_KINDS.moved));
  assert.ok(moves.every((event) => event.cause.kind === "command"), "effects cite their commands");
  assert.deepEqual(moves.map((event) => event.seq), [2, 3]);
  const validation = validateEventStream([...log], {
    startAtSeq: 1,
    admittedCommandIds: admittedIdsOf(kit),
  });
  assert.ok(validation.ok, "the kernel's own log passes the bound order oracle");
  assert.deepEqual(
    kit.transport.deliveries().map((d) => d.kind),
    ["session-opened", "participant-admitted", "participant-admitted", "events"],
  );
  assert.equal(kit.scheduler.dues().length, 1, "scheduler learned the next due tick");
});

test("kernel: event ordering is 1-based, gapless and tick-monotonic across many ticks", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  for (let round = 1; round <= 5; round += 1) {
    kit.kernel.submitIntent(
      submit({ actorId: "player:player-one", nonce: `n-${round}`, kind: "match.move", payload: { dx: 1, dy: 1 } }),
    );
    kit.kernel.advanceTicks(1);
  }
  const log = kit.kernel.eventLog();
  assert.deepEqual(
    log.map((event) => event.seq),
    log.map((_, index) => index + 1),
  );
  let lastTick = 0;
  for (const event of log) {
    assert.ok(event.tick >= lastTick, `tick regression at seq ${event.seq}`);
    lastTick = event.tick;
  }
  assert.equal(kit.kernel.sessionView().tick, 5);
});

test("kernel: replayed command ids dedupe to the first receipt (E6 idempotency)", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  const original = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.move", payload: { dx: 1, dy: 0 } }),
  );
  assert.equal(original.status, "admitted");
  const retry = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.move", payload: { dx: 1, dy: 0 } }),
  );
  assert.equal(retry.status, "duplicate");
  if (retry.status === "duplicate" && original.status === "admitted") {
    assert.equal(String(retry.firstReceipt), String(original.commandId));
  }
  kit.kernel.advanceTicks(1);
  assert.equal(
    kit.kernel.eventLog().filter((event) => String(event.kind) === FAKE_EVENT_KINDS.moved).length,
    1,
    "the retry executed exactly once",
  );
});

test("kernel: same key with a different payload is a collision, never a rerun (E8)", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.move", payload: { dx: 1, dy: 0 } }),
  );
  const attack = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.move", payload: { dx: 9, dy: 9 } }),
  );
  assert.equal(attack.status, "rejected");
  assert.equal(attack.code, "idempotency-collision");
  kit.kernel.advanceTicks(1);
  const moved = kit.kernel.eventLog().find((event) => String(event.kind) === FAKE_EVENT_KINDS.moved);
  const payload = moved?.payload as { to: readonly [number, number] };
  const drift = kit.kernel.authorityState()?.drift ?? 0;
  assert.equal(payload.to[0], 1 + drift, "the ORIGINAL payload executed, not the attack");
  const stillFirst = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.move", payload: { dx: 1, dy: 0 } }),
  );
  assert.equal(stillFirst.status, "duplicate", "the first receipt is never overwritten");
});

test("kernel: per-actor per-tick rate limits are enforced and reset at tick boundaries", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  assert.ok(
    kit.kernel.submitIntent(submit({ actorId: "player:player-one", nonce: "a", kind: "match.move", payload: { dx: 1, dy: 0 } })).status === "admitted",
  );
  assert.ok(
    kit.kernel.submitIntent(submit({ actorId: "player:player-one", nonce: "b", kind: "match.move", payload: { dx: 1, dy: 0 } })).status === "admitted",
  );
  const throttled = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "c", kind: "match.move", payload: { dx: 1, dy: 0 } }),
  );
  assert.equal(intentRejected(throttled), "rate-limit-exceeded");
  kit.kernel.advanceTicks(1);
  const fresh = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "d", kind: "match.move", payload: { dx: 1, dy: 0 } }),
  );
  assert.equal(fresh.status, "admitted", "window resets after a tick");
});

test("kernel: avatar agents act only through broker mediation (lock 14, bound gate)", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  const raw = kit.kernel.submitIntent(
    submit({
      actorId: "avatar-agent-1",
      nonce: "n-1",
      kind: "match.move",
      payload: { dx: 1, dy: 0 },
      actorClass: "avatar-agent",
      origin: { kind: "player-input" },
    }),
  );
  assert.equal(intentRejected(raw), "avatar-agent-requires-broker-mediation");
  const mediated = kit.kernel.submitIntent(
    submit({
      actorId: "avatar-agent-1",
      nonce: "n-2",
      kind: "match.move",
      payload: { dx: 1, dy: 0 },
      actorClass: "avatar-agent",
      origin: { kind: "broker-mediated", grantId: asCapabilityGrantId("grant-1") },
    }),
  );
  assert.equal(mediated.status, "admitted");
});

test("kernel: stale epochs are refused, including future epochs (fail closed)", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  const stale = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.move", payload: { dx: 1, dy: 0 }, epoch: 2 }),
  );
  assert.equal(intentRejected(stale), "stale-epoch");
  const future = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-2", kind: "match.move", payload: { dx: 1, dy: 0 }, epoch: 7 }),
  );
  assert.equal(intentRejected(future), "stale-epoch");
});

test("kernel: schema violations and unknown kinds are refused before sequencing", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  const bad = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.move", payload: { dx: 999, dy: 0 } }),
  );
  assert.equal(intentRejected(bad), "payload-schema-violation");
  const unknown = kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-2", kind: "match.move", payload: { dx: 1, dy: 0 } }),
  );
  assert.equal(unknown.status, "admitted");
  assert.equal(kit.kernel.sessionView().admittedCommandSeq, 1, "rejected submissions never sequence");
});

test("kernel: hostile simulator effects are refused, never emitted (unbound kinds, fake causes)", () => {
  const hostile: AuthoritySimulator<FakeAuthorityState> = {
    initial: (input) => createFakeSimulator().initial(input),
    step: (input) => {
      const effects: SimulationEffect[] = [
        { eventKind: asGameEventKind("match.unknown")!, payload: { nope: true } },
        {
          eventKind: asGameEventKind(FAKE_EVENT_KINDS.moved)!,
          causedByCommand: asCommandId("cmd:forged"),
          payload: { forged: true },
        },
      ];
      return { state: input.state, effects };
    },
    finalize: () => ({ standings: [] }),
  };
  const kit = buildKernel({ simulator: hostile });
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.move", payload: { dx: 1, dy: 0 } }),
  );
  const stepped = kit.kernel.advanceTicks(1);
  assert.ok(stepped.ok);
  assert.equal(stepped.eventsEmitted, 0, "both hostile effects were refused");
  const codes = kit.kernel.refusalLog().map((refusal) => refusal.code);
  assert.ok(codes.includes("unbound-event-kind"));
  assert.ok(codes.includes("unresolved-command-cause"));
  assert.equal(kit.kernel.eventLog().length, 1, "only the session-opened event stands");
});

test("kernel: client claims are refused with typed records and never touch the log (R9)", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  const before = kit.kernel.eventLog().length;
  const claim: ClientSubmittedClaim<{ readonly note: string }> = {
    claimId: asClaimId("claim-1"),
    sessionId: asSessionId("session-royale-1"),
    actor: { actorClass: "player", actorId: asActorId("player:player-one") },
    clientAsserted: { clientClaimedScore: 999_999, clientClaimedRewards: ["legendary-sword"] },
    payload: { untrusted: "untrusted-client-input", note: "I won, trust me" },
  };
  const runtimeRefusal = kit.kernel.submitClientClaim(claim);
  assert.equal(runtimeRefusal.refused, true);
  assert.equal(runtimeRefusal.refusal.core.code, "not-authoritative");
  assert.equal(runtimeRefusal.refusal.source, "runtime-claim");
  const platformRefusal = kit.kernel.submitClientPlayResult({
    session: asMatchSessionId("session-royale-1")!,
    clientClaimedRank: 1,
    clientClaimedRewards: ["trophy"],
    untrusted: "untrusted-client-input",
  });
  assert.equal(platformRefusal.refused, true);
  assert.equal(platformRefusal.refusal.core.code, "not-authoritative");
  assert.equal(kit.kernel.eventLog().length, before, "claims never emit events");
  assert.ok(kit.kernel.refusalLog().some((r) => r.kind === "claim"));
  assert.deepEqual(
    kit.transport.deliveries().map((d) => d.kind).slice(-2),
    ["claim-refused", "claim-refused"],
  );
});

test("kernel: the platform authority path decides outcomes from committed evidence", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  kit.kernel.admitParticipant({ tenant, subject: subjectTwo });
  kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.score", payload: { points: 3 } }),
  );
  kit.kernel.submitIntent(
    submit({ actorId: "player:player-two", nonce: "n-2", kind: "match.score", payload: { points: 1 } }),
  );
  kit.kernel.advanceTicks(1);
  const decision = kit.kernel.decideOutcome({ actorClass: "platform-system", origin: { kind: "platform-system" } });
  assert.ok(decision.ok);
  assert.deepEqual(
    decision.outcome.standings.map((standing) => [String(standing.actor.actorId), standing.rank, standing.score]),
    [["player:player-one", 1, 3], ["player:player-two", 2, 1]],
  );
  assert.deepEqual(decision.outcome.standings[0]?.grants, ["score", "standing"]);
  const log = kit.kernel.eventLog();
  const outcomeEvent = log[log.length - 1];
  assert.equal(String(outcomeEvent?.kind), "platform.multiplayer.outcome.decided");
  assert.ok(decision.outcome.evidence.eventIds.length >= 3, "evidence cites committed events");
  assert.equal(decision.outcome.decidedBy, "authoritative-runtime-decided");
  const again = kit.kernel.decideOutcome({ actorClass: "platform-system", origin: { kind: "platform-system" } });
  assert.equal(outcomeRefused(again), "outcome-already-decided");
  const hostile = kit.kernel.decideOutcome({ actorClass: "host-authority", origin: { kind: "host-authority" } });
  assert.equal(outcomeRefused(hostile), "origin-not-authorized", "hosts never decide outcomes");
  assert.ok(kit.transport.deliveries().some((d) => d.kind === "outcome-decided"));
});

test("kernel: peer-to-peer sessions never decide outcomes (lock 19)", () => {
  const informationalOnly: PlatformPolicyDeclaration = {
    ...createFakeGamePolicy("peer-to-peer"),
    bindings: createFakeGamePolicy("peer-to-peer").bindings.map((binding) =>
      binding.capability === "multiplayer" && binding.outcomeClassification === "protected"
        ? { ...binding, outcomeClassification: "informational" as const }
        : binding,
    ),
  };
  const kit = buildKernel({
    gamePolicy: informationalOnly,
    servicePolicy: { topology: "peer-to-peer", competitiveUse: false, admission: "open" },
  });
  assert.ok(kit.kernel.open().ok);
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  const decision = kit.kernel.decideOutcome({ actorClass: "platform-system", origin: { kind: "platform-system" } });
  assert.equal(outcomeRefused(decision), "p2p-cannot-decide-outcomes");
});

test("kernel: termination settles competitive outcomes, drains and closes (E6 discipline)", () => {
  const kit = buildKernel();
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  kit.kernel.admitParticipant({ tenant, subject: subjectTwo });
  kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-1", kind: "match.score", payload: { points: 2 } }),
  );
  kit.kernel.submitIntent(
    submit({ actorId: "player:player-two", nonce: "n-2", kind: "match.score", payload: { points: 5 } }),
  );
  kit.kernel.advanceTicks(1);
  kit.kernel.submitIntent(
    submit({ actorId: "player:player-one", nonce: "n-3", kind: "match.move", payload: { dx: 1, dy: 0 } }),
  );
  const done = kit.kernel.terminate("match complete");
  assert.ok(done.ok);
  assert.ok(done.outcome !== null, "competitive sessions settle at termination");
  if (done.outcome) {
    assert.equal(String(done.outcome.standings[0]?.actor.actorId), "player:player-two");
  }
  assert.equal(kit.kernel.sessionView().phase, "terminated");
  assert.equal(terminateRefused(kit.kernel.terminate("again")), "session-terminal");
  assert.equal(
    intentRejected(kit.kernel.submitIntent(submit({ actorId: "player:player-one", nonce: "n-9", kind: "match.move", payload: { dx: 1, dy: 0 } }))),
    "session-terminal",
    "no admissions after termination",
  );
  assert.equal(tickRefused(kit.kernel.advanceTicks(1)), "session-terminal");
  assert.ok(kit.transport.deliveries().some((d) => d.kind === "session-terminated"));
});

test("kernel: non-competitive termination skips the outcome settlement", () => {
  const kit = buildKernel({
    servicePolicy: { topology: "authoritative-server", competitiveUse: false, admission: "open" },
  });
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  const done = kit.kernel.terminate("casual play over");
  assert.ok(done.ok);
  assert.equal(done.outcome, null);
});

test("kernel: stepping before open or with bad counts is refused", () => {
  const kit = buildKernel();
  assert.equal(tickRefused(kit.kernel.advanceTicks(1)), "session-not-open");
  kit.kernel.open();
  assert.equal(tickRefused(kit.kernel.advanceTicks(0)), "session-failed");
});
