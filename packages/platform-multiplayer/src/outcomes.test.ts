/**
 * Protected-outcome enforcement tests (R9 / lock 19 / lock 41):
 * - client claims (both contract shapes) NEVER become outcomes — the
 *   bound validators refuse the strongest type-honest forgeries;
 * - the authority path builds BOTH outcome artifacts from committed
 *   evidence with dense ranks and deterministic tie-breaks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthoritativeOutcome,
  refusePlatformClaim,
  refuseRuntimeClaim,
} from "./outcomes.ts";
import type { OutcomeBuildInput } from "./outcomes.ts";
import { validateProtectedOutcome } from "@playliquid/runtime-contracts";
import type { RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import { validatePlatformOutcome } from "@playliquid/platform-contracts";
import type { ClientPlayResultClaim } from "@playliquid/platform-contracts";
import { asMatchSessionId, asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import {
  asActorId,
  asClaimId,
  asCommandId,
  asEventId,
  asEventKind,
  asEventSequence,
  asSessionEpoch,
  asSessionId,
  asTick,
} from "@playliquid/runtime-contracts";

const session = asSessionId("session-royale-1");
const epoch = asSessionEpoch(1);
const tenant = asTenantId("tenant-alpha")!;
const player = { actorClass: "player" as const, actorId: asActorId("player:player-one") };
const rival = { actorClass: "player" as const, actorId: asActorId("player:player-two") };

function events(count: number): readonly RuntimeEventEnvelope[] {
  const log: RuntimeEventEnvelope[] = [];
  for (let i = 1; i <= count; i += 1) {
    log.push({
      eventId: asEventId(`evt:session-royale-1:${i}`),
      sessionId: session,
      kind: asEventKind(i % 2 === 0 ? "match.scored" : "match.moved"),
      seq: asEventSequence(i),
      tick: asTick(Math.floor(i / 2)),
      cause: { kind: "system" },
      payload: { i },
    });
  }
  return log;
}

test("refusal: runtime client claims are refused with the bound validator's code", () => {
  const claim = {
    claimId: asClaimId("claim-1"),
    sessionId: session,
    actor: player,
    clientAsserted: { clientClaimedScore: 999_999, clientClaimedRewards: ["legendary-sword"] },
    payload: { untrusted: "untrusted-client-input" as const, note: "I definitely won" },
  };
  const refusal = refuseRuntimeClaim(claim, epoch);
  assert.equal(refusal.source, "runtime-claim");
  assert.equal(refusal.core.code, "not-authoritative");
  assert.equal(refusal.advisory.trust, "untrusted-advisory");
  assert.deepEqual(refusal.advisory.advisory.clientClaimedRewards, ["legendary-sword"]);
  // The advisory record is lossy: it carries hints, never authority.
  assert.equal(
    ("decidedBy" in refusal.advisory) as boolean,
    false,
    "advisory records carry no authority slot",
  );
});

test("refusal: platform play-result claims are refused with the bound validator's code", () => {
  const claim: ClientPlayResultClaim = {
    session: asMatchSessionId("session-royale-1")!,
    clientClaimedRank: 1,
    clientClaimedRewards: ["trophy"],
    untrusted: "untrusted-client-input",
  };
  const refusal = refusePlatformClaim(claim, session, epoch);
  assert.equal(refusal.source, "platform-claim");
  assert.equal(refusal.core.code, "not-authoritative");
  assert.equal(refusal.advisory, claim, "claim kept as advisory data only");
});

test("refusal: a laundered platform record with client-asserted rank fails platform validation", () => {
  const laundered = {
    session: asMatchSessionId("session-royale-1")!,
    decidedBy: "untrusted-client-input",
    evidence: [],
    standings: [{ subject: asSubjectId("player-one")!, rank: 1, score: 0, grants: [] }],
  };
  assert.deepEqual(validatePlatformOutcome(laundered), { ok: false, code: "not-authoritative" });
});

test("authority: builds both artifacts from committed evidence with dense ranks", () => {
  const input: OutcomeBuildInput = {
    sessionId: session,
    tenant,
    epoch,
    decidedAtTick: asTick(3),
    evidenceEvents: events(4),
    standings: [
      { actor: rival, score: 5 },
      { actor: player, score: 9 },
    ],
    protectedGrants: { "player:player-one": ["score"], "player:player-two": ["damage"] },
    subjectOfActor: {
      "player:player-one": asSubjectId("player-one")!,
      "player:player-two": asSubjectId("player-two")!,
    },
  };
  const built = buildAuthoritativeOutcome(input);
  assert.ok(built.ok);
  assert.equal(validateProtectedOutcome(built.outcome).ok, true);
  assert.equal(validatePlatformOutcome(built.record).ok, true);
  assert.deepEqual(
    built.outcome.standings.map((standing) => [String(standing.actor.actorId), standing.rank]),
    [["player:player-one", 1], ["player:player-two", 2]],
    "higher score ranks first",
  );
  assert.deepEqual(built.outcome.standings[0]?.grants, ["score"]);
  assert.deepEqual(built.record.standings[0]?.grants, ["score"]);
  assert.equal(built.record.standings[0]?.subject, "player-one");
  assert.ok(built.outcome.evidence.eventIds.length === 4);
  assert.ok(built.record.evidence.length === 4, "one content digest per committed event");
  assert.equal(String(built.outcome.outcomeId), "outcome:session-royale-1:1");
});

test("authority: ties break deterministically by actor id", () => {
  const built = buildAuthoritativeOutcome({
    sessionId: session,
    tenant,
    epoch,
    decidedAtTick: asTick(1),
    evidenceEvents: events(2),
    standings: [
      { actor: rival, score: 5 },
      { actor: player, score: 5 },
    ],
    protectedGrants: {},
    subjectOfActor: {
      "player:player-one": asSubjectId("player-one")!,
      "player:player-two": asSubjectId("player-two")!,
    },
  });
  assert.ok(built.ok);
  assert.deepEqual(
    built.outcome.standings.map((standing) => [String(standing.actor.actorId), standing.rank]),
    [["player:player-one", 1], ["player:player-two", 2]],
    "actor id ascending breaks the tie",
  );
  const rerun = buildAuthoritativeOutcome({
    sessionId: session,
    tenant,
    epoch,
    decidedAtTick: asTick(1),
    evidenceEvents: events(2),
    standings: [
      { actor: player, score: 5 },
      { actor: rival, score: 5 },
    ],
    protectedGrants: {},
    subjectOfActor: {
      "player:player-one": asSubjectId("player-one")!,
      "player:player-two": asSubjectId("player-two")!,
    },
  });
  assert.ok(rerun.ok);
  assert.equal(String(rerun.outcome.outcomeId), String(built.outcome.outcomeId), "input order does not matter");
});

test("authority: empty evidence refuses (an outcome with no proof never stands)", () => {
  const built = buildAuthoritativeOutcome({
    sessionId: session,
    tenant,
    epoch,
    decidedAtTick: asTick(0),
    evidenceEvents: [],
    standings: [{ actor: player, score: 1 }],
    protectedGrants: {},
    subjectOfActor: {},
  });
  assert.ok(!built.ok);
  assert.equal(built.code, "empty-evidence-chain");
});

test("authority: no standings refuses", () => {
  const built = buildAuthoritativeOutcome({
    sessionId: session,
    tenant,
    epoch,
    decidedAtTick: asTick(0),
    evidenceEvents: events(1),
    standings: [],
    protectedGrants: {},
    subjectOfActor: {},
  });
  assert.ok(!built.ok);
  assert.equal(built.code, "no-standings");
});

test("authority: unknown participants drop out before ranking (dense ranks survive)", () => {
  const stranger = { actorClass: "player" as const, actorId: asActorId("player:stranger") };
  const built = buildAuthoritativeOutcome({
    sessionId: session,
    tenant,
    epoch,
    decidedAtTick: asTick(0),
    evidenceEvents: events(2),
    standings: [
      { actor: player, score: 1 },
      { actor: stranger, score: 100 },
    ],
    protectedGrants: {},
    subjectOfActor: { "player:player-one": asSubjectId("player-one")! },
  });
  assert.ok(built.ok);
  assert.equal(built.record.standings.length, 1);
  assert.equal(built.record.standings[0]?.subject, "player-one");
  assert.equal(built.record.standings[0]?.rank, 1, "ranks are dense over the mapped standings");
  assert.equal(built.outcome.standings.length, 1);
});

test("authority: unbridgeable session ids fail closed", () => {
  const built = buildAuthoritativeOutcome({
    sessionId: asSessionId("session royale"),
    tenant,
    epoch,
    decidedAtTick: asTick(0),
    evidenceEvents: events(1),
    standings: [{ actor: player, score: 1 }],
    protectedGrants: {},
    subjectOfActor: {},
  });
  assert.ok(!built.ok);
  assert.equal(built.code, "outcome-invalid");
});

test("authority: evidence digests are content digests of the events (deterministic)", () => {
  const first = buildAuthoritativeOutcome({
    sessionId: session,
    tenant,
    epoch,
    decidedAtTick: asTick(0),
    evidenceEvents: events(3),
    standings: [{ actor: player, score: 1 }],
    protectedGrants: {},
    subjectOfActor: { "player:player-one": asSubjectId("player-one")! },
  });
  const second = buildAuthoritativeOutcome({
    sessionId: session,
    tenant,
    epoch,
    decidedAtTick: asTick(0),
    evidenceEvents: events(3),
    standings: [{ actor: player, score: 7 }],
    protectedGrants: {},
    subjectOfActor: { "player:player-one": asSubjectId("player-one")! },
  });
  assert.ok(first.ok && second.ok);
  assert.deepEqual(
    first.record.evidence.map(String),
    second.record.evidence.map(String),
    "evidence digests depend only on the committed events",
  );
  // And the causal command id used in fixtures round-trips as a string.
  assert.equal(String(asCommandId("cmd:x")), "cmd:x");
});
