/**
 * Module role: the typed payload exchange between GameOS and an adapter —
 * command dispatch in, authoritative outcome out. Results are authoritative
 * ONLY when they carry an AdapterAuthority stamped by the adapter; the
 * contract provides a total client-claim check so client-claimed outcomes
 * are never trusted anywhere in the payload tree.
 *
 * Implements: PL-005 §3.B.3 (exchange contracts).
 */

import { validateAdapterCapabilityId, type AdapterCapabilityId } from "./capability.ts";
import { snapshotRecord } from "./inspect.ts";
import type { AdapterId } from "./adapter.ts";

export type AdapterCommandId = string;
export const ADAPTER_COMMAND_ID_MAX_LENGTH = 128;

export interface AdapterCommandDeadline {
  readonly atEpochMs: number;
}

export interface AdapterCommandDispatch {
  readonly kind: "adapter-command-dispatch";
  readonly commandId: AdapterCommandId;
  readonly capability: AdapterCapabilityId;
  readonly payload: unknown;
  readonly deadline?: AdapterCommandDeadline;
}

export type DispatchRejectionCode =
  | "exchange/dispatch-not-an-object"
  | "exchange/dispatch-kind"
  | "exchange/command-id-missing"
  | "exchange/command-id-too-long"
  | "exchange/capability-invalid"
  | "exchange/deadline-invalid";

export interface DispatchRejection {
  readonly code: DispatchRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type AdapterCommandDispatchValidation =
  | { readonly outcome: "ok"; readonly dispatch: AdapterCommandDispatch }
  | { readonly outcome: "rejected"; readonly rejections: readonly DispatchRejection[] };

function dispatchRejection(code: DispatchRejectionCode, message: string, path: string): DispatchRejection {
  return Object.freeze({ code, message, path });
}

/**
 * Validates an untrusted command dispatch. Total; never throws; accumulates
 * every problem; normalizes to a frozen dispatch (unknown keys dropped).
 */
export function validateAdapterCommandDispatch(input: unknown): AdapterCommandDispatchValidation {
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [
        dispatchRejection("exchange/dispatch-not-an-object", "adapter command dispatch must be a non-array object", ""),
      ],
    };
  }
  const rejections: DispatchRejection[] = [];

  if (record["kind"] !== "adapter-command-dispatch") {
    rejections.push(dispatchRejection("exchange/dispatch-kind", 'dispatch kind must be the literal "adapter-command-dispatch"', "kind"));
  }

  let commandId: AdapterCommandId | undefined;
  const rawCommandId = record["commandId"];
  if (typeof rawCommandId !== "string" || rawCommandId.length === 0) {
    rejections.push(dispatchRejection("exchange/command-id-missing", "commandId must be a non-empty string", "commandId"));
  } else if (rawCommandId.length > ADAPTER_COMMAND_ID_MAX_LENGTH) {
    rejections.push(dispatchRejection("exchange/command-id-too-long", `commandId must be at most ${ADAPTER_COMMAND_ID_MAX_LENGTH} characters`, "commandId"));
  } else {
    commandId = rawCommandId;
  }

  let capability: AdapterCapabilityId | undefined;
  const capabilityCheck = validateAdapterCapabilityId(record["capability"]);
  if (capabilityCheck.outcome === "ok") {
    capability = capabilityCheck.capability;
  } else {
    rejections.push(dispatchRejection("exchange/capability-invalid", `capability invalid: ${capabilityCheck.rejection.message}`, "capability"));
  }

  let deadline: AdapterCommandDeadline | undefined;
  const rawDeadline = record["deadline"];
  if (rawDeadline !== undefined) {
    const deadlineRecord = snapshotRecord(rawDeadline);
    const atEpochMs = deadlineRecord === null ? undefined : deadlineRecord["atEpochMs"];
    if (typeof atEpochMs !== "number" || !Number.isInteger(atEpochMs) || atEpochMs <= 0) {
      rejections.push(dispatchRejection("exchange/deadline-invalid", "deadline must be { atEpochMs: positive integer }", "deadline.atEpochMs"));
    } else {
      const normalized: AdapterCommandDeadline = { atEpochMs };
      deadline = Object.freeze(normalized);
    }
  }

  if (rejections.length > 0 || commandId === undefined || capability === undefined) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }

  const dispatch: AdapterCommandDispatch = {
    kind: "adapter-command-dispatch",
    commandId,
    capability,
    payload: record["payload"],
    ...(deadline === undefined ? {} : { deadline }),
  };
  return { outcome: "ok", dispatch: Object.freeze(dispatch) };
}

/** Authoritative authorship stamp: only adapters produce these. */
export interface AdapterAuthority {
  readonly kind: "adapter-authority";
  readonly adapterId: AdapterId;
  readonly finishedAt: number;
}

export interface AdapterCommandOk {
  readonly outcome: "ok";
  readonly authority: AdapterAuthority;
  readonly value: unknown;
}

export type AdapterCommandRefusalCode =
  | "adapter/invalid-dispatch"
  | "adapter/not-ready"
  | "adapter/closed"
  | "adapter/degraded"
  | "adapter-capability/not-declared";

export interface AdapterCommandRefusal {
  readonly code: AdapterCommandRefusalCode;
  readonly message: string;
  /** Present iff code is "adapter-capability/not-declared". */
  readonly capability?: AdapterCapabilityId;
}

export interface AdapterCommandRefused {
  readonly outcome: "refused";
  readonly authority: AdapterAuthority;
  readonly refusal: AdapterCommandRefusal;
}

export interface AdapterCommandError {
  /** Adapter-defined, provider-neutral code. */
  readonly code: string;
  readonly message: string;
}

export interface AdapterCommandFailed {
  readonly outcome: "failed";
  readonly authority: AdapterAuthority;
  readonly error: AdapterCommandError;
}

export type AdapterCommandResult = AdapterCommandOk | AdapterCommandRefused | AdapterCommandFailed;

export function adapterAuthority(adapterId: AdapterId, finishedAt: number): AdapterAuthority {
  const authority: AdapterAuthority = { kind: "adapter-authority", adapterId, finishedAt };
  return Object.freeze(authority);
}

export function okCommandResult(authority: AdapterAuthority, value: unknown): AdapterCommandOk {
  const result: AdapterCommandOk = { outcome: "ok", authority, value };
  return Object.freeze(result);
}

export function refusedCommandResult(
  authority: AdapterAuthority,
  refusal: AdapterCommandRefusal,
): AdapterCommandRefused {
  const result: AdapterCommandRefused = { outcome: "refused", authority, refusal };
  return Object.freeze(result);
}

export function failedCommandResult(
  authority: AdapterAuthority,
  error: AdapterCommandError,
): AdapterCommandFailed {
  const result: AdapterCommandFailed = { outcome: "failed", authority, error };
  return Object.freeze(result);
}

/**
 * Marker shape produced by untrusted clients attempting to speak for the
 * adapter. The fabric NEVER treats these as authoritative; any occurrence
 * anywhere in a payload tree is a typed refusal.
 */
export interface ClientClaimedOutcome {
  readonly clientClaimed: true;
  readonly claimedOutcome: "ok" | "failed";
  readonly claimedValue?: unknown;
}

/** Recognizes the client-claim marker shape. Total; never throws. */
export function isClientClaimedOutcome(value: unknown): value is ClientClaimedOutcome {
  const record = snapshotRecord(value);
  if (record === null) {
    return false;
  }
  return (
    record["clientClaimed"] === true &&
    (record["claimedOutcome"] === "ok" || record["claimedOutcome"] === "failed")
  );
}

const CLAIM_SCAN_MAX_DEPTH = 32;

function scanForClientClaim(value: unknown, depth: number): boolean {
  if (depth > CLAIM_SCAN_MAX_DEPTH) {
    return false;
  }
  if (isClientClaimedOutcome(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => scanForClientClaim(item, depth + 1));
  }
  const record = snapshotRecord(value);
  if (record === null) {
    return false;
  }
  return Object.keys(record).some((key) => scanForClientClaim(record[key], depth + 1));
}

/**
 * Deep (bounded) scan for client-claim markers anywhere in a payload tree.
 * Total; never throws.
 */
export function containsClientClaim(value: unknown): boolean {
  return scanForClientClaim(value, 0);
}

export interface ClientClaimRefusal {
  readonly code: "exchange/client-claim";
  readonly message: string;
}

export type ClientClaimCheck =
  | { readonly outcome: "accepted"; readonly value: unknown }
  | { readonly outcome: "rejected"; readonly refusal: ClientClaimRefusal };

/**
 * The client-claim gate: `accepted` passes the value through untouched;
 * `rejected` means a client-claimed outcome was found (root or nested) and
 * the value must NOT be treated as authoritative.
 */
export function rejectClientClaim(value: unknown): ClientClaimCheck {
  if (containsClientClaim(value)) {
    const refusal: ClientClaimRefusal = {
      code: "exchange/client-claim",
      message: "client-claimed outcomes are never trusted; only adapter-authored results carrying authority are authoritative",
    };
    return { outcome: "rejected", refusal: Object.freeze(refusal) };
  }
  return { outcome: "accepted", value };
}
