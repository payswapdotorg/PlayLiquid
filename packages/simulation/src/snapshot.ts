/**
 * BYTE-STABLE SESSION SNAPSHOTS.
 *
 * A snapshot is the FULL deterministic continuation state of a simulation
 * session at an event-log boundary: world state (codec-encoded), RNG stream
 * position, pending (scheduled but not yet executed) commands, the
 * admitted-command and idempotency tables, and the sequence counters. The
 * canonical byte form ({@link canonicalSnapshotForm} over the codec) is
 * what makes snapshots content-addressed: the snapshotId is the sha256 of
 * the form, so identical continuation state yields identical ids and
 * identical bytes on every machine (E9), and restore-then-continue equals a
 * never-interrupted run.
 *
 * Purity: building and validating a snapshot payload is pure; the sha256
 * uses node:crypto only (same as @playliquid/game-ir evaluate.ts).
 */

import { createHash } from "node:crypto";
import type {
  Digest,
  RuntimeCommandEnvelope,
  SessionEpoch,
  SessionId,
  Tick,
} from "@playliquid/runtime-contracts";
import { asDigest, asSnapshotId } from "@playliquid/runtime-contracts";
import type { GameIRValue } from "@playliquid/game-ir";
import { canonicalJsonString, decodeGameIRValue, encodeGameIRValue } from "./codec.ts";
import type { JsonSafe } from "./codec.ts";
import type { RngState, SimulationSnapshot } from "./ports.ts";
import type { WorldState } from "./world.ts";
import { worldStateDigest } from "./world.ts";

/** One pending command as serialized snapshot data. */
export interface PendingCommandRecord {
  readonly dueTick: number;
  readonly assignedSeq: number;
  readonly command: {
    readonly commandId: string;
    readonly sessionId: string;
    readonly kind: string;
    readonly epoch: number;
    readonly actor: { readonly actorClass: string; readonly actorId: string };
    readonly origin: JsonSafe;
    readonly idempotencyKey: JsonSafe;
    readonly issuedAt: number;
    readonly payload: JsonSafe;
  };
}
/** One idempotency encounter record as serialized snapshot data. */
export interface IdempotencyRecord {
  readonly scope: string;
  readonly actor: string;
  readonly nonce: string;
  readonly fingerprint: string;
}

/** The structured, JSON-safe snapshot payload (the continuation state). */
export interface SimulationSnapshotPayload {
  readonly sessionId: string;
  readonly epoch: number;
  readonly tick: number;
  readonly afterEventSeq: number;
  readonly admittedCommandSeq: number;
  readonly rngState: RngState;
  readonly world: JsonSafe;
  readonly pending: readonly PendingCommandRecord[];
  readonly admittedCommandIds: readonly string[];
  readonly idempotency: readonly IdempotencyRecord[];
}

/** Inputs to {@link buildSnapshotPayload} (live session continuation state). */
export interface SnapshotBuildInput {
  readonly sessionId: SessionId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  readonly afterEventSeq: number;
  readonly admittedCommandSeq: number;
  readonly rngState: RngState;
  readonly world: WorldState;
  readonly pending: readonly {
    readonly envelope: RuntimeCommandEnvelope<GameIRValue>;
    readonly assignedSeq: number;
    readonly dueTick: Tick;
  }[];
  readonly admittedCommandIds: readonly string[];
  readonly idempotency: readonly IdempotencyRecord[];
}

function encodeOrigin(origin: RuntimeCommandEnvelope<GameIRValue>["origin"]): JsonSafe {
  if (origin.kind === "broker-mediated") {
    return { kind: "broker-mediated", grantId: origin.grantId };
  }
  return { kind: origin.kind };
}

function encodeIdempotencyKey(key: RuntimeCommandEnvelope<GameIRValue>["idempotencyKey"]): JsonSafe {
  return { scope: key.scope, actor: key.actor, nonce: key.nonce };
}

/** Builds the JSON-safe snapshot payload from live continuation state. */
export function buildSnapshotPayload(input: SnapshotBuildInput): SimulationSnapshotPayload {
  return {
    sessionId: input.sessionId,
    epoch: input.epoch,
    tick: input.tick,
    afterEventSeq: input.afterEventSeq,
    admittedCommandSeq: input.admittedCommandSeq,
    rngState: input.rngState,
    world: encodeGameIRValue(input.world),
    pending: input.pending
      .slice()
      .sort((a, b) => a.dueTick - b.dueTick || a.assignedSeq - b.assignedSeq)
      .map((entry) => ({
        dueTick: entry.dueTick,
        assignedSeq: entry.assignedSeq,
        command: {
          commandId: entry.envelope.commandId,
          sessionId: entry.envelope.sessionId,
          kind: entry.envelope.kind,
          epoch: entry.envelope.epoch,
          actor: {
            actorClass: entry.envelope.actor.actorClass,
            actorId: entry.envelope.actor.actorId,
          },
          origin: encodeOrigin(entry.envelope.origin),
          idempotencyKey: encodeIdempotencyKey(entry.envelope.idempotencyKey),
          issuedAt: entry.envelope.issuedAt,
          payload: encodeGameIRValue(entry.envelope.payload),
        },
      })),
    admittedCommandIds: [...input.admittedCommandIds].sort(),
    idempotency: input.idempotency.slice().sort((a, b) => a.nonce.localeCompare(b.nonce)),
  };
}

/** The byte-stable canonical form of a snapshot payload. */
export function canonicalSnapshotForm(payload: SimulationSnapshotPayload): string {
  return canonicalJsonString(payload as unknown as JsonSafe);
}

/** Structural validation of a snapshot payload (never throws; typed result). */
export type SnapshotPayloadValidation =
  | { readonly ok: true; readonly payload: SimulationSnapshotPayload }
  | { readonly ok: false; readonly code: "malformed-payload"; readonly detail: string };

export function validateSnapshotPayload(value: unknown): SnapshotPayloadValidation {
  if (typeof value !== "object" || value === null) {
    return { ok: false, code: "malformed-payload", detail: "payload is not an object" };
  }
  const node = value as Record<string, unknown>;
  const stringFields = ["sessionId", "rngState"] as const;
  for (const field of stringFields) {
    if (typeof node[field] !== "string" || (node[field] as string).length === 0) {
      return { ok: false, code: "malformed-payload", detail: `field ${field} missing or malformed` };
    }
  }
  const numberFields = ["epoch", "tick", "afterEventSeq", "admittedCommandSeq"] as const;
  for (const field of numberFields) {
    if (typeof node[field] !== "number" || !Number.isInteger(node[field]) || (node[field] as number) < 0) {
      return { ok: false, code: "malformed-payload", detail: `field ${field} missing or malformed` };
    }
  }
  if (!Array.isArray(node.pending) || !Array.isArray(node.admittedCommandIds) || !Array.isArray(node.idempotency)) {
    return { ok: false, code: "malformed-payload", detail: "table fields missing" };
  }
  return { ok: true, payload: value as SimulationSnapshotPayload };
}

/** The decoded continuation state a session restores from. */
export interface RestoredContinuation {
  readonly payload: SimulationSnapshotPayload;
  readonly world: WorldState;
}

/** Decodes the payload's world back into a GameIRValue (throws on garbage). */
export function decodeContinuation(payload: SimulationSnapshotPayload): RestoredContinuation {
  return { payload, world: decodeGameIRValue(payload.world) };
}

/**
 * Seals a payload into a content-addressed snapshot artifact: the snapshot
 * id and the state digest are derived from the byte-stable canonical form.
 */
export function sealSnapshot(payload: SimulationSnapshotPayload): SimulationSnapshot {
  const form = canonicalSnapshotForm(payload);
  const digestHex = createHash("sha256").update(form, "utf8").digest("hex");
  const world = decodeGameIRValue(payload.world);
  return {
    snapshotId: asSnapshotId(`snap-${digestHex}`),
    sessionId: payload.sessionId as unknown as SessionId,
    epoch: payload.epoch as unknown as SessionEpoch,
    tick: payload.tick as unknown as Tick,
    afterEventSeq: payload.afterEventSeq,
    stateDigest: worldStateDigest(world),
    form,
    payload,
  };
}

/** Recomputes the digest of a snapshot form (hex, unbranded). */
export function snapshotFormDigest(form: string): Digest {
  return asDigest(createHash("sha256").update(form, "utf8").digest("hex"));
}

/**
 * Verifies a snapshot artifact end-to-end: canonical form re-serialization
 * matches byte-for-byte, the snapshot id matches the form digest, the state
 * digest matches the decoded world, and the payload decodes. Pure.
 */
export type SnapshotVerification =
  | { readonly ok: true; readonly snapshotId: string }
  | {
      readonly ok: false;
      readonly code: "malformed-artifact" | "form-mismatch" | "id-mismatch" | "state-digest-mismatch";
      readonly detail: string;
    };

export function verifySnapshotArtifact(artifact: SimulationSnapshot): SnapshotVerification {
  const validated = validateSnapshotPayload(artifact.payload);
  if (!validated.ok) {
    return { ok: false, code: "malformed-artifact", detail: validated.detail };
  }
  const reformed = canonicalSnapshotForm(validated.payload);
  if (reformed !== artifact.form) {
    return { ok: false, code: "form-mismatch", detail: "canonical form does not match the payload" };
  }
  const digest = snapshotFormDigest(artifact.form);
  if (artifact.snapshotId !== `snap-${digest}`) {
    return { ok: false, code: "id-mismatch", detail: "snapshot id does not address the canonical form" };
  }
  let world: WorldState;
  try {
    world = decodeGameIRValue(validated.payload.world);
  } catch (error) {
    return { ok: false, code: "malformed-artifact", detail: `world does not decode: ${String(error)}` };
  }
  if (worldStateDigest(world) !== artifact.stateDigest) {
    return { ok: false, code: "state-digest-mismatch", detail: "state digest does not match the world" };
  }
  return { ok: true, snapshotId: artifact.snapshotId };
}
