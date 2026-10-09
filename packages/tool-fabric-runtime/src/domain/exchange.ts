/**
 * Module role: the fabric exchange guard — content-addressed artifact
 * references (E7 spirit) and the total, never-throwing scans that keep raw
 * bytes out of the tool-call exchange. Inline binary payloads anywhere in a
 * payload tree are reported with a typed finding at a deterministic path;
 * artifact-ref-shaped nodes must be well-formed (digest + size). Pure data
 * and pure functions only: no IO, no imports beyond the shared snapshot
 * helper below (mirrors the sibling inspect.ts convention).
 *
 * Implements: PL-019 exchange handling — artifact in/out by content-addressed
 * reference, never inline bytes.
 */

/** Content digest of a stored artifact (hex-encoded sha256). */
export type ArtifactDigest = string;

export const ARTIFACT_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const ARTIFACT_MAX_BYTES = 2 ** 31 - 1;

/** A reference to an artifact stored in the content-addressed exchange. */
export interface ArtifactRef {
  readonly kind: "artifact-ref";
  readonly digest: ArtifactDigest;
  /** Declared byte size; the exchange verifies the content against it. */
  readonly bytes: number;
}

export type ArtifactRefRejectionCode =
  | "artifact-ref/not-an-object"
  | "artifact-ref/kind-invalid"
  | "artifact-ref/digest-invalid"
  | "artifact-ref/size-invalid";

export interface ArtifactRefRejection {
  readonly code: ArtifactRefRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type ArtifactRefValidation =
  | { readonly outcome: "ok"; readonly ref: ArtifactRef }
  | { readonly outcome: "rejected"; readonly rejections: readonly ArtifactRefRejection[] };

function artifactRejection(code: ArtifactRefRejectionCode, message: string, path: string): ArtifactRefRejection {
  return Object.freeze({ code, message, path });
}

/** Validates an untrusted artifact reference. Total; never throws. */
export function validateArtifactRef(input: unknown, path = "artifact"): ArtifactRefValidation {
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [artifactRejection("artifact-ref/not-an-object", "artifact reference must be a non-array object", path)],
    };
  }
  const rejections: ArtifactRefRejection[] = [];

  if (record["kind"] !== "artifact-ref") {
    rejections.push(artifactRejection("artifact-ref/kind-invalid", 'artifact reference kind must be the literal "artifact-ref"', `${path}.kind`));
  }

  const digest = record["digest"];
  if (typeof digest !== "string" || !ARTIFACT_DIGEST_PATTERN.test(digest)) {
    rejections.push(artifactRejection("artifact-ref/digest-invalid", "digest must be 64 lowercase hex characters (sha256)", `${path}.digest`));
  }

  const bytes = record["bytes"];
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0 || bytes > ARTIFACT_MAX_BYTES) {
    rejections.push(artifactRejection("artifact-ref/size-invalid", "bytes must be a positive integer size", `${path}.bytes`));
  }

  if (rejections.length > 0 || typeof digest !== "string") {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }
  const ref: ArtifactRef = { kind: "artifact-ref", digest, bytes: bytes as number };
  return { outcome: "ok", ref: Object.freeze(ref) };
}

export type ExchangeViolationCode = "exchange/inline-bytes" | "exchange/invalid-artifact-ref";

/** One typed exchange violation found by the payload scan. */
export interface ExchangeViolation {
  readonly code: ExchangeViolationCode;
  readonly path: string;
  readonly message: string;
}

const EXCHANGE_SCAN_MAX_DEPTH = 32;

function isInlineBinary(value: unknown): boolean {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof DataView)
    );
  } catch {
    return false;
  }
}

/**
 * Deterministic, bounded scan of a payload tree for exchange violations:
 * inline binary nodes (bytes that must live in the content-addressed store,
 * never inline in the exchange) and malformed artifact-ref nodes. Returns
 * the FIRST violation in deterministic order (array index order, object key
 * order sorted) or null. Total; never throws, even on hostile objects.
 */
export function findExchangeViolation(value: unknown): ExchangeViolation | null {
  return scanValue(value, 0, "value");
}

function scanValue(value: unknown, depth: number, path: string): ExchangeViolation | null {
  if (depth > EXCHANGE_SCAN_MAX_DEPTH) {
    return null;
  }
  if (isInlineBinary(value)) {
    return {
      code: "exchange/inline-bytes",
      path,
      message: "inline binary payloads are not allowed in the exchange; artifacts flow by content-addressed reference (E7)",
    };
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const finding = scanValue(value[index], depth + 1, `${path}[${index}]`);
      if (finding !== null) {
        return finding;
      }
    }
    return null;
  }
  const record = snapshotRecord(value);
  if (record === null) {
    return null;
  }
  if (record["kind"] === "artifact-ref") {
    const check = validateArtifactRef(value, path);
    if (check.outcome === "rejected") {
      return {
        code: "exchange/invalid-artifact-ref",
        path,
        message: `malformed artifact reference at ${path}: ${check.rejections.map((item) => item.message).join("; ")}`,
      };
    }
    return null;
  }
  for (const key of Object.keys(record).sort()) {
    const finding = scanValue(record[key], depth + 1, `${path}.${key}`);
    if (finding !== null) {
      return finding;
    }
  }
  return null;
}

/** An artifact reference located at a deterministic path in a payload tree. */
export interface LocatedArtifactRef {
  readonly ref: ArtifactRef;
  readonly path: string;
}

/**
 * Collects every WELL-FORMED artifact reference in a payload tree, in
 * deterministic order (depth-first; array index order; object keys sorted),
 * deduplicated by digest (first occurrence wins). Malformed artifact-ref
 * nodes are the job of findExchangeViolation, not this collector. Total;
 * never throws.
 */
export function collectArtifactRefs(value: unknown): readonly LocatedArtifactRef[] {
  const located: LocatedArtifactRef[] = [];
  const seen = new Set<ArtifactDigest>();
  collectValue(value, 0, "value", located, seen);
  return Object.freeze(located);
}

function collectValue(value: unknown, depth: number, path: string, located: LocatedArtifactRef[], seen: Set<ArtifactDigest>): void {
  if (depth > EXCHANGE_SCAN_MAX_DEPTH) {
    return;
  }
  if (typeof value === "object" && value !== null) {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof DataView) {
      return;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        collectValue(value[index], depth + 1, `${path}[${index}]`, located, seen);
      }
      return;
    }
    const record = snapshotRecord(value);
    if (record === null) {
      return;
    }
    if (record["kind"] === "artifact-ref") {
      const check = validateArtifactRef(value, path);
      if (check.outcome === "ok" && !seen.has(check.ref.digest)) {
        seen.add(check.ref.digest);
        located.push({ ref: check.ref, path });
      }
      return;
    }
    for (const key of Object.keys(record).sort()) {
      collectValue(record[key], depth + 1, `${path}.${key}`, located, seen);
    }
  }
}

/**
 * Plain own-enumerable snapshot of `input`, or null when `input` is not a
 * readable, non-array object. Unreadable properties degrade to "absent", so
 * scans built on snapshots can never throw. (Local twin of the sibling
 * packages' internal inspect helper — deliberately not imported across
 * packages because it is not part of any public surface.)
 */
function snapshotRecord(input: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  try {
    const snapshot: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      try {
        snapshot[key] = (input as Record<string, unknown>)[key];
      } catch {
        /* unreadable property — treated as absent */
      }
    }
    return snapshot;
  } catch {
    return null;
  }
}
