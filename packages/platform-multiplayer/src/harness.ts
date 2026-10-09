/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full authoritative multiplayer session over the in-memory
 * fakes: open -> admit two participants -> intents through the canonical
 * command path -> fixed ticks with committed events -> byte-stable
 * snapshot -> hostile client claim (refused) -> platform-authority outcome
 * decision -> termination. Prints deterministic machine-readable JSON and
 * exits non-zero on any unexpected outcome. No IO beyond stdout; no
 * clock, no randomness, no network.
 */

import { AuthoritySessionKernel } from "./kernel.ts";
import {
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
import { validateEventStream } from "@playliquid/runtime-contracts";
import {
  asActorId,
  asClaimId,
  asDeterminismSeed,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
  asSessionId,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import { asMatchSessionId, asSubjectId, asTenantId } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-harness")!;
const subjectOne = asSubjectId("player-one")!;
const subjectTwo = asSubjectId("player-two")!;
const sessionId = asSessionId("session-harness-1");

const transport = createRecordingTransport();
const store = createMemorySessionStore();
const clock = createFixedClock();
const scheduler = createRecordingScheduler();

const kernel = new AuthoritySessionKernel<FakeAuthorityState>({
  sessionId,
  tenant,
  gamePolicy: createFakeGamePolicy(),
  servicePolicy: { topology: "authoritative-server", competitiveUse: true, admission: "open" },
  simulator: createFakeSimulator(),
  intentSchemas: createFakeIntentSchemas(),
  intentRules: createFakeIntentRules(),
  transport: transport.transport,
  store: store.store,
  clock: clock.clock,
  scheduler: scheduler.scheduler,
  determinism: asDeterminismSeed("seed-harness"),
  tickIntervalMs: 50,
  protectedGrantKinds: FAKE_PROTECTED_GRANT_KINDS,
});

function expect(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`HARNESS FAILURE: ${label}`);
    process.exitCode = 1;
  }
}

const opened = kernel.open();
expect(opened.ok, "session opens");
expect(kernel.admitParticipant({ tenant, subject: subjectOne }).admitted, "player one admitted");
expect(kernel.admitParticipant({ tenant, subject: subjectTwo }).admitted, "player two admitted");

const move = (actorId: string, nonce: string, dx: number, dy: number) => ({
  intent: {
    intentId: asIntentId(`intent-${nonce}`),
    kind: asIntentKind("match.move"),
    actor: { actorClass: "player" as const, actorId: asActorId(actorId) },
    payload: { dx, dy },
    issuedAt: asTimestamp(0),
  },
  origin: { kind: "player-input" as const },
  observedEpoch: asSessionEpoch(1),
  idempotencyKey: {
    scope: "command" as const,
    actor: asActorId(actorId),
    nonce: asIdempotencyNonce(nonce),
  },
});

const score = (actorId: string, nonce: string, points: number) => ({
  intent: {
    intentId: asIntentId(`intent-${nonce}`),
    kind: asIntentKind("match.score"),
    actor: { actorClass: "player" as const, actorId: asActorId(actorId) },
    payload: { points },
    issuedAt: asTimestamp(0),
  },
  origin: { kind: "player-input" as const },
  observedEpoch: asSessionEpoch(1),
  idempotencyKey: {
    scope: "command" as const,
    actor: asActorId(actorId),
    nonce: asIdempotencyNonce(nonce),
  },
});

expect(kernel.submitIntent(move("player:player-one", "m-1", 1, 2)).status === "admitted", "move intent admitted");
expect(kernel.submitIntent(score("player:player-one", "s-1", 3)).status === "admitted", "score intent admitted");
expect(kernel.submitIntent(score("player:player-two", "s-2", 1)).status === "admitted", "score intent admitted");

const stepped = kernel.advanceTicks(1);
expect(stepped.ok && stepped.eventsEmitted === 3, "one tick commits three gameplay events");

const commandIds = kernel
  .eventLog()
  .flatMap((event) => (event.cause.kind === "command" ? [event.cause.commandId] : []));
const orderCheck = validateEventStream([...kernel.eventLog()], {
  startAtSeq: 1,
  admittedCommandIds: commandIds,
});
expect(orderCheck.ok, "committed log passes the bound order oracle");

const snapshot = kernel.snapshot();
expect(snapshot.ok, "byte-stable snapshot persisted");
expect(store.records().length === 1, "content-addressed save recorded");

const hostileClaim = kernel.submitClientClaim({
  claimId: asClaimId("claim-hostile"),
  sessionId,
  actor: { actorClass: "player", actorId: asActorId("player:player-one") },
  clientAsserted: { clientClaimedScore: 999_999, clientClaimedRewards: ["everything"] },
  payload: { untrusted: "untrusted-client-input" },
});
expect(hostileClaim.refused && hostileClaim.refusal.core.code === "not-authoritative", "hostile client claim refused");
const platformClaim = kernel.submitClientPlayResult({
  session: asMatchSessionId("session-harness-1")!,
  clientClaimedRank: 1,
  clientClaimedRewards: ["trophy"],
  untrusted: "untrusted-client-input",
});
expect(platformClaim.refused && platformClaim.refusal.core.code === "not-authoritative", "platform-shape claim refused");

const decision = kernel.decideOutcome({ actorClass: "platform-system", origin: { kind: "platform-system" } });
expect(decision.ok, "platform authority decides the outcome");
if (decision.ok) {
  expect(decision.outcome.standings[0]?.rank === 1, "dense ranks assigned");
  expect(decision.outcome.evidence.eventIds.length === kernel.eventLog().length - 1, "evidence cites committed events");
}

const terminated = kernel.terminate("harness complete");
expect(terminated.ok, "termination succeeds");
if (terminated.ok) {
  expect(
    terminated.outcome === null,
    "no second decision at termination — the standing outcome is immutable (E10)",
  );
}
expect(kernel.sessionView().phase === "terminated", "session closed");

console.log(
  JSON.stringify(
    {
      harness: "platform-multiplayer",
      sessionId: String(sessionId),
      opened: opened.ok,
      participants: kernel.roster().length,
      eventsCommitted: kernel.eventLog().length,
      orderOracle: orderCheck.ok ? "ok" : "violation",
      snapshotBytes: snapshot.ok ? snapshot.documentBytes : 0,
      refusals: kernel.refusalLog().length,
      claimRefusals: 2,
      outcomeDecided: decision.ok,
      outcomeId: decision.ok ? String(decision.outcome.outcomeId) : null,
      standings:
        decision.ok
          ? decision.outcome.standings.map((standing) => ({
              actor: String(standing.actor.actorId),
              rank: standing.rank,
              score: standing.score,
            }))
          : [],
      transportDeliveries: transport.deliveries().map((delivery) => delivery.kind),
      schedulerDues: scheduler.dues().length,
      phase: kernel.sessionView().phase,
    },
    null,
    2,
  ),
);
