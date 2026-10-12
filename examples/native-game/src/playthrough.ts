/**
 * LUMEN RUN — the canonical scripted playthrough (PL-037; E9).
 *
 * ONE deterministic, seeded run of the reference game exercising the FULL
 * Experience Protocol (load, reset, observe, act, step, snapshot, restore,
 * replay, terminate) and consuming every platform service through its
 * public contract (R7): the run's AUTHORITATIVE kernel events are the
 * only input to every platform submission (R9 — never client claims),
 * rewards settle through the platform economy against the recorded
 * integrity verdict (R10), and the playthrough's own sealed replay
 * command stream is re-executed and submitted as competitive-integrity
 * evidence (R11).
 *
 * All inputs are fixed constants (the seed, the intent timeline, the
 * platform timestamps): running this twice yields byte-identical
 * evidence. Any stage refusing throws (the script is total by
 * construction — a throw here is a defect, not a gameplay path).
 */

import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";
import type { IntegrityVerdict, RecordedCommand } from "../../../packages/replay/src/index.ts";
import { asActorId, asDeterminismSeed, asIdempotencyNonce, asTimestamp } from "../../../packages/runtime-contracts/src/index.ts";
import type { CapabilityGrantId, RuntimeEventEnvelope } from "../../../packages/runtime-contracts/src/index.ts";
import { composeGame } from "./composition.ts";
import type { GameComposition } from "./composition.ts";
import { asTimestampMs } from "../../../packages/platform-contracts/src/index.ts";
import { COMMAND_KINDS, movePayload } from "./events.ts";
import type { LumenRunWorld } from "./driver.ts";
import { CANONICAL_SEED, COMPANION_ACTOR, OPERATOR, PLAYER_ONE, PLAYER_TWO, REPLAY_ID, SESSION_ID } from "./ids.ts";
import {
  CANONICAL_FOLLOW,
  achievementEvidencesOf,
  completedEventOf,
  eventDigestOf,
  integrityRequestOf,
  scoreRecordOf,
  settlementRequestOf,
  socialCommandOf,
} from "./outcomes.ts";
import type { PlatformRig } from "./platform-services.ts";
import { createPlatformRig } from "./platform-services.ts";
import { sealCanonicalReplay, verifySealedReplay } from "./replay.ts";
import type { SealedReplay } from "./replay.ts";
import { COMPANION_GRANT_ID, actInput, companionGrant, createLumenSession, playerIntent } from "./session.ts";
import type { LumenSession } from "./session.ts";
import { renderArena } from "./view.ts";

/** The fixed intent timeline (human-like, non-decreasing; E9). */
const INTENT_ISSUED_AT = [100, 340, 720, 1_330, 1_660, 2_130, 2_680, 2_970] as const;

/** Fixed platform timestamps (caller-supplied; no clock IO anywhere). */
const DECLARED_AT = 800;
const CAPTURED_AT = 1_200;
const OBSERVED_AT = 1_500;
const RECORDED_AT = 1_300;

/** The client actor (submits intents, never outcomes — lock rule 13). */
const PLAYER_REF = { actorClass: "player", actorId: asActorId(String(PLAYER_ONE)) } as const;
/** The companion avatar actor (acts only through grants — lock rule 14). */
const COMPANION_REF = { actorClass: "avatar-agent", actorId: asActorId(COMPANION_ACTOR) } as const;

/** Everything the canonical playthrough produced (the evidence trail). */
export interface CanonicalPlaythrough {
  readonly composition: GameComposition;
  readonly rig: PlatformRig;
  readonly session: LumenSession;
  readonly commands: readonly RecordedCommand[];
  /** The completed run's authoritative log (pre-restore, seq 1..N). */
  readonly events: readonly RuntimeEventEnvelope<GameIRValue>[];
  /** The window the `replay` verb returned (the recorded post-boundary run). */
  readonly replayWindow: readonly RuntimeEventEnvelope<GameIRValue>[];
  readonly boundarySnapshotId: string;
  readonly finalSnapshotId: string;
  readonly sealed: SealedReplay;
  readonly verdict: IntegrityVerdict;
  readonly renders: { readonly start: string; readonly boundary: string; readonly complete: string; readonly restored: string };
  readonly platform: {
    readonly integrity: ReturnType<PlatformRig["integrity"]["submitEvaluation"]>;
    readonly leaderboard: ReturnType<PlatformRig["leaderboard"]["submitScore"]>;
    readonly achievements: readonly ReturnType<PlatformRig["achievements"]["applyEvidence"]>[];
    readonly settlement: ReturnType<PlatformRig["economy"]["settleEvent"]>;
    readonly social: ReturnType<PlatformRig["social"]["submit"]>;
  };
}

/** Runs the canonical playthrough end to end (deterministic, E9). */
export async function runCanonicalPlaythrough(): Promise<CanonicalPlaythrough> {
  const compositionResult = await composeGame();
  if (!compositionResult.ok) throw new Error(`composition refused: ${compositionResult.code}`);
  const composition = compositionResult;
  const document = composition.document;
  const rig = createPlatformRig(document);
  const session = createLumenSession({ document, seed: CANONICAL_SEED, sessionId: SESSION_ID });
  const commands: RecordedCommand[] = [];
  const renders: { start: string; boundary: string; complete: string; restored: string } = { start: "", boundary: "", complete: "", restored: "" };

  // -- load + observe + reset (the run happens in epoch 2) ------------------
  const loaded = session.kernel.load();
  if (loaded.status !== "loaded") throw new Error(`load refused: ${String(loaded.status)}`);
  const firstObserve = session.kernel.observe(0);
  if (firstObserve.status !== "observed") throw new Error("initial observe refused");
  const startSnapshot = session.kernel.snapshot();
  if (startSnapshot.status !== "snapshotted") throw new Error("start snapshot refused");
  renders.start = renderArena(worldOf(session, startSnapshot.snapshot.snapshotId));
  const reset = session.kernel.reset(asDeterminismSeed(CANONICAL_SEED));
  if (reset.status !== "reset") throw new Error(`reset refused: ${String(reset.status)}`);

  // -- the replay boundary: a snapshot of the fresh post-reset world --------
  const boundary = session.kernel.snapshot();
  if (boundary.status !== "snapshotted") throw new Error(`boundary snapshot refused: ${String(boundary.status)}`);
  renders.boundary = renderArena(worldOf(session, boundary.snapshot.snapshotId));
  session.capabilityPort.issueGrant(companionGrant(SESSION_ID, reset.epoch));

  // -- the scripted completion run (eight recorded commands) ----------------
  const stepTo = (ticks: number): void => {
    const step = session.kernel.step(ticks);
    if (step.status !== "stepped") throw new Error(`step refused: ${String(step.status)}`);
  };
  const act = (kind: string, payload: GameIRValue, grantId?: CapabilityGrantId): void => {
    const index = commands.length;
    const issuedAt = INTENT_ISSUED_AT[index];
    if (issuedAt === undefined) throw new Error("script overflow: more acts than the fixed timeline");
    const actor = grantId === undefined ? PLAYER_REF : COMPANION_REF;
    const intent = playerIntent(actor, kind, payload, issuedAt, index + 1);
    const dueTick = Number(session.kernel.view().tick);
    const result = session.kernel.act(actInput(intent, `nonce-${index + 1}`, grantId));
    if (result.status !== "committed") throw new Error(`act ${kind} refused: ${result.status}`);
    commands.push({
      admissionSeq: result.commandSeq,
      dueTick,
      envelope: {
        commandId: result.commandId,
        sessionId: session.descriptor.sessionId,
        kind: kind as never,
        epoch: result.epoch,
        actor,
        origin: grantId === undefined ? { kind: "player-input" } : { kind: "broker-mediated", grantId },
        idempotencyKey: { scope: "command", actor: actor.actorId, nonce: asIdempotencyNonce(`nonce-${index + 1}`) },
        issuedAt: asTimestamp(issuedAt),
        payload,
      },
    });
  };

  stepTo(1);
  act(COMMAND_KINDS.heroLook, { kind: "unit" });
  act(COMMAND_KINDS.heroMove, movePayload(1, 1));
  stepTo(1);
  act(COMMAND_KINDS.companionMove, movePayload(2, 2), COMPANION_GRANT_ID);
  act(COMMAND_KINDS.heroLook, { kind: "unit" });
  act(COMMAND_KINDS.heroMove, movePayload(3, 3));
  stepTo(1);
  act(COMMAND_KINDS.heroLook, { kind: "unit" });
  act(COMMAND_KINDS.companionMove, movePayload(4, 3), COMPANION_GRANT_ID);
  act(COMMAND_KINDS.heroMove, movePayload(5, 4));
  stepTo(1);
  const finalSnapshot = session.kernel.snapshot();
  if (finalSnapshot.status !== "snapshotted") throw new Error(`final snapshot refused: ${String(finalSnapshot.status)}`);
  renders.complete = renderArena(worldOf(session, finalSnapshot.snapshot.snapshotId));

  const completionObserve = session.kernel.observe(0);
  if (completionObserve.status !== "observed") throw new Error("completion observe refused");
  const events = completionObserve.observation.events as readonly RuntimeEventEnvelope<GameIRValue>[];
  const completed = completedEventOf(events);
  if (completed === undefined) throw new Error("canonical run did not complete");
  const postBoundaryEvents = events.slice(boundary.snapshot.afterEventSeq);

  // -- the sealed replay + its R11 re-execution verdict ---------------------
  const sealed = sealCanonicalReplay({
    document,
    events: postBoundaryEvents,
    commands,
    boundary: {
      afterEventSeq: boundary.snapshot.afterEventSeq,
      tick: Number(boundary.snapshot.tick),
      snapshotId: String(boundary.snapshot.snapshotId),
      formDigest: String(boundary.snapshot.stateDigest),
      artifact: session.snapshots.load(boundary.snapshot.snapshotId),
    },
    toEventSeq: Number(finalSnapshot.snapshot.afterEventSeq),
    toTick: Number(finalSnapshot.snapshot.tick),
  });
  const verdict = verifySealedReplay(document, sealed);
  if (verdict.kind !== "match") throw new Error(`canonical replay did not re-execute to a match: ${verdict.kind}`);

  // -- platform submissions (R9/R10/R11; authoritative events only) --------
  const integrity = rig.integrity.submitEvaluation(
    OPERATOR,
    integrityRequestOf({
      subject: PLAYER_ONE,
      // The declared slug the evaluation cites (R8); the content-addressed
      // record identity rides the artifact digests the request carries.
      replayId: REPLAY_ID,
      stream: sealed.stream,
      reexecution: { observedAgainst: sealed.stream.streamDigest, verdict, observedAt: asTimestampMs(OBSERVED_AT)! },
      declaredAt: DECLARED_AT,
      capturedAt: CAPTURED_AT,
      document,
    }),
  );
  if (!integrity.accepted) throw new Error(`integrity evaluation refused: ${String(integrity.code)}`);

  const confidence = verdict.confidence;
  const leaderboard = rig.leaderboard.submitScore(PLAYER_ONE, {
    record: scoreRecordOf({ subject: PLAYER_ONE, completed, recordedAt: RECORDED_AT }),
    integrityConfidence: confidence,
  });
  if (!leaderboard.accepted) throw new Error(`leaderboard submission refused: ${String(leaderboard.code)}`);

  const achievements: ReturnType<PlatformRig["achievements"]["applyEvidence"]>[] = [];
  for (const evidence of achievementEvidencesOf({ subject: PLAYER_ONE, events, observedAt: RECORDED_AT })) {
    achievements.push(rig.achievements.applyEvidence(PLAYER_ONE, evidence));
  }

  const settlement = rig.economy.settleEvent(
    PLAYER_ONE,
    settlementRequestOf({
      subject: PLAYER_ONE,
      completed,
      outcomeEvidence: eventDigestOf(completed),
      integrityConfidence: confidence,
    }),
  );
  if (!settlement.accepted) throw new Error(`settlement refused: ${String(settlement.code)}`);

  const social = rig.social.submit(
    socialCommandOf({ actor: CANONICAL_FOLLOW.actor, target: CANONICAL_FOLLOW.target, tick: Number(completed.tick) }),
  );
  if (!social.accepted) throw new Error(`social command refused: ${String(social.code)}`);

  // -- restore + the replay verb + terminate (the last three verbs) --------
  const restored = session.kernel.restore(finalSnapshot.snapshot.snapshotId);
  if (restored.status !== "restored") throw new Error(`restore refused: ${String(restored.status)}`);
  renders.restored = renderArena(worldOf(session, finalSnapshot.snapshot.snapshotId));
  const postRestoreAct = session.kernel.act(
    actInput(playerIntent(PLAYER_REF, COMMAND_KINDS.heroLook, { kind: "unit" }, 3_100, 9), "nonce-9"),
  );
  if (postRestoreAct.status !== "committed") throw new Error(`post-restore act refused: ${postRestoreAct.status}`);
  const replayOp = session.kernel.replay({
    fromEventSeq: boundary.snapshot.afterEventSeq + 1,
    toEventSeq: Number(finalSnapshot.snapshot.afterEventSeq),
  });
  if (replayOp.status !== "replayed") throw new Error(`replay verb refused: ${String(replayOp.status)}`);
  const terminated = session.kernel.terminate("canonical playthrough complete");
  if (terminated.status !== "terminated") throw new Error(`terminate refused: ${String(terminated.status)}`);

  return {
    composition,
    rig,
    session,
    commands,
    events,
    replayWindow: replayOp.events as readonly RuntimeEventEnvelope<GameIRValue>[],
    boundarySnapshotId: String(boundary.snapshot.snapshotId),
    finalSnapshotId: String(finalSnapshot.snapshot.snapshotId),
    sealed,
    verdict,
    renders,
    platform: { integrity, leaderboard, achievements, settlement, social },
  };
}

/** Reads one snapshot's world payload back (the honest world read model). */
function worldOf(session: LumenSession, snapshotId: string): LumenRunWorld {
  const payload = session.snapshots.load(snapshotId as never);
  if (payload === undefined) throw new Error(`no snapshot ${snapshotId} to render`);
  return payload.world as LumenRunWorld;
}

/** The follow edge's target (kept referenced for the social assertion). */
export const CANONICAL_SOCIAL_TARGET = PLAYER_TWO;
