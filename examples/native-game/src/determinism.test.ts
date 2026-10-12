/**
 * DETERMINISM TESTS (PL-037; E9) — same inputs ⇒ same outputs, everywhere
 * a derivation exists: the composition (digests), the GameIR document,
 * the outcome derivations, the headless view and the seeded trajectories.
 *
 * The strongest form runs the canonical playthrough TWICE and deep-compares
 * the whole evidence trail (command ids, event envelopes, sealed replay
 * digests, verdict, renders, platform receipts) — anything derived from a
 * clock, a random source or object-identity order would surface here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameIRDocument, GameIRValue } from "../../../packages/game-ir/src/index.ts";
import type { RuntimeEventEnvelope } from "../../../packages/runtime-contracts/src/index.ts";
import { asActorId, asDeterminismSeed } from "../../../packages/runtime-contracts/src/index.ts";
import { composeGame } from "./composition.ts";
import { lumenRunDocument } from "./document.ts";
import { documentArtifactBytes } from "./packages.ts";
import { completedEventOf, eventDigestOf, scoreRecordOf } from "./outcomes.ts";
import { runCanonicalPlaythrough } from "./playthrough.ts";
import type { CanonicalPlaythrough } from "./playthrough.ts";
import { actInput, createLumenSession, playerIntent } from "./session.ts";
import { COMMAND_KINDS, movePayload } from "./events.ts";
import { CANONICAL_SEED, PLAYER_ONE, SESSION_ID } from "./ids.ts";
import { initialLumenRunWorld } from "./driver.ts";
import { renderArena, viewModelOf } from "./view.ts";

const PLAYER_REF = { actorClass: "player", actorId: asActorId(String(PLAYER_ONE)) } as const;

/** A JSON-deep-comparable projection of one full playthrough run. */
function evidenceOf(run: CanonicalPlaythrough) {
  const envelope = (event: RuntimeEventEnvelope<GameIRValue>) => ({
    id: String(event.eventId),
    kind: String(event.kind),
    tick: Number(event.tick),
    seq: Number(event.seq),
    payload: event.payload,
  });
  const integrity = run.platform.integrity;
  const leaderboard = run.platform.leaderboard;
  const settlement = run.platform.settlement;
  const social = run.platform.social;
  if (!integrity.accepted || !leaderboard.accepted || !settlement.accepted || !social.accepted) {
    throw new Error("canonical playthrough had a refused platform submission");
  }
  return {
    composition: {
      gameIrDigest: run.composition.gameIrDigest,
      lockFingerprint: run.composition.lockFingerprint,
      compositionDigest: run.composition.compositionDigest,
      spark: run.composition.spark,
    },
    commands: run.commands.map((command) => ({
      admissionSeq: command.admissionSeq,
      dueTick: command.dueTick,
      commandId: String(command.envelope.commandId),
      kind: String(command.envelope.kind),
      epoch: Number(command.envelope.epoch),
      origin: command.envelope.origin,
      nonce: String(command.envelope.idempotencyKey.nonce),
      payload: command.envelope.payload,
    })),
    events: run.events.map(envelope),
    replayWindow: run.replayWindow.map(envelope),
    boundarySnapshotId: run.boundarySnapshotId,
    finalSnapshotId: run.finalSnapshotId,
    sealed: {
      record: run.sealed.record.replayId,
      stream: run.sealed.stream.streamDigest,
      witness: run.sealed.witness.witnessDigest,
    },
    verdict: run.verdict,
    renders: run.renders,
    platform: {
      integrity: { enforcement: integrity.receipt.enforcement, report: integrity.receipt.reportId },
      leaderboard: { score: leaderboard.receipt.score, decidedBy: leaderboard.receipt.decidedBy },
      achievements: run.platform.achievements.map((result) =>
        result.accepted
          ? result.outcomes.map((outcome) =>
              outcome.applied
                ? { achievement: String(outcome.achievement), applied: true, justUnlocked: outcome.justUnlocked }
                : { achievement: String(outcome.achievement), applied: false, refused: outcome.code },
            )
          : [{ refused: result.code }],
      ),
      settlement: { quantity: settlement.receipt.quantity, balanceAfter: settlement.receipt.balanceAfter },
      social: { recorded: social.recorded.length },
    },
  };
}

test("determinism: the composition seals identically from the same inputs", async () => {
  const first = await composeGame();
  const second = await composeGame();
  if (!first.ok || !second.ok) throw new Error("canonical composition refused");
  assert.equal(first.gameIrDigest, second.gameIrDigest);
  assert.equal(first.lockFingerprint, second.lockFingerprint);
  assert.equal(first.compositionDigest, second.compositionDigest);
  assert.deepEqual(first.spark, second.spark);
  assert.equal(String(first.profile.profileDigest), String(second.profile.profileDigest));
  assert.equal(String(first.engineBinding.bindingDigest), String(second.engineBinding.bindingDigest));
  // Every published package record is content-addressed identically.
  assert.deepEqual(
    first.packages.records.map((record) => ({ id: record.identity.id, digest: record.identity.contentDigest })),
    second.packages.records.map((record) => ({ id: record.identity.id, digest: record.identity.contentDigest })),
  );
});

test("determinism: the GameIR document is structurally identical on every derivation", () => {
  const first = lumenRunDocument();
  const second = lumenRunDocument();
  assert.deepEqual(first, second);
  assert.deepEqual(documentArtifactBytes(first), documentArtifactBytes(second));
});

test("determinism: two independent canonical playthroughs produce identical evidence", async () => {
  const first = await runCanonicalPlaythrough();
  const second = await runCanonicalPlaythrough();
  assert.deepEqual(evidenceOf(first), evidenceOf(second));
});

test("determinism: outcome derivations are pure over the same authoritative events", async () => {
  const run = await runCanonicalPlaythrough();
  const completed = completedEventOf([...run.events]);
  if (completed === undefined) throw new Error("canonical run did not complete");
  assert.deepEqual(eventDigestOf(completed), eventDigestOf({ ...completed }));
  assert.deepEqual(
    scoreRecordOf({ subject: PLAYER_ONE, completed, recordedAt: 1_300 }),
    scoreRecordOf({ subject: PLAYER_ONE, completed, recordedAt: 1_300 }),
  );
  // The derived score is the authoritative event's own field (R9).
  const score = Number((completed.payload as unknown as { fields: { score: { value: bigint } } }).fields.score.value);
  assert.equal(score, 300 - 10 * Number(completed.tick));
});

test("determinism: the headless view renders the same world byte for byte", async () => {
  const run = await runCanonicalPlaythrough();
  const document = run.composition.document;
  const seed = asDeterminismSeed(CANONICAL_SEED);
  const world = initialLumenRunWorld(document, seed);
  assert.deepEqual(viewModelOf(world), viewModelOf(world));
  assert.equal(renderArena(world), renderArena(world));
  // The completed arena render is a stable string (the harness's evidence).
  assert.equal(typeof run.renders.complete, "string");
  assert.ok(run.renders.complete.includes("run complete"));
});

/** Drives a fixed short script through one fresh seeded session. */
function scriptedEvents(document: GameIRDocument, seed: string, sessionId: string): readonly RuntimeEventEnvelope<GameIRValue>[] {
  const session = createLumenSession({ document, seed, sessionId });
  if (session.kernel.load().status !== "loaded") throw new Error("scripted load refused");
  const act = (kind: string, payload: GameIRValue, nonce: string): void => {
    const result = session.kernel.act(actInput(playerIntent(PLAYER_REF, kind, payload, 100, 1), nonce));
    if (result.status !== "committed") throw new Error(`scripted act ${kind} refused: ${result.status}`);
  };
  act(COMMAND_KINDS.heroLook, { kind: "unit" }, "s-1");
  act(COMMAND_KINDS.heroMove, movePayload(1, 1), "s-2");
  if (session.kernel.step(1).status !== "stepped") throw new Error("scripted step refused");
  act(COMMAND_KINDS.heroMove, movePayload(2, 2), "s-3");
  const observed = session.kernel.observe(0);
  if (observed.status !== "observed") throw new Error("scripted observe refused");
  return observed.observation.events as readonly RuntimeEventEnvelope<GameIRValue>[];
}

test("determinism: the same seed ⇒ an identical trajectory; a different seed ⇒ a different one", async () => {
  const run = await runCanonicalPlaythrough();
  const document = run.composition.document;
  const sameSeed = scriptedEvents(document, CANONICAL_SEED, SESSION_ID);
  const sameSeedAgain = scriptedEvents(document, CANONICAL_SEED, SESSION_ID);
  const otherSeed = scriptedEvents(document, "lumen-run-seed-x9", SESSION_ID);
  // Same seed: byte-identical envelopes (ids, seqs, kinds, payloads).
  assert.deepEqual(sameSeed, sameSeedAgain);
  // A different seed: the mote drift pattern differs (the seed drives it).
  assert.notDeepEqual(sameSeed, otherSeed);
  const driftsOf = (events: readonly RuntimeEventEnvelope<GameIRValue>[]) =>
    events.filter((event) => String(event.kind) === "run.mote.drifted").map((event) => event.payload);
  assert.notDeepEqual(driftsOf(sameSeed), driftsOf(otherSeed));
});
