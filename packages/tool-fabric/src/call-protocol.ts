/**
 * Module role: the canonical Tool Fabric call protocol — the request
 * envelope (call id, idempotency key, deadline, cancellation token,
 * required capabilities), idempotency/deduplication semantics, and the
 * typed outcome union ok | failure | timeout | cancelled, where every
 * variant carries provenance (tool identity + surface version) and nothing
 * else. Pure types, validators and builders only — no IO, no dispatch
 * implementation (that is PL-019).
 *
 * Implements: PL-005 §3.A.2 (tool call protocol); §3.A.5 (provenance hooks,
 * via CallProvenance from provenance.ts).
 */

import type { CapabilityId } from "./capability.ts";
import { validateCapabilityId } from "./capability.ts";
import type { ToolIdentity } from "./descriptor.ts";
import { validateToolIdentity } from "./descriptor.ts";
import type { SurfaceVersion } from "./versioning.ts";
import { formatSurfaceVersion, validateSurfaceVersion } from "./versioning.ts";
import type { CallProvenance } from "./provenance.ts";
import { snapshotRecord } from "./inspect.ts";

/** Unique identifier of a single tool call, assigned by the caller. */
export type CallId = string;

/** Caller-chosen deduplication key (see idempotencyScope for the semantics). */
export type IdempotencyKey = string;

export const CALL_ID_MAX_LENGTH = 128;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** Absolute wall-clock deadline for a call, in epoch milliseconds. */
export interface Deadline {
  readonly atEpochMs: number;
}

export type CancellationReason = "caller-requested" | "fabric-shutdown";

/**
 * Cancellation semantics for a call: the runtime (PL-019) owns the
 * implementation; the contract fixes the shape. `requested` is a snapshot
 * read; `onCancel` registers a listener that fires at most once and returns
 * its own unsubscribe function.
 */
export interface ToolCallCancellation {
  readonly requested: boolean;
  readonly reason?: CancellationReason;
  onCancel(listener: () => void): () => void;
}

export interface ToolCallRequest {
  readonly kind: "tool-call-request";
  readonly callId: CallId;
  readonly tool: ToolIdentity;
  /** The surface version the CONSUMER was built against (mediated against the descriptor). */
  readonly surfaceVersion: SurfaceVersion;
  /** Unvalidated call input; the runtime checks it against the descriptor inputShape. */
  readonly input: unknown;
  /** Capabilities this invocation requires; mediated before dispatch. */
  readonly requiredCapabilities: readonly CapabilityId[];
  readonly idempotencyKey?: IdempotencyKey;
  readonly deadline?: Deadline;
  readonly cancellation?: ToolCallCancellation;
}

export type ToolCallRequestRejectionCode =
  | "tool-call/not-an-object"
  | "tool-call/call-id-missing"
  | "tool-call/call-id-too-long"
  | "tool-call/tool-identity-invalid"
  | "tool-call/surface-version-invalid"
  | "tool-call/required-capabilities-not-an-array"
  | "tool-call/required-capability-entry-invalid"
  | "tool-call/required-capability-duplicate"
  | "tool-call/idempotency-key-invalid"
  | "tool-call/deadline-invalid"
  | "tool-call/cancellation-invalid";

export interface ToolCallRequestRejection {
  readonly code: ToolCallRequestRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type ToolCallRequestValidation =
  | { readonly outcome: "ok"; readonly request: ToolCallRequest }
  | { readonly outcome: "rejected"; readonly rejections: readonly ToolCallRequestRejection[] };

function rejection(code: ToolCallRequestRejectionCode, message: string, path: string): ToolCallRequestRejection {
  return Object.freeze({ code, message, path });
}

/** Validates an untrusted call request envelope. Total; never throws; accumulates problems. */
export function validateToolCallRequest(input: unknown): ToolCallRequestValidation {
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("tool-call/not-an-object", "tool call request must be a non-array object", "")],
    };
  }
  const rejections: ToolCallRequestRejection[] = [];

  let callId: CallId | undefined;
  const rawCallId = record["callId"];
  if (typeof rawCallId !== "string" || rawCallId.length === 0) {
    rejections.push(rejection("tool-call/call-id-missing", "callId must be a non-empty string", "callId"));
  } else if (rawCallId.length > CALL_ID_MAX_LENGTH) {
    rejections.push(rejection("tool-call/call-id-too-long", `callId must be at most ${CALL_ID_MAX_LENGTH} characters`, "callId"));
  } else {
    callId = rawCallId;
  }

  let tool: ToolIdentity | undefined;
  const toolResult = validateToolIdentity(record["tool"], "tool");
  if (toolResult.outcome === "ok") {
    tool = toolResult.identity;
  } else {
    rejections.push(rejection("tool-call/tool-identity-invalid", `tool identity invalid: ${toolResult.rejections.map((item) => item.message).join("; ")}`, "tool"));
  }

  let surfaceVersion: SurfaceVersion | undefined;
  const surfaceResult = validateSurfaceVersion(record["surfaceVersion"]);
  if (surfaceResult.outcome === "ok") {
    surfaceVersion = surfaceResult.version;
  } else {
    rejections.push(rejection("tool-call/surface-version-invalid", `surfaceVersion invalid: ${surfaceResult.rejection.message}`, "surfaceVersion"));
  }

  let requiredCapabilities: readonly CapabilityId[] | undefined;
  const rawRequired = record["requiredCapabilities"];
  if (!Array.isArray(rawRequired)) {
    rejections.push(rejection("tool-call/required-capabilities-not-an-array", "requiredCapabilities must be an array (possibly empty)", "requiredCapabilities"));
  } else {
    const entries: readonly unknown[] = rawRequired;
    const seen = new Set<string>();
    const list: CapabilityId[] = [];
    let valid = true;
    for (let index = 0; index < entries.length; index += 1) {
      const check = validateCapabilityId(entries[index]);
      if (check.outcome === "rejected") {
        valid = false;
        rejections.push(rejection("tool-call/required-capability-entry-invalid", `requiredCapabilities[${index}] invalid: ${check.rejection.message}`, `requiredCapabilities[${index}]`));
        continue;
      }
      if (seen.has(check.capability)) {
        valid = false;
        rejections.push(rejection("tool-call/required-capability-duplicate", `requiredCapabilities[${index}] duplicates an earlier entry`, `requiredCapabilities[${index}]`));
        continue;
      }
      seen.add(check.capability);
      list.push(check.capability);
    }
    if (valid) {
      requiredCapabilities = Object.freeze(list);
    }
  }

  let idempotencyKey: IdempotencyKey | undefined;
  const rawKey = record["idempotencyKey"];
  if (rawKey !== undefined) {
    if (typeof rawKey !== "string" || rawKey.length === 0 || rawKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      rejections.push(rejection("tool-call/idempotency-key-invalid", `idempotencyKey must be a non-empty string of at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`, "idempotencyKey"));
    } else {
      idempotencyKey = rawKey;
    }
  }

  let deadline: Deadline | undefined;
  const rawDeadline = record["deadline"];
  if (rawDeadline !== undefined) {
    const deadlineRecord = snapshotRecord(rawDeadline);
    const atEpochMs = deadlineRecord === null ? undefined : deadlineRecord["atEpochMs"];
    if (typeof atEpochMs !== "number" || !Number.isInteger(atEpochMs) || atEpochMs <= 0) {
      rejections.push(rejection("tool-call/deadline-invalid", "deadline must be { atEpochMs: positive integer } (absolute epoch milliseconds)", "deadline.atEpochMs"));
    } else {
      const normalized: Deadline = { atEpochMs };
      deadline = Object.freeze(normalized);
    }
  }

  let cancellation: ToolCallCancellation | undefined;
  const rawCancellation = record["cancellation"];
  if (rawCancellation !== undefined) {
    const cancellationRecord = snapshotRecord(rawCancellation);
    const requested = cancellationRecord === null ? undefined : cancellationRecord["requested"];
    const onCancel = cancellationRecord === null ? undefined : cancellationRecord["onCancel"];
    const reason = cancellationRecord === null ? undefined : cancellationRecord["reason"];
    const reasonOk = reason === undefined || reason === "caller-requested" || reason === "fabric-shutdown";
    if (typeof requested !== "boolean" || typeof onCancel !== "function" || !reasonOk) {
      rejections.push(rejection("tool-call/cancellation-invalid", "cancellation must be { requested: boolean, onCancel: () => unsubscribe, reason?: CancellationReason }", "cancellation"));
    } else {
      // keep the ORIGINAL object so the live token keeps working after validation
      cancellation = rawCancellation as ToolCallCancellation;
    }
  }

  if (
    rejections.length > 0 ||
    callId === undefined ||
    tool === undefined ||
    surfaceVersion === undefined ||
    requiredCapabilities === undefined
  ) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }

  const request: ToolCallRequest = {
    kind: "tool-call-request",
    callId,
    tool,
    surfaceVersion,
    input: record["input"],
    requiredCapabilities,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(deadline === undefined ? {} : { deadline }),
    ...(cancellation === undefined ? {} : { cancellation }),
  };
  return { outcome: "ok", request: Object.freeze(request) };
}

/**
 * Canonical dedupe scope for a request, or null when the request carries no
 * idempotency key (such calls always execute).
 *
 * Semantics, binding on the runtime (PL-019):
 * - The key is scoped to the tool identity and the MAJOR surface version,
 *   so a key can never dedupe across tools or across incompatible surfaces.
 * - Within a scope, the FIRST completed outcome for a key is authoritative;
 *   replays receive that same outcome instead of executing again.
 * - A replay whose input differs from the first attempt (inputFingerprint
 *   mismatch) is a caller contract violation and MUST fail with the typed
 *   code "tool/idempotency-input-mismatch".
 */
export function idempotencyScope(request: ToolCallRequest): string | null {
  if (request.idempotencyKey === undefined || request.idempotencyKey.length === 0) {
    return null;
  }
  return `${request.tool.namespace}/${request.tool.name}|${request.surfaceVersion.major}|${request.idempotencyKey}`;
}

const FINGERPRINT_MAX_DEPTH = 32;

/**
 * Stable structural fingerprint of a JSON-shaped value; object key order is
 * normalized, so equal-by-structure inputs fingerprint equally. Returns
 * null when the value contains anything JSON cannot represent (functions,
 * symbols, undefined, bigint, maps, sets, class instances) — such inputs
 * are not fingerprint-comparable and the runtime must skip the
 * input-mismatch check for them.
 */
export function inputFingerprint(input: unknown): string | null {
  return fingerprintValue(input, 0);
}

function fingerprintValue(value: unknown, depth: number): string | null {
  if (depth > FINGERPRINT_MAX_DEPTH) {
    return null;
  }
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (Number.isNaN(value)) return "n:nan";
      if (value === Number.POSITIVE_INFINITY) return "n:+inf";
      if (value === Number.NEGATIVE_INFINITY) return "n:-inf";
      return `n:${value}`;
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      return null;
    case "object": {
      if (Array.isArray(value)) {
        const parts: string[] = [];
        for (const item of value) {
          const part = fingerprintValue(item, depth + 1);
          if (part === null) {
            return null;
          }
          parts.push(part);
        }
        return `[${parts.join(",")}]`;
      }
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : `d:${value.toISOString()}`;
      }
      const prototype: object | null = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return null; // class instances / maps / sets / exotics: not fingerprint-comparable
      }
      const record = snapshotRecord(value);
      if (record === null) {
        return null;
      }
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const part = fingerprintValue(record[key], depth + 1);
        if (part === null) {
          return null;
        }
        parts.push(`${JSON.stringify(key)}:${part}`);
      }
      return `{${parts.join(",")}}`;
    }
  }
  return null;
}

/**
 * Converts a relative timeout budget into an absolute Deadline:
 * deadlineFromTimeoutMs(250, 1_000) -> { atEpochMs: 1_250 }. Pure
 * arithmetic; untrusted inputs are integer-validated by the request
 * validator before this runs.
 */
export function deadlineFromTimeoutMs(timeoutMs: number, nowEpochMs: number): Deadline {
  const deadline: Deadline = { atEpochMs: nowEpochMs + timeoutMs };
  return Object.freeze(deadline);
}

export type ToolFailureCode =
  | "tool/capability-refused"
  | "tool/surface-version-mismatch"
  | "tool/idempotency-input-mismatch"
  | "tool/invalid-input"
  | "tool/invalid-request"
  | "tool/execution-failed"
  | "tool/unavailable";

/** One structured input-shape violation, for "tool/invalid-input" failures. */
export interface InputIssue {
  readonly path: string;
  readonly message: string;
}

export interface ToolCallError {
  readonly code: ToolFailureCode;
  readonly message: string;
  /** Present iff code is "tool/capability-refused". */
  readonly missingCapabilities?: readonly CapabilityId[];
  /** Present iff code is "tool/surface-version-mismatch". */
  readonly requestedSurface?: SurfaceVersion;
  /** Present iff code is "tool/surface-version-mismatch". */
  readonly declaredSurface?: SurfaceVersion;
  /** Present for "tool/invalid-input" failures. */
  readonly issues?: readonly InputIssue[];
}

export interface ToolCallOk {
  readonly outcome: "ok";
  readonly callId: CallId;
  readonly provenance: CallProvenance;
  readonly output: unknown;
}

export interface ToolCallFailure {
  readonly outcome: "failure";
  readonly callId: CallId;
  readonly provenance: CallProvenance;
  readonly error: ToolCallError;
}

export interface ToolCallTimeout {
  readonly outcome: "timeout";
  readonly callId: CallId;
  readonly provenance: CallProvenance;
  readonly deadline: Deadline;
}

export interface ToolCallCancelled {
  readonly outcome: "cancelled";
  readonly callId: CallId;
  readonly provenance: CallProvenance;
  readonly cancellation: { readonly reason: CancellationReason };
}

/** The typed outcome union of a tool call through the fabric. */
export type ToolCallOutcome = ToolCallOk | ToolCallFailure | ToolCallTimeout | ToolCallCancelled;

/** Builds an ok outcome. Frozen; carries provenance and nothing else. */
export function okOutcome(callId: CallId, provenance: CallProvenance, output: unknown): ToolCallOk {
  const outcome: ToolCallOk = { outcome: "ok", callId, provenance, output };
  return Object.freeze(outcome);
}

/** Builds a typed-failure outcome. Frozen. */
export function failureOutcome(callId: CallId, provenance: CallProvenance, error: ToolCallError): ToolCallFailure {
  const outcome: ToolCallFailure = { outcome: "failure", callId, provenance, error };
  return Object.freeze(outcome);
}

/** Convenience builder: the §3.A.3 typed capability refusal. */
export function capabilityRefusalOutcome(
  callId: CallId,
  provenance: CallProvenance,
  missing: readonly CapabilityId[],
): ToolCallFailure {
  const missingList = [...new Set<string>(missing)].sort();
  const error: ToolCallError = {
    code: "tool/capability-refused",
    message: `required capabilities not granted: ${missingList.join(", ")}`,
    missingCapabilities: Object.freeze(missingList),
  };
  return failureOutcome(callId, provenance, Object.freeze(error));
}

/** Convenience builder: the §3.A.4 typed surface-version mismatch. */
export function surfaceMismatchOutcome(
  callId: CallId,
  provenance: CallProvenance,
  requested: SurfaceVersion,
  declared: SurfaceVersion,
): ToolCallFailure {
  const error: ToolCallError = {
    code: "tool/surface-version-mismatch",
    message: `consumer requires surface ${formatSurfaceVersion(requested)} but the tool declares ${formatSurfaceVersion(declared)}; majors are never auto-coerced`,
    requestedSurface: requested,
    declaredSurface: declared,
  };
  return failureOutcome(callId, provenance, Object.freeze(error));
}

/** Builds a  * timeout outcome for a call whose deadline expired. The expired deadline is
 * echoed verbatim so the caller can reconcile it against its own clock.
 */
export function timeoutOutcome(
  callId: CallId,
  provenance: CallProvenance,
  deadline: Deadline,
): ToolCallTimeout {
  const outcome: ToolCallTimeout = { outcome: "timeout", callId, provenance, deadline };
  return Object.freeze(outcome);
}

/**
 * Builds a cancelled outcome. `reason` is required — the fabric never
 * invents a cancellation reason.
 */
export function cancelledOutcome(
  callId: CallId,
  provenance: CallProvenance,
  reason: CancellationReason,
): ToolCallCancelled {
  const outcome: ToolCallCancelled = {
    outcome: "cancelled",
    callId,
    provenance,
    cancellation: Object.freeze({ reason }),
  };
  return Object.freeze(outcome);
}

const OUTCOME_KINDS: ReadonlySet<string> = new Set(["ok", "failure", "timeout", "cancelled"]);

/**
 * Type guard: recognizes a well-formed ToolCallOutcome-shaped value (one of
 * the four outcome kinds, a non-empty callId, and a provenance object).
 * Total; never throws.
 */
export function isToolCallOutcome(value: unknown): value is ToolCallOutcome {
  const record = snapshotRecord(value);
  if (record === null) {
    return false;
  }
  const outcomeKind = record["outcome"];
  if (typeof outcomeKind !== "string" || !OUTCOME_KINDS.has(outcomeKind)) {
    return false;
  }
  const callId = record["callId"];
  if (typeof callId !== "string" || callId.length === 0) {
    return false;
  }
  return snapshotRecord(record["provenance"]) !== null;
}
