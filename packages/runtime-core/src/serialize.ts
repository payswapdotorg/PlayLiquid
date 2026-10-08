/**
 * CANONICAL BYTE-STABLE SERIALIZATION for Interactive Runtime snapshots.
 *
 * Determinism contract (PL-013, requirement E9 "reproducible seeds/locks
 * where feasible"):
 *
 * - `canonicalJson` is a TOTAL function over {@link JsonSafeValue}: the same
 *   value ALWAYS serializes to the same byte sequence. Object keys are
 *   emitted in ascending UTF-16 code-unit order, arrays keep their order,
 *   strings use JSON escaping, and numbers are restricted to SAFE INTEGERS
 *   so no platform float-formatting ambiguity can fork the bytes.
 * - Anything outside the JSON-safe domain (undefined, unsafe integers,
 *   floats, functions, symbols, class instances, maps/sets, sparse holes)
 *   is REJECTED with a typed error. World states that need fractional
 *   values must encode them as scaled integers or strings — a documented,
 *   testable constraint, not a silent platform gamble.
 *
 * Purity: no IO, no randomness, no clock. Encoding and decoding are pure.
 */

/** Typed serialization failure. */
export class CanonicalEncodeError extends Error {
  readonly code: "unsupported-value";
  constructor(detail: string) {
    super(detail);
    this.name = "CanonicalEncodeError";
    this.code = "unsupported-value";
  }
}

/** Typed snapshot-decode failure. */
export class SnapshotDecodeError extends Error {
  readonly code:
    | "malformed-payload"
    | "unsupported-format"
    | "session-mismatch"
    | "world-kind-mismatch";
  constructor(
    code: "malformed-payload" | "unsupported-format" | "session-mismatch" | "world-kind-mismatch",
    detail: string,
  ) {
    super(detail);
    this.name = "SnapshotDecodeError";
    this.code = code;
  }
}

/**
 * The JSON-safe value domain that `canonicalJson` accepts. World states `W`
 * carried by the kernel must be structural subtypes of this type for the
 * byte-stability guarantee to hold.
 */
export type JsonSafeValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonSafeValue[]
  | { readonly [key: string]: JsonSafeValue };

/** Runtime guard for the JSON-safe domain (total, pure). */
export function isJsonSafeValue(value: unknown): value is JsonSafeValue {
  return checkJsonSafe(value) === undefined;
}

function checkJsonSafe(value: unknown): string | undefined {
  if (value === null) return undefined;
  const kind = typeof value;
  if (kind === "boolean" || kind === "string") return undefined;
  if (kind === "number") {
    if (!Number.isSafeInteger(value)) {
      return `number ${String(value)} is not a safe integer`;
    }
    return undefined;
  }
  if (kind !== "object") return `value of type ${kind} is not JSON-safe`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const problem = checkJsonSafe(value[i]);
      if (problem !== undefined) return `array index ${i}: ${problem}`;
    }
    return undefined;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return "object is not a plain record";
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const problem = checkJsonSafe((value as Record<string, unknown>)[key]);
    if (problem !== undefined) return `record key ${JSON.stringify(key)}: ${problem}`;
  }
  return undefined;
}

/**
 * Canonical, byte-stable serialization. Same input value -> same string,
 * always, on every platform. Throws {@link CanonicalEncodeError} on values
 * outside the JSON-safe domain.
 */
export function canonicalJson(value: unknown): string {
  const problem = checkJsonSafe(value);
  if (problem !== undefined) {
    throw new CanonicalEncodeError(problem);
  }
  return encode(value as JsonSafeValue);
}

function encode(value: JsonSafeValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => encode(item));
    return `[${parts.join(",")}]`;
  }
  const record = value as { readonly [key: string]: JsonSafeValue };
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => {
    const item = record[key] as JsonSafeValue;
    return `${JSON.stringify(key)}:${encode(item)}`;
  });
  return `{${parts.join(",")}}`;
}

/** Snapshot payload format identifier (bumped on incompatible changes). */
export const SNAPSHOT_FORMAT = "playliquid.runtime-core.snapshot/1" as const;

/**
 * The exact structure persisted as one kernel snapshot. Field order in the
 * interface is documentation only — `canonicalJson` sorts keys, so the byte
 * layout is fixed by the VALUE, never by construction order.
 */
export interface KernelSnapshotPayload {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly sessionId: string;
  readonly epoch: number;
  readonly tick: number;
  readonly committedEventSeq: number;
  readonly admittedCommandSeq: number;
  readonly worldKind: string;
  readonly world: JsonSafeValue;
  readonly determinism?: string;
}

/** Encode a payload into its canonical bytes (pure). */
export function encodeSnapshotBytes(payload: KernelSnapshotPayload): string {
  return canonicalJson(payload);
}

/**
 * Decode + validate raw parsed payload data against the frozen format and
 * the expected session/world identity. Pure; throws
 * {@link SnapshotDecodeError} on any mismatch.
 */
export function decodeSnapshotPayload(
  raw: unknown,
  expected: { readonly sessionId: string; readonly worldKind: string },
): KernelSnapshotPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SnapshotDecodeError("malformed-payload", "payload is not a plain object");
  }
  const record = raw as Record<string, unknown>;
  if (record["format"] !== SNAPSHOT_FORMAT) {
    throw new SnapshotDecodeError(
      "unsupported-format",
      `expected ${SNAPSHOT_FORMAT}, got ${String(record["format"])}`,
    );
  }
  const numberFields = ["epoch", "tick", "committedEventSeq", "admittedCommandSeq"] as const;
  for (const field of numberFields) {
    if (!Number.isSafeInteger(record[field]) || (record[field] as number) < 0) {
      throw new SnapshotDecodeError("malformed-payload", `field ${field} is not a non-negative integer`);
    }
  }
  if (typeof record["sessionId"] !== "string" || typeof record["worldKind"] !== "string") {
    throw new SnapshotDecodeError("malformed-payload", "sessionId/worldKind must be strings");
  }
  if (record["determinism"] !== undefined && typeof record["determinism"] !== "string") {
    throw new SnapshotDecodeError("malformed-payload", "determinism must be a string when present");
  }
  if (!isJsonSafeValue(record["world"])) {
    throw new SnapshotDecodeError("malformed-payload", "world is not JSON-safe");
  }
  if (record["sessionId"] !== expected.sessionId) {
    throw new SnapshotDecodeError(
      "session-mismatch",
      `payload belongs to session ${String(record["sessionId"])}, kernel holds ${expected.sessionId}`,
    );
  }
  if (record["worldKind"] !== expected.worldKind) {
    throw new SnapshotDecodeError(
      "world-kind-mismatch",
      `payload world kind ${String(record["worldKind"])}, driver provides ${expected.worldKind}`,
    );
  }
  const payload: KernelSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    sessionId: record["sessionId"],
    epoch: record["epoch"] as number,
    tick: record["tick"] as number,
    committedEventSeq: record["committedEventSeq"] as number,
    admittedCommandSeq: record["admittedCommandSeq"] as number,
    worldKind: record["worldKind"],
    world: record["world"] as JsonSafeValue,
    determinism: record["determinism"] as string | undefined,
  };
  return payload;
}
