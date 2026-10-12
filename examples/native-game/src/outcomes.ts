/**
 * LUMEN RUN — authoritative-outcome derivations (PL-037; R9/R10/R11).
 *
 * The bridge between the AUTHORITATIVE runtime event log and the platform
 * services: every platform submission this game makes is DERIVED here
 * from recorded kernel events (content-addressed by game-ir's own event
 * hashing) — never from client claims. A client may submit intents; the
 * kernel validates/simulates and emits state/events; the outcomes below
 * are the platform-visible projections of those events (lock rule 19:
 * competitive outcomes are authoritative outside the untrusted client).
 *
 * Pure module: builders only; the playthrough submits them.
 */

import { asEventTypeId, hashEvent } from "../../../packages/game-ir/src/index.ts";
import type { GameEvent, GameIRValue } from "../../../packages/game-ir/src/index.ts";
import type { RuntimeEventEnvelope } from "../../../packages/runtime-contracts/src/index.ts";
import { asTimestampMs } from "../../../packages/platform-contracts/src/index.ts";
import type { AuthoritativeScoreRecord, ContentDigest, SubjectId } from "../../../packages/platform-contracts/src/index.ts";
import type { EconomySettlementRequest } from "../../../packages/platform-economy/src/index.ts";
import type { AchievementEventEvidence } from "../../../packages/platform-achievements/src/index.ts";
import type { SocialGraphCommand } from "../../../packages/platform-social/src/index.ts";
import type { IntegrityEvaluationRequest, ReplayReexecutionObservation } from "../../../packages/platform-integrity/src/index.ts";
import type { CommandStreamArtifact } from "../../../packages/replay/src/index.ts";
import { EVENT_TYPES, PLATFORM_EVENT_KINDS } from "./events.ts";
import { socialEchoPayload } from "./events.ts";
import { PLAYER_ONE, PLAYER_TWO, TENANT } from "./ids.ts";
import { LUMEN_BOARD, LUMEN_SOCIAL_POLICY, SCORE_SHARD_VALUE_DIGEST, declaredIntegrityPosture } from "./platform-policy.ts";
import type { GameIRDocument } from "../../../packages/game-ir/src/index.ts";

/** Projects a kernel event envelope onto the game-ir canonical event form. */
export function gameEventOf(envelope: RuntimeEventEnvelope<GameIRValue>): GameEvent {
  return { type: asEventTypeId(String(envelope.kind))!, payload: envelope.payload, tick: Number(envelope.tick) };
}

/** The bare-hex content digest of one recorded event (game-ir hashing). */
export function eventDigestOf(envelope: RuntimeEventEnvelope<GameIRValue>): ContentDigest {
  return hashEvent(gameEventOf(envelope)) as ContentDigest;
}

/** Reads one int field off a record-shaped event payload. */
export function intFieldOf(payload: GameIRValue, field: string): number {
  if (payload.kind !== "record") throw new Error(`payload is not a record (${payload.kind})`);
  const value = payload.fields[field];
  if (value?.kind !== "int") throw new Error(`payload field ${field} is not an int value`);
  return Number(value.value);
}

/** The authoritative run-completed event of a playthrough, if completed. */
export function completedEventOf(events: readonly RuntimeEventEnvelope<GameIRValue>[]): RuntimeEventEnvelope<GameIRValue> | undefined {
  return events.find((event) => String(event.kind) === EVENT_TYPES.runCompleted);
}

/** The leaderboard score record derived from the authoritative outcome. */
export function scoreRecordOf(input: {
  readonly subject: SubjectId;
  readonly completed: RuntimeEventEnvelope<GameIRValue>;
  readonly recordedAt: number;
}): AuthoritativeScoreRecord {
  return {
    tenant: TENANT,
    leaderboard: LUMEN_BOARD.leaderboard,
    subject: input.subject,
    score: intFieldOf(input.completed.payload, "score"),
    recordedAt: asTimestampMs(input.recordedAt)!,
    sourceEventKind: PLATFORM_EVENT_KINDS.runCompleted,
    evidence: eventDigestOf(input.completed),
    decidedBy: "platform-authority",
  };
}

/** The achievement evidences derived from the run's game events. */
export function achievementEvidencesOf(input: {
  readonly subject: SubjectId;
  readonly events: readonly RuntimeEventEnvelope<GameIRValue>[];
  readonly observedAt: number;
}): readonly AchievementEventEvidence[] {
  const kinds = new Set<string>([EVENT_TYPES.lumenCollected, EVENT_TYPES.runCompleted]);
  return input.events
    .filter((event) => kinds.has(String(event.kind)))
    .map((event) => ({
      tenant: TENANT,
      subject: input.subject,
      eventKind: (String(event.kind) === EVENT_TYPES.runCompleted ? PLATFORM_EVENT_KINDS.runCompleted : PLATFORM_EVENT_KINDS.lumenCollected),
      digest: eventDigestOf(event),
      observedAt: asTimestampMs(input.observedAt)!,
    }));
}

/** The settlement request for the completed run (R10: platform settlement). */
export function settlementRequestOf(input: {
  readonly subject: SubjectId;
  readonly completed: RuntimeEventEnvelope<GameIRValue>;
  readonly outcomeEvidence: ContentDigest;
  readonly integrityConfidence: number;
}): EconomySettlementRequest {
  return {
    tenant: TENANT,
    subject: input.subject,
    eventKind: PLATFORM_EVENT_KINDS.runCompleted,
    sourceEventDigest: eventDigestOf(input.completed),
    value: { carrier: "opaque-digest", payloadDigest: SCORE_SHARD_VALUE_DIGEST },
    outcomeEvidence: input.outcomeEvidence,
    outcomeDecidedBy: "platform-authority",
    integrityConfidence: input.integrityConfidence,
    mode: "immediate",
  };
}

/** The social relation command with its game-ir event evidence. */
export function socialCommandOf(input: {
  readonly actor: SubjectId;
  readonly target: SubjectId;
  readonly tick: number;
}): SocialGraphCommand {
  return {
    tenant: TENANT,
    kind: "follow",
    actor: input.actor,
    target: input.target,
    evidence: {
      event: {
        type: asEventTypeId(EVENT_TYPES.socialEcho)!,
        payload: socialEchoPayload(String(input.actor), String(input.target)),
        tick: input.tick,
      },
      binding: LUMEN_SOCIAL_POLICY.binding,
    },
  };
}

/** The integrity evaluation request over the playthrough's own replay (R11). */
export function integrityRequestOf(input: {
  readonly subject: SubjectId;
  readonly replayId: string;
  readonly stream: CommandStreamArtifact;
  readonly reexecution: ReplayReexecutionObservation;
  readonly declaredAt: number;
  readonly capturedAt: number;
  readonly document: GameIRDocument;
}): IntegrityEvaluationRequest {
  return {
    tenant: TENANT,
    subject: input.subject,
    source: { replayId: input.replayId, commandStream: input.stream },
    reexecution: input.reexecution,
    claim: {
      claimKind: "declared",
      declaration: { declarationKind: "participation.human", tenant: TENANT, subject: input.subject, declaredAt: asTimestampMs(input.declaredAt)! },
    },
    enforcement: declaredIntegrityPosture(input.document),
    capturedAt: asTimestampMs(input.capturedAt)!,
  };
}

/** Convenience: the canonical follow edge of the playthrough. */
export const CANONICAL_FOLLOW = { actor: PLAYER_ONE, target: PLAYER_TWO } as const;
