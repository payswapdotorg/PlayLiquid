/**
 * CONTENT-ADDRESSED SAMPLE DIGESTS (E9/E10 seam) — the canonical-bytes
 * discipline mirrored from game-ir and the community precedent.
 *
 * Each authority hashes at its own seam; this package hashes sample
 * CONTENT through the semantic kernel's own canonicalization
 * (`hashGameIRValue` over `GameIRValue`) — the same value form every
 * GameOS consumer would derive, so a sample's content address is
 * machine-independent and replay-stable (E9). Payload numbers become
 * `float` values (the kernel's canonical float form — NaN, ±Infinity and
 * -0 are handled by the kernel's own frozen rules; the codecs refuse
 * non-finite inputs long before this seam).
 *
 * The sample ENVELOPE content key (tenant, channel, capability, content
 * digest, epoch) is digested by package-system's `computeDigest` over
 * canonical JSON — the content-addressing authority lab-simulation and
 * community already use at their seams. Domain-separation tags keep
 * sensory history keys from colliding with any other package's keys.
 *
 * Pure module: hashing only. No IO, no clock, no randomness.
 */

import { hashGameIRValue } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { TenantId } from "@playliquid/platform-contracts";
import { asDigest } from "@playliquid/runtime-contracts";
import type { Digest, SessionEpoch } from "@playliquid/runtime-contracts";
import type { SensorCapabilityId } from "@playliquid/game-contracts";
import type { SensoryPayload } from "./samples.ts";

/** Domain-separation tag for sensory sample envelope content keys. */
const SAMPLE_KEY_TAG = "playliquid:sensory:sample-key:1";

/** Domain-separation tag for sensory history-record content addresses. */
const HISTORY_RECORD_TAG = "playliquid:sensory:history-record:1";

// ---------------------------------------------------------------------------
// Payload -> canonical value form -> content digest
// ---------------------------------------------------------------------------

function float(value: number): GameIRValue {
  return { kind: "float", value };
}

function text(value: string): GameIRValue {
  return { kind: "string", value };
}

function floats(values: readonly number[]): GameIRValue {
  return { kind: "list", items: values.map(float) };
}

function fields(record: Readonly<Record<string, GameIRValue>>): GameIRValue {
  return { kind: "record", fields: record };
}

/**
 * The canonical GameIR value form of a validated payload. Total over the
 * `SensoryPayload` union; the caller has already codec-validated the
 * payload (guards are upstream).
 */
export function payloadValueForm(payload: SensoryPayload): GameIRValue {
  switch (payload.kind) {
    case "visual-field":
      return fields({
        kind: text(payload.kind),
        width: { kind: "int", value: BigInt(payload.width) },
        height: { kind: "int", value: BigInt(payload.height) },
        cells: floats(payload.cells),
      });
    case "audio-frame":
      return fields({
        kind: text(payload.kind),
        frame: { kind: "int", value: BigInt(payload.frame) },
        level: float(payload.level),
      });
    case "tactile-array":
      return fields({
        kind: text(payload.kind),
        rows: { kind: "int", value: BigInt(payload.rows) },
        columns: { kind: "int", value: BigInt(payload.columns) },
        pressures: floats(payload.pressures),
      });
    case "olfactory-intensity":
      return fields({
        kind: text(payload.kind),
        entries: {
          kind: "list",
          items: payload.entries.map((entry) =>
            fields({ odorant: text(entry.odorant), intensity: float(entry.intensity) }),
          ),
        },
      });
    case "gustatory-intensity":
      return fields({
        kind: text(payload.kind),
        entries: {
          kind: "list",
          items: payload.entries.map((entry) =>
            fields({ taste: text(entry.taste), intensity: float(entry.intensity) }),
          ),
        },
      });
    case "proprioceptive-state":
      return fields({
        kind: text(payload.kind),
        joints: { kind: "list", items: payload.joints.map(text) },
        angles: floats(payload.angles),
        positions: floats(payload.positions),
      });
    case "vestibular-frame":
      return fields({
        kind: text(payload.kind),
        linearAcceleration: floats(payload.linearAcceleration),
        angularVelocity: floats(payload.angularVelocity),
      });
  }
}

/**
 * The content digest of a validated payload: SHA-256 over the kernel's
 * canonical value form (E9 — same payload, same digest, every machine).
 */
export function payloadContentDigest(payload: SensoryPayload): Digest {
  return asDigest(hashGameIRValue(payloadValueForm(payload)));
}

// ---------------------------------------------------------------------------
// Envelope content keys (E10 idempotency)
// ---------------------------------------------------------------------------

/** The identity a sensory sample is content-addressed by. */
export interface SampleContentKeyInput {
  readonly tenant: TenantId;
  readonly channel: string;
  readonly capability: SensorCapabilityId;
  readonly contentDigest: Digest;
  readonly epoch: SessionEpoch;
}

/**
 * The content key of one sensory sample within one tenant's history —
 * the E10 idempotency key: one key, one record; a replayed identical
 * sample returns the recorded receipt, never a second mutation.
 */
export function sampleContentKey(input: SampleContentKeyInput): ContentDigest {
  return computeDigest({
    tag: SAMPLE_KEY_TAG,
    tenant: String(input.tenant),
    channel: input.channel,
    capability: input.capability,
    contentDigest: String(input.contentDigest),
    epoch: Number(input.epoch),
  });
}

/** The content a history record's own id addresses. */
export interface HistoryRecordContentInput {
  readonly tenant: TenantId;
  readonly contentKey: ContentDigest;
  readonly recordedAt: number;
}

/**
 * Deterministic content address of one history record (the record's own
 * tamper-evident id): content key + the recorded-at stamp. The record id
 * changes when either the content or the recording stamp changes; it is
 * stable across replays of the same admission at the same stamp.
 */
export function historyRecordIdOf(input: HistoryRecordContentInput): ContentDigest {
  return computeDigest({
    tag: HISTORY_RECORD_TAG,
    tenant: String(input.tenant),
    contentKey: String(input.contentKey),
    recordedAt: input.recordedAt,
  });
}
