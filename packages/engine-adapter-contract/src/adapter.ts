/**
 * Module role: the NEUTRAL adapter interface — the single seam through which
 * provider engines plug into Tool Fabric. Provider-neutral by construction:
 * no engine-specific types, no engine SDK imports, and no engine names in
 * any identifier (enforced by neutrality.test.ts). An adapter declares its
 * offered capabilities at registration (construction); dispatch to an
 * undeclared capability is a typed refusal, never a silent bypass.
 *
 * Implements: PL-005 §3.B.1 (neutral adapter interface).
 */

import type { AdapterCapabilityId } from "./capability.ts";
import type { AdapterLifecycleState, LifecycleTransitionCheck } from "./lifecycle.ts";
import type { AdapterCommandDispatch, AdapterCommandResult } from "./exchange.ts";

export type AdapterId = string;

export const ADAPTER_ID_MAX_LENGTH = 128;
const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

export type AdapterIdRejectionCode =
  | "adapter-id/not-a-string"
  | "adapter-id/empty"
  | "adapter-id/too-long"
  | "adapter-id/format";

export interface AdapterIdRejection {
  readonly code: AdapterIdRejectionCode;
  readonly message: string;
}

export type AdapterIdCheck =
  | { readonly outcome: "ok"; readonly adapterId: AdapterId }
  | { readonly outcome: "rejected"; readonly rejection: AdapterIdRejection };

function adapterIdRejected(code: AdapterIdRejectionCode, message: string): AdapterIdCheck {
  const rejection: AdapterIdRejection = { code, message };
  return { outcome: "rejected", rejection: Object.freeze(rejection) };
}

/** Validates an untrusted adapter id (dotted lowercase slug). Total; never throws. */
export function validateAdapterId(input: unknown): AdapterIdCheck {
  if (typeof input !== "string") {
    return adapterIdRejected("adapter-id/not-a-string", "adapter id must be a string");
  }
  if (input.length === 0) {
    return adapterIdRejected("adapter-id/empty", "adapter id must not be empty");
  }
  if (input.length > ADAPTER_ID_MAX_LENGTH) {
    return adapterIdRejected("adapter-id/too-long", `adapter id must be at most ${ADAPTER_ID_MAX_LENGTH} characters`);
  }
  if (!ADAPTER_ID_PATTERN.test(input)) {
    return adapterIdRejected("adapter-id/format", 'adapter id must be dot-separated lowercase segments starting with a letter, e.g. "fabric.primary"');
  }
  return { outcome: "ok", adapterId: input };
}

/**
 * The single seam. Implementations MUST:
 * - declare offered capabilities at registration and refuse undeclared
 *   dispatch with "adapter-capability/not-declared";
 * - stamp every result with an AdapterAuthority (authoritative outcomes only);
 * - drive lifecycle transitions exclusively through the lifecycle validator.
 */
export interface Adapter {
  readonly id: AdapterId;
  /** Neutral human label. Must not contain engine names. */
  readonly label: string;
  /** Fixed at registration; dispatch is checked against this list. */
  readonly offeredCapabilities: readonly AdapterCapabilityId[];
  /** Current lifecycle state; starts "registered". */
  readonly state: AdapterLifecycleState;
  /** registered → ready (also degraded → ready recovery). */
  markReady(): LifecycleTransitionCheck;
  /** → degraded (from registered or ready). */
  reportDegraded(): LifecycleTransitionCheck;
  /** → closed. Idempotent: re-close returns ok and stays closed. */
  close(): LifecycleTransitionCheck;
  /** Neutral exchange: dispatch a command, await an authoritative result. */
  dispatch(command: AdapterCommandDispatch): Promise<AdapterCommandResult>;
}
