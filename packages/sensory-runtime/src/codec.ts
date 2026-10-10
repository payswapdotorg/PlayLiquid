/**
 * CHANNEL CODECS — per-capability validation/admission of raw producer
 * frames into {@link SensorySample}s (PL-027).
 *
 * A codec is a total function from a raw frame (unknown, untrusted
 * producer output) to a typed admission result. It performs:
 *
 * 1. CHANNEL-CAPABILITY COHERENCE: a `vision` capability channel cannot
 *    emit audio payloads — the payload's `kind` must be the one shape
 *    bound to the channel's frozen capability (`capability-payload-
 *    mismatch` refusal). This binding is total over the frozen
 *    vocabulary: every `SensorCapabilityId` has exactly one payload
 *    shape and one expected `kind` tag.
 * 2. RANGE CHECKS + NORMALIZATION INVARIANTS: payload-structure guards
 *    from samples.ts (grid arity, normalized [0,1] intensities, finite
 *    vectors, distinct odorants/tastes/joints) — every violation is a
 *    kebab-case typed refusal, never a throw.
 * 3. CONTENT DIGEST: the admitted payload is content-addressed through
 *    the game-ir canonical form (digest.ts — E9).
 *
 * Malformed input refusal codes are kebab-case and typed
 * (`CodecRefusalCode`); the codec NEVER throws and never returns
 * partially-normalized data.
 *
 * Pure module: no IO, no clock, no randomness (E3/E9).
 */

import { SENSOR_CAPABILITY_IDS } from "@playliquid/game-contracts";
import type { SensorCapabilityId } from "@playliquid/game-contracts";
import { asDigest } from "@playliquid/runtime-contracts";
import type { Digest, SessionEpoch, Tick } from "@playliquid/runtime-contracts";
import { payloadContentDigest } from "./digest.ts";
import type {
  AudioFrameSample,
  GustatoryIntensitySample,
  OlfactoryIntensitySample,
  ProprioceptiveStateSample,
  SensoryPayload,
  TactileArraySample,
  VestibularFrameSample,
  VisualFieldSample,
} from "./samples.ts";
import {
  isAudioFrameSample,
  isGustatoryIntensitySample,
  isOlfactoryIntensitySample,
  isProprioceptiveStateSample,
  isTactileArraySample,
  isVestibularFrameSample,
  isVisualFieldSample,
} from "./samples.ts";

// ---------------------------------------------------------------------------
// Admission result + refusal codes
// ---------------------------------------------------------------------------

/** Typed codec admission: a fully-formed {@link SensorySample}. */
export type CodecAdmission =
  | {
      readonly ok: true;
      readonly sample: import("./samples.ts").SensorySample;
    }
  | {
      readonly ok: false;
      readonly code: CodecRefusalCode;
      readonly detail: string;
    };

/** Kebab-case typed refusal codes (never a throw, never `any`). */
export type CodecRefusalCode =
  | "invalid-channel"
  | "invalid-capability"
  | "invalid-tick"
  | "invalid-epoch"
  | "malformed-payload"
  | "capability-payload-mismatch";

/** The frozen capability -> payload-kind binding (total). */
const CAPABILITY_KIND_BINDING: Readonly<Record<SensorCapabilityId, SensoryPayload["kind"]>> = Object.freeze({
  vision: "visual-field",
  audio: "audio-frame",
  touch: "tactile-array",
  smell: "olfactory-intensity",
  taste: "gustatory-intensity",
  proprioception: "proprioceptive-state",
  vestibular: "vestibular-frame",
});

/**
 * The one payload `kind` bound to a frozen capability. Undefined for
 * unknown capabilities (game-contracts is the vocabulary authority —
 * this package invents nothing).
 */
export function expectedPayloadKind(capability: string): SensoryPayload["kind"] | undefined {
  return (CAPABILITY_KIND_BINDING as Record<string, SensoryPayload["kind"] | undefined>)[capability];
}

// ---------------------------------------------------------------------------
// The codec
// ---------------------------------------------------------------------------

/** A raw producer frame awaiting admission. */
export interface RawProducerFrame {
  readonly channel: unknown;
  readonly capability: unknown;
  readonly payload: unknown;
  readonly epoch: unknown;
  readonly tick: unknown;
}

const CHANNEL_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

/**
 * Admit one raw frame as a typed {@link SensorySample}. Total: any
 * input, either a sample or a typed refusal; never throws.
 *
 * @param frame the raw producer frame (untrusted).
 * @param context the epoch the frame is being admitted under.
 */
export function admitFrame(
  frame: RawProducerFrame | null | undefined,
  context: { readonly epoch: SessionEpoch; readonly tick: Tick },
): CodecAdmission {
  if (typeof frame !== "object" || frame === null) {
    return refuse("invalid-channel", "frame is not an object");
  }
  if (typeof frame.channel !== "string" || !CHANNEL_PATTERN.test(frame.channel)) {
    return refuse("invalid-channel", `channel ${JSON.stringify(String(frame.channel))} is not a channel slug`);
  }
  if (typeof frame.capability !== "string" || !(SENSOR_CAPABILITY_IDS as readonly string[]).includes(frame.capability)) {
    return refuse("invalid-capability", `${JSON.stringify(String(frame.capability))} is not a frozen sensor capability`);
  }
  const capability = frame.capability as SensorCapabilityId;
  const tick = Number(frame.tick);
  if (!Number.isSafeInteger(tick) || tick < 0) {
    return refuse("invalid-tick", `tick ${JSON.stringify(String(frame.tick))} is not a non-negative safe integer`);
  }
  const epoch = Number(frame.epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch !== Number(context.epoch)) {
    return refuse("invalid-epoch", `epoch ${JSON.stringify(String(frame.epoch))} must equal the admission epoch`);
  }

  const expectedKind = expectedPayloadKind(capability);
  if (expectedKind === undefined) {
    return refuse("invalid-capability", "capability has no payload binding");
  }
  const kind = typeof frame.payload === "object" && frame.payload !== null
    ? (frame.payload as Record<string, unknown>).kind
    : undefined;
  if (typeof kind !== "string" || kind !== expectedKind) {
    return refuse(
      "capability-payload-mismatch",
      `capability ${capability} binds payload kind ${expectedKind}; got ${JSON.stringify(String(kind))}`,
    );
  }
  const payload = checkPayloadShape(capability, frame.payload);
  if (payload === undefined) {
    return refuse("malformed-payload", `payload for capability ${capability} violates its shape invariants`);
  }

  const contentDigest: Digest = payloadContentDigest(payload);
  return {
    ok: true,
    sample: {
      channel: frame.channel,
      capability,
      payload,
      contentDigest,
      epoch: context.epoch,
      tick: tick as Tick,
    },
  };
}

/** Structural payload validation by capability binding. */
function checkPayloadShape(capability: SensorCapabilityId, payload: unknown): SensoryPayload | undefined {
  switch (capability) {
    case "vision":
      return isVisualFieldSample(payload) ? (payload as VisualFieldSample) : undefined;
    case "audio":
      return isAudioFrameSample(payload) ? (payload as AudioFrameSample) : undefined;
    case "touch":
      return isTactileArraySample(payload) ? (payload as TactileArraySample) : undefined;
    case "smell":
      return isOlfactoryIntensitySample(payload) ? (payload as OlfactoryIntensitySample) : undefined;
    case "taste":
      return isGustatoryIntensitySample(payload) ? (payload as GustatoryIntensitySample) : undefined;
    case "proprioception":
      return isProprioceptiveStateSample(payload) ? (payload as ProprioceptiveStateSample) : undefined;
    case "vestibular":
      return isVestibularFrameSample(payload) ? (payload as VestibularFrameSample) : undefined;
  }
}

function refuse(code: CodecRefusalCode, detail: string): CodecAdmission {
  return { ok: false, code, detail };
}

/**
 * The digest a codec would derive, as a pure projection of an
 * ALREADY-validated payload (used by the history when re-addressing
 * stored content; keeps one digest authority — digest.ts).
 */
export function readdressPayload(payload: SensoryPayload): Digest {
  return asDigest(payloadContentDigest(payload));
}
