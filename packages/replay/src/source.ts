/**
 * THE REPLAY SOURCE PORT (R8 — replay reused by players, QA, integrity,
 * simulation and Lab; lock 15 — replay is a platform primitive).
 *
 * Everything that consumes replays reads through THIS port: players watch
 * the recorded event witness, QA re-executes command streams against a
 * runtime, integrity compares recorded vs re-executed streams (R11), the
 * Lab uses records as counterfactual baselines. The port serves TYPED
 * artifacts; implementations (in-memory fake here, the platform artifact
 * store in later Work Orders) own the bytes, content verification and
 * retention (platform-contracts replay.ts owns cataloging/access control —
 * a different concern, deliberately not duplicated here).
 *
 * Contract: `undefined` means "no such artifact". Artifacts that FAIL
 * content verification are never served — implementations verify at write
 * and re-verify at read (fail closed, E7/E9).
 *
 * Pure port types: no IO in this module.
 */

import type { ContentDigest } from "@playliquid/package-system";
import type { CommandStreamArtifact } from "./command-stream.ts";
import type { EventWitnessArtifact } from "./event-witness.ts";
import type { ReplayRecord } from "./record.ts";

/** The read side of the replay platform primitive (R8). */
export interface ReplaySource {
  /** Loads a sealed replay record by its content-addressed identity. */
  loadReplay(replayId: string): ReplayRecord | undefined;
  /** Loads the recorded command stream by its content digest. */
  loadCommandStream(streamDigest: ContentDigest): CommandStreamArtifact | undefined;
  /** Loads the recorded event witness by its content digest. */
  loadEventWitness(witnessDigest: ContentDigest): EventWitnessArtifact | undefined;
}
