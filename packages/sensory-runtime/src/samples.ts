/**
 * THE SENSORY SAMPLE MODEL (PL-027) — typed, per-channel records that
 * REFINE (never re-declare) avatar-runtime's `SensorSample` (PL-026).
 *
 * avatar-runtime owns the AVATAR VOCABULARY: `AvatarSensorChannel`
 * (capability + channel id) and the untyped `SensorSample {channel,
 * tick, payload: unknown}` polled through `SensorInputPort.poll()`.
 * This package — the simulation/lab runtime host of sensor EXECUTION —
 * owns the EXECUTION-TIME record: what one admitted frame on a channel
 * looks like once a codec has validated and normalized it:
 *
 * - `channel` — matches an `AvatarSensorChannel.channel` of the composed
 *   avatar (the perception seam projects this back to a plain
 *   `SensorSample`, so the PL-026 driver consumes it unmodified);
 * - `capability` — the frozen game-contracts `SensorCapabilityId` the
 *   channel was declared under (NEVER invented here — game-contracts is
 *   the vocabulary authority);
 * - `payload` — a channel-appropriate TYPED shape (visual field sample,
 *   audio frame, tactile array, olfactory/gustatory intensity vector,
 *   proprioceptive state, vestibular frame), validated by total
 *   functions with kebab-case typed rejection codes;
 * - `contentDigest` — the sample's content address over game-ir's
 *   canonical value form (the kernel's digest authority, E9);
 * - `epoch` — the session epoch the frame was produced under.
 *
 * Payload discipline: every payload is a plain JSON-shaped record.
 * Validation is total (never throws, never `any`); malformed payloads
 * are typed refusals consumed by the codecs (codec.ts).
 *
 * Pure module: data types + structural guards only. No IO, no clock, no
 * randomness (E3/E9).
 */

import type { SensorCapabilityId } from "@playliquid/game-contracts";
import type { Digest, SessionEpoch, Tick } from "@playliquid/runtime-contracts";

// ---------------------------------------------------------------------------
// Typed payload shapes (one per frozen sensor capability)
// ---------------------------------------------------------------------------

/**
 * Vision payload: a down-sampled visual field sample. `cells` is a
 * row-major grid of normalized luminance values in [0,1] (NaN/Infinity
 * refused); `width * height === cells.length` is a structural invariant.
 */
export interface VisualFieldSample {
  readonly kind: "visual-field";
  readonly width: number;
  readonly height: number;
  readonly cells: readonly number[];
}

/** Audio payload: one frame of channel energy in normalized [0,1]. */
export interface AudioFrameSample {
  readonly kind: "audio-frame";
  /** Frame sequence within the channel (monotonic per producer). */
  readonly frame: number;
  readonly level: number;
}

/**
 * Touch payload: a rectangular array of normalized pressure readings in
 * [0,1]; `rows * columns === pressures.length` is a structural invariant.
 */
export interface TactileArraySample {
  readonly kind: "tactile-array";
  readonly rows: number;
  readonly columns: number;
  readonly pressures: readonly number[];
}

/**
 * Olfactory payload: an intensity vector over named odorants. Each
 * intensity is normalized [0,1]; odorant ids are non-empty distinct
 * keys; entries are ordered by first declaration (order is semantic).
 */
export interface OlfactoryIntensitySample {
  readonly kind: "olfactory-intensity";
  readonly entries: readonly { readonly odorant: string; readonly intensity: number }[];
}

/**
 * Gustatory payload: an intensity vector over named tastes. Same
 * normalization and distinctness rules as olfactory.
 */
export interface GustatoryIntensitySample {
  readonly kind: "gustatory-intensity";
  readonly entries: readonly { readonly taste: string; readonly intensity: number }[];
}

/**
 * Proprioceptive payload: the body's joint-state snapshot. Angles are
 * degrees in [-360, 360]; positions are arbitrary finite floats;
 * `joints.length === positions.length` is a structural invariant.
 */
export interface ProprioceptiveStateSample {
  readonly kind: "proprioceptive-state";
  readonly joints: readonly string[];
  readonly angles: readonly number[];
  readonly positions: readonly number[];
}

/**
 * Vestibular payload: one frame of the body's inertial state. Linear
 * acceleration and angular velocity are finite floats (units are the
 * producer's declaration; the codec only enforces finiteness).
 */
export interface VestibularFrameSample {
  readonly kind: "vestibular-frame";
  readonly linearAcceleration: readonly [number, number, number];
  readonly angularVelocity: readonly [number, number, number];
}

/** The closed payload union — exactly one shape per frozen capability. */
export type SensoryPayload =
  | VisualFieldSample
  | AudioFrameSample
  | TactileArraySample
  | OlfactoryIntensitySample
  | GustatoryIntensitySample
  | ProprioceptiveStateSample
  | VestibularFrameSample;

/** The payload discriminator each shape carries (`kind`). */
export type SensoryPayloadKind = SensoryPayload["kind"];

/** Every payload kind, in frozen vocabulary order. */
export const SENSORY_PAYLOAD_KINDS: readonly SensoryPayloadKind[] = Object.freeze([
  "visual-field",
  "audio-frame",
  "tactile-array",
  "olfactory-intensity",
  "gustatory-intensity",
  "proprioceptive-state",
  "vestibular-frame",
]);

// ---------------------------------------------------------------------------
// The refined sample record
// ---------------------------------------------------------------------------

/**
 * One ADMITTED sensory sample (post-codec): the execution-time record
 * this runtime appends to its history and projects onto avatar-runtime's
 * `SensorSample` seam. Refines — never re-declares — the avatar
 * vocabulary: `channel` keeps the avatar-runtime spelling, the payload
 * is the validated typed shape.
 */
export interface SensorySample {
  /** Channel id matching an `AvatarSensorChannel.channel` of the body. */
  readonly channel: string;
  /** Frozen sensor capability the channel was declared under. */
  readonly capability: SensorCapabilityId;
  /** Validated typed payload (codec-admitted). */
  readonly payload: SensoryPayload;
  /** Content address over the canonical value form (E9/E10). */
  readonly contentDigest: Digest;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
}

// ---------------------------------------------------------------------------
// Structural guards (total; never throw)
// ---------------------------------------------------------------------------

/** True iff `n` is a finite number (NaN/±Infinity refused). */
export function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** True iff `n` is a finite number in the closed interval [min, max]. */
export function isFiniteNumberInRange(n: unknown, min: number, max: number): n is number {
  return isFiniteNumber(n) && n >= min && n <= max;
}

/** True iff `n` is a safe integer in the closed interval [min, max]. */
export function isIntegerInRange(n: unknown, min: number, max: number): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function isDistinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** True iff `value` is structurally a valid {@link VisualFieldSample}. */
export function isVisualFieldSample(value: unknown): value is VisualFieldSample {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.kind !== "visual-field") return false;
  if (!isIntegerInRange(node.width, 1, 1024)) return false;
  if (!isIntegerInRange(node.height, 1, 1024)) return false;
  if (!Array.isArray(node.cells)) return false;
  if (node.cells.length !== (node.width as number) * (node.height as number)) return false;
  return node.cells.every((cell) => isFiniteNumberInRange(cell, 0, 1));
}

/** True iff `value` is structurally a valid {@link AudioFrameSample}. */
export function isAudioFrameSample(value: unknown): value is AudioFrameSample {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.kind !== "audio-frame") return false;
  if (!isIntegerInRange(node.frame, 0, Number.MAX_SAFE_INTEGER)) return false;
  return isFiniteNumberInRange(node.level, 0, 1);
}

/** True iff `value` is structurally a valid {@link TactileArraySample}. */
export function isTactileArraySample(value: unknown): value is TactileArraySample {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.kind !== "tactile-array") return false;
  if (!isIntegerInRange(node.rows, 1, 1024)) return false;
  if (!isIntegerInRange(node.columns, 1, 1024)) return false;
  if (!Array.isArray(node.pressures)) return false;
  if (node.pressures.length !== (node.rows as number) * (node.columns as number)) return false;
  return node.pressures.every((pressure) => isFiniteNumberInRange(pressure, 0, 1));
}

/** True iff `value` is structurally a valid {@link OlfactoryIntensitySample}. */
export function isOlfactoryIntensitySample(value: unknown): value is OlfactoryIntensitySample {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.kind !== "olfactory-intensity") return false;
  if (!Array.isArray(node.entries) || node.entries.length === 0) return false;
  if (node.entries.length > 256) return false;
  const odorants: string[] = [];
  for (const entry of node.entries) {
    if (typeof entry !== "object" || entry === null) return false;
    const pair = entry as Record<string, unknown>;
    if (typeof pair.odorant !== "string" || pair.odorant.length === 0) return false;
    if (!isFiniteNumberInRange(pair.intensity, 0, 1)) return false;
    odorants.push(pair.odorant);
  }
  return isDistinct(odorants);
}

/** True iff `value` is structurally a valid {@link GustatoryIntensitySample}. */
export function isGustatoryIntensitySample(value: unknown): value is GustatoryIntensitySample {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.kind !== "gustatory-intensity") return false;
  if (!Array.isArray(node.entries) || node.entries.length === 0) return false;
  if (node.entries.length > 256) return false;
  const tastes: string[] = [];
  for (const entry of node.entries) {
    if (typeof entry !== "object" || entry === null) return false;
    const pair = entry as Record<string, unknown>;
    if (typeof pair.taste !== "string" || pair.taste.length === 0) return false;
    if (!isFiniteNumberInRange(pair.intensity, 0, 1)) return false;
    tastes.push(pair.taste);
  }
  return isDistinct(tastes);
}

/** True iff `value` is structurally a valid {@link ProprioceptiveStateSample}. */
export function isProprioceptiveStateSample(value: unknown): value is ProprioceptiveStateSample {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.kind !== "proprioceptive-state") return false;
  if (!isStringArray(node.joints) || node.joints.length === 0) return false;
  if (node.joints.length > 256) return false;
  if (!isDistinct(node.joints as readonly string[])) return false;
  if (!Array.isArray(node.angles) || !Array.isArray(node.positions)) return false;
  if ((node.angles as unknown[]).length !== (node.joints as readonly string[]).length) return false;
  if ((node.positions as unknown[]).length !== (node.joints as readonly string[]).length) return false;
  if (!(node.angles as readonly unknown[]).every((angle) => isFiniteNumberInRange(angle, -360, 360))) {
    return false;
  }
  return (node.positions as readonly unknown[]).every((position) => isFiniteNumber(position));
}

/** True iff `value` is structurally a valid {@link VestibularFrameSample}. */
export function isVestibularFrameSample(value: unknown): value is VestibularFrameSample {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.kind !== "vestibular-frame") return false;
  for (const field of ["linearAcceleration", "angularVelocity"] as const) {
    const vector = node[field];
    if (!Array.isArray(vector) || vector.length !== 3) return false;
    if (!vector.every((component) => isFiniteNumber(component))) return false;
  }
  return true;
}

/** True iff `value` is any structurally valid {@link SensoryPayload}. */
export function isSensoryPayload(value: unknown): value is SensoryPayload {
  return (
    isVisualFieldSample(value) ||
    isAudioFrameSample(value) ||
    isTactileArraySample(value) ||
    isOlfactoryIntensitySample(value) ||
    isGustatoryIntensitySample(value) ||
    isProprioceptiveStateSample(value) ||
    isVestibularFrameSample(value)
  );
}
