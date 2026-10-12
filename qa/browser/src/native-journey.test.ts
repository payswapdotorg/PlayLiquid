/**
 * THE NATIVE JOURNEY (PL-043) — the LUMEN RUN reference game
 * (examples/native-game, PL-037) walked through its CANONICAL PLAYTHROUGH
 * as one user journey: the composition (GameIR-direct document, published
 * packages, the R6 spark planning evidence) → the FULL Experience Protocol
 * (load, reset, observe, act, step, snapshot, restore, replay, terminate —
 * eight recorded commands, the completed run) → the sealed replay and its
 * R11 re-execution verdict → every platform service outcome (identity-
 * scoped integrity, leaderboard, achievements, economy settlement, social)
 * consumed from the AUTHORITATIVE kernel events only (R9/R10).
 *
 * E11 (browser honesty): the playthrough is a DETERMINISTIC SIMULATION —
 * there is no engine render loop, no DOM, no rendering and no network
 * here (the PlayCanvas binding is cited as build data, never executed);
 * the first test asserts that plainly instead of faking it.
 *
 * E9 (determinism): the whole journey runs TWICE and the traces must be
 * identical — same steps, same facts, same sha256 digest (journey-kit).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
// native-game is reached through its public entrypoint (pure .ts — the
// example has no browser-mount surface).
import { runCanonicalPlaythrough } from "../../../examples/native-game/src/index.ts";
import type { CanonicalPlaythrough } from "../../../examples/native-game/src/index.ts";
import { assertSameTrajectory, createTrace } from "./journey-kit.ts";
import type { JourneyTrace } from "./journey-kit.ts";

test("native journey (E11): the canonical playthrough is a deterministic simulation under Node — no DOM, no rendering, no network", async () => {
  // The honest browser-environment statement, executable (see the studio
  // journey header test for the full argument): the reference game's
  // "render" is the pure textual/structural arena projection; no engine
  // loop runs and nothing touches the network.
  const globals = globalThis as Record<string, unknown>;
  assert.equal(globals.window, undefined, "no DOM window in this runtime");
  assert.equal(globals.document, undefined, "no DOM document in this runtime");
  const run = await runCanonicalPlaythrough();
  assert.ok(run.renders.complete.length > 0, "the headless arena render is plain text, not a DOM");
  assert.equal(run.renders.complete, run.renders.restored, "the restored world renders identically (deterministic read model)");
});

/** Walk the canonical playthrough once, recording every observable surface. */
async function runNativeJourney(): Promise<JourneyTrace> {
  const trace = createTrace();
  const run: CanonicalPlaythrough = await runCanonicalPlaythrough();

  // -- step 1: the composition (GameIR-direct; digests everywhere) --------
  trace.record("composition", {
    gameIrDigest: run.composition.gameIrDigest,
    lockFingerprint: run.composition.lockFingerprint,
    compositionDigest: run.composition.compositionDigest,
    packages: run.composition.packages.records.map((record) => String(record.identity.id)),
    spark: {
      planDigest: run.composition.spark.planDigest,
      scheduleDigest: run.composition.spark.scheduleDigest,
      cacheManifestDigest: run.composition.spark.cacheManifestDigest,
      criticalBytes: run.composition.spark.criticalBytes,
      deferredUnitCount: run.composition.spark.deferredUnitCount,
      plannedFirstPaintMs: run.composition.spark.plannedFirstPaintMs,
      plannedFirstInteractionMs: run.composition.spark.plannedFirstInteractionMs,
    },
  });
  assert.ok(run.composition.gameIrDigest.startsWith("sha256:"), "the GameIR content digest renders");
  assert.ok(run.composition.spark.criticalBytes > 0, "the R6 spark plan carries a non-empty critical budget");

  // -- step 2: the Experience Protocol walk (all nine verbs) --------------
  const session = run.session.kernel.view();
  const completed = run.events.find((event) => String(event.kind) === "run.completed");
  trace.record("experience-protocol", {
    sessionId: String(session.sessionId),
    phase: String(session.phase),
    epoch: Number(session.epoch),
    tick: Number(session.tick),
    committedEventSeq: Number(session.committedEventSeq),
    admittedCommandSeq: Number(session.admittedCommandSeq),
    commands: run.commands.map((command) => ({
      admissionSeq: command.admissionSeq,
      kind: String(command.envelope.kind),
      origin: command.envelope.origin.kind,
    })),
    eventCount: run.events.length,
    eventKinds: [...new Set(run.events.map((event) => String(event.kind)))],
    completedPresent: completed !== undefined,
    rendersStable: run.renders.start === run.renders.boundary && run.renders.complete === run.renders.restored,
    replayWindowCount: run.replayWindow.length,
  });
  assert.equal(String(session.phase), "terminated", "the playthrough walked through terminate");
  assert.equal(run.commands.length, 8, "the eight scripted commands are recorded");
  assert.ok(completed !== undefined, "the run completed (the authoritative outcome event exists)");

  // -- step 3: the sealed replay + its R11 re-execution verdict -----------
  trace.record("replay-integrity", {
    replayId: String(run.sealed.record.replayId),
    streamDigest: String(run.sealed.stream.streamDigest),
    streamEntries: run.sealed.stream.entries.length,
    witnessDigest: String(run.sealed.witness.witnessDigest),
    witnessEvents: run.sealed.witness.events.length,
    verdictKind: run.verdict.kind,
    verdictConfidence: run.verdict.confidence,
  });
  assert.equal(run.verdict.kind, "match", "the recorded command stream re-executed to a match (R11)");
  assert.equal(run.verdict.confidence, 1, "every sampled position verified");

  // -- step 4: the platform service outcomes (R9/R10/R11) ----------------
  const integrity = run.platform.integrity;
  const leaderboard = run.platform.leaderboard;
  const settlement = run.platform.settlement;
  const social = run.platform.social;
  if (!integrity.accepted || !leaderboard.accepted || !settlement.accepted || !social.accepted) {
    throw new Error("native journey: a platform submission was refused");
  }
  trace.record("platform-outcomes", {
    integrity: {
      enforcement: String(integrity.receipt.enforcement),
      report: String(integrity.receipt.reportId),
      verdict: String(integrity.verdict.verdictId),
    },
    leaderboard: {
      subject: String(leaderboard.receipt.subject),
      score: String(leaderboard.receipt.score),
      decidedBy: String(leaderboard.receipt.decidedBy),
    },
    achievements: run.platform.achievements.map((result) =>
      result.accepted
        ? result.outcomes.map((outcome) =>
            outcome.applied
              ? { achievement: String(outcome.achievement), applied: true, justUnlocked: outcome.justUnlocked }
              : { achievement: String(outcome.achievement), applied: false, refused: outcome.code },
          )
        : [{ refused: result.code }],
    ),
    settlement: {
      quantity: String(settlement.receipt.quantity),
      entitlementKind: String(settlement.receipt.entitlementKind),
      balanceAfter: String(settlement.receipt.balanceAfter),
    },
    socialRecorded: social.recorded.length,
  });
  assert.ok(Number(leaderboard.receipt.score) > 0, "the leaderboard scored the authoritative completion (R9)");
  assert.ok(settlement.receipt.quantity > 0n, "the run settled a positive reward against the integrity verdict (R10)");
  assert.ok(run.platform.achievements.length > 0, "achievement evidence applied through the platform doors");
  assert.ok(social.recorded.length > 0, "the social follow edge recorded");

  return trace.trace();
}

test("native journey: the canonical playthrough end-to-end, every observable surface factual (E5)", async () => {
  await runNativeJourney();
});

test("native journey (E9): the same run twice produces the identical trajectory and digest", async () => {
  const first = await runNativeJourney();
  const second = await runNativeJourney();
  assertSameTrajectory(first, second);
});
