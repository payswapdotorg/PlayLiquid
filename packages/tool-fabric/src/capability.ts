/**
 * Module role: capability mediation contract — the capability identifier
 * grammar, and the pure mediation check that turns an ungranted capability
 * into a typed refusal. The fabric refuses ungranted calls; it never
 * silently bypasses rights and never throws.
 *
 * Implements: PL-005 §3.A.3 (capability mediation).
 */

export type CapabilityId = string;

export type CapabilityIdRejectionCode =
  | "capability-id/not-a-string"
  | "capability-id/empty"
  | "capability-id/too-long"
  | "capability-id/format";

export interface CapabilityIdRejection {
  readonly code: CapabilityIdRejectionCode;
  readonly message: string;
}

export type CapabilityIdCheck =
  | { readonly outcome: "ok"; readonly capability: CapabilityId }
  | { readonly outcome: "rejected"; readonly rejection: CapabilityIdRejection };

const CAPABILITY_ID_MAX_LENGTH = 128;
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

function idRejected(code: CapabilityIdRejectionCode, message: string): CapabilityIdCheck {
  const rejection: CapabilityIdRejection = { code, message };
  return { outcome: "rejected", rejection: Object.freeze(rejection) };
}

/** Validates an untrusted capability id (dot-separated lowercase segments). Total; never throws. */
export function validateCapabilityId(input: unknown): CapabilityIdCheck {
  if (typeof input !== "string") {
    return idRejected("capability-id/not-a-string", "capability id must be a string");
  }
  if (input.length === 0) {
    return idRejected("capability-id/empty", "capability id must not be empty");
  }
  if (input.length > CAPABILITY_ID_MAX_LENGTH) {
    return idRejected("capability-id/too-long", `capability id must be at most ${CAPABILITY_ID_MAX_LENGTH} characters`);
  }
  if (!CAPABILITY_ID_PATTERN.test(input)) {
    return idRejected("capability-id/format", 'capability id must be dot-separated lowercase segments starting with a letter, e.g. "scene.load"');
  }
  return { outcome: "ok", capability: input };
}

export type CapabilityRefusalCode = "capability/not-granted";

export interface CapabilityRefusal {
  readonly kind: "capability-refusal";
  readonly code: CapabilityRefusalCode;
  /** Required capabilities that were NOT granted — sorted, deduplicated. */
  readonly missing: readonly CapabilityId[];
  readonly message: string;
}

export type CapabilityMediation =
  | { readonly outcome: "granted" }
  | { readonly outcome: "refused"; readonly refusal: CapabilityRefusal };

/**
 * Pure capability mediation: every capability in `required` must be present
 * in `granted`. Any missing capability refuses the whole call with a typed
 * refusal listing ALL missing ids — the caller must handle the refusal;
 * there is no silent partial grant and no rights bypass.
 */
export function mediateCapabilities(
  required: readonly CapabilityId[],
  granted: readonly CapabilityId[],
): CapabilityMediation {
  const grantedSet = new Set<string>(granted);
  const missing = [...new Set<string>(required)]
    .filter((capability) => !grantedSet.has(capability))
    .sort();
  if (missing.length === 0) {
    return { outcome: "granted" };
  }
  const refusal: CapabilityRefusal = {
    kind: "capability-refusal",
    code: "capability/not-granted",
    missing: Object.freeze(missing),
    message: `required capabilities not granted: ${missing.join(", ")}`,
  };
  return { outcome: "refused", refusal: Object.freeze(refusal) };
}
