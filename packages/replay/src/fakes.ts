/**
 * IN-MEMORY FAKES for the replay ports (the sanctioned non-pure edge — all
 * state is process-local memory; no IO, no network, no timers).
 *
 * - {@link InMemoryReplayStore}: the {@link ReplaySource} fake. Writes
 *   VERIFY artifacts before accepting them (fail closed, E7/E9) and refuse
 *   conflicting rewrites of the same content-addressed identity (E10:
 *   records are immutable; same id must mean same bytes, forever).
 *
 * The append-only derivation ledger fake (E10) lives in derivation.ts
 * (`InMemoryDerivationLedger`) next to its model.
 *
 * Every fake is deterministic: same inputs, same observable behavior.
 */

import type { ContentDigest } from "@playliquid/package-system";
import type { CommandStreamArtifact } from "./command-stream.ts";
import { verifyCommandStream } from "./command-stream.ts";
import type { EventWitnessArtifact } from "./event-witness.ts";
import { verifyEventWitness } from "./event-witness.ts";
import type { ReplayRecord } from "./record.ts";
import { replayRecordIdentity } from "./record.ts";
import type { ReplaySource } from "./source.ts";

/** A Map-backed, write-verified {@link ReplaySource}. */
export class InMemoryReplayStore implements ReplaySource {
  private readonly replays = new Map<string, ReplayRecord>();
  private readonly streams = new Map<string, CommandStreamArtifact>();
  private readonly witnesses = new Map<string, EventWitnessArtifact>();

  /** Puts a sealed replay record. Refuses unverifiable or conflicting writes. */
  putReplay(record: ReplayRecord): void {
    const identity = replayRecordIdentity(record);
    if (identity !== record.replayId) {
      throw new RangeError(`replay-store: record identity mismatch (${record.replayId} != ${identity})`);
    }
    const existing = this.replays.get(record.replayId);
    if (existing !== undefined) {
      // E10: the same identity can only ever address the same bytes.
      if (
        existing.commandStream !== record.commandStream ||
        existing.eventWitness !== record.eventWitness ||
        existing.capture.fromEventSeq !== record.capture.fromEventSeq ||
        existing.capture.toEventSeq !== record.capture.toEventSeq ||
        existing.capture.toTick !== record.capture.toTick
      ) {
        throw new RangeError(`replay-store: refusing rewrite of immutable replay ${record.replayId}`);
      }
      return;
    }
    this.replays.set(record.replayId, record);
  }

  /** Puts a command stream artifact (verified first; conflicting digests refused). */
  putCommandStream(artifact: CommandStreamArtifact): void {
    const verification = verifyCommandStream(artifact);
    if (!verification.ok) {
      throw new RangeError(`replay-store: unverifiable command stream (${verification.code}: ${verification.detail})`);
    }
    const existing = this.streams.get(artifact.streamDigest);
    if (existing !== undefined && existing.form !== artifact.form) {
      throw new RangeError(`replay-store: digest collision for command stream ${artifact.streamDigest}`);
    }
    this.streams.set(artifact.streamDigest, artifact);
  }

  /** Puts an event witness artifact (verified first; conflicting digests refused). */
  putEventWitness(artifact: EventWitnessArtifact): void {
    const verification = verifyEventWitness(artifact);
    if (!verification.ok) {
      throw new RangeError(`replay-store: unverifiable event witness (${verification.code}: ${verification.detail})`);
    }
    const existing = this.witnesses.get(artifact.witnessDigest);
    if (existing !== undefined && existing.form !== artifact.form) {
      throw new RangeError(`replay-store: digest collision for event witness ${artifact.witnessDigest}`);
    }
    this.witnesses.set(artifact.witnessDigest, artifact);
  }

  loadReplay(replayId: string): ReplayRecord | undefined {
    return this.replays.get(replayId);
  }

  loadCommandStream(streamDigest: ContentDigest): CommandStreamArtifact | undefined {
    return this.streams.get(streamDigest);
  }

  loadEventWitness(witnessDigest: ContentDigest): EventWitnessArtifact | undefined {
    return this.witnesses.get(witnessDigest);
  }

  /** Number of records held. */
  get replayCount(): number {
    return this.replays.size;
  }
}
