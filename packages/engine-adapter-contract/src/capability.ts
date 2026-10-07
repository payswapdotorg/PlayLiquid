/**
 * Module role: adapter capability declaration contract — the capability id
 * grammar adapters use at registration, a validator for untrusted
 * declaration lists, and the pure mediation check that turns a dispatch to
 * an undeclared capability into a typed refusal. Defined LOCALLY: the
 * dependency matrix authorizes only @playliquid/game-contracts imports for
 * these packages, no cross-package import between the two new packages was
 * authorized, and game-contracts is not imported here at all.
 *
 * Implements: PL-005 §3.B.4 (capability declaration).
 */

export type AdapterCapabilityId = string;

export type AdapterCapabilityIdRejectionCode =
  | "adapter-capability-id/not-a-string"
  | "adapter-capability-id/empty"
  | "adapter-capability-id/too-long"
  | "adapter-capability-id/format";

export interface AdapterCapabilityIdRejection {
  readonly code: AdapterCapabilityIdRejectionCode;
  readonly message: string;
}

export type AdapterCapabilityIdCheck =
  | { readonly outcome: "ok"; readonly capability: AdapterCapabilityId }
  | { readonly outcome: "rejected"; readonly rejection: AdapterCapabilityIdRejection };

const ADAPTER_CAPABILITY_ID_MAX_LENGTH = 128;
const ADAPTER_CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

function idRejected(code: AdapterCapabilityIdRejectionCode, message: string): AdapterCapabilityIdCheck {
  const rejection: AdapterCapabilityIdRejection = { code, message };
  return { outcome: "rejected", rejection: Object.freeze(rejection) };
}

/** Validates an untrusted adapter capability id. Total; never throws. */
export function validateAdapterCapabilityId(input: unknown): AdapterCapabilityIdCheck {
  if (typeof input !== "string") {
    return idRejected("adapter-capability-id/not-a-string", "adapter capability id must be a string");
  }
  if (input.length === 0) {
    return idRejected("adapter-capability-id/empty", "adapter capability id must not be empty");
  }
  if (input.length > ADAPTER_CAPABILITY_ID_MAX_LENGTH) {
    return idRejected("adapter-capability-id/too-long", `adapter capability id must be at most ${ADAPTER_CAPABILITY_ID_MAX_LENGTH} characters`);
  }
  if (!ADAPTER_CAPABILITY_ID_PATTERN.test(input)) {
    return idRejected("adapter-capability-id/format", 'adapter capability id must be dot-separated lowercase segments starting with a letter, e.g. "scene.render"');
  }
  return { outcome: "ok", capability: input };
}

export type CapabilityListRejectionCode =
  | "adapter-capability-list/not-an-array"
  | "adapter-capability-list/entry-invalid"
  | "adapter-capability-list/duplicate";

export interface CapabilityListRejection {
  readonly code: CapabilityListRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type AdapterCapabilityListValidation =
  | { readonly outcome: "ok"; readonly capabilities: readonly AdapterCapabilityId[] }
  | { readonly outcome: "rejected"; readonly rejections: readonly CapabilityListRejection[] };

/**
 * Validates an untrusted registration-time capability declaration list.
 * Order is preserved; duplicates and invalid entries are typed rejections.
 * Total; never throws.
 */
export function validateAdapterCapabilityList(input: unknown): AdapterCapabilityListValidation {
  if (!Array.isArray(input)) {
    const rejection: CapabilityListRejection = {
      code: "adapter-capability-list/not-an-array",
      message: "declared capabilities must be an array of capability ids",
      path: "capabilities",
    };
    return { outcome: "rejected", rejections: Object.freeze([Object.freeze(rejection)]) };
  }
  const entries: readonly unknown[] = input;
  const rejections: CapabilityListRejection[] = [];
  const seen = new Set<string>();
  const list: AdapterCapabilityId[] = [];
  let valid = true;
  for (let index = 0; index < entries.length; index += 1) {
    const check = validateAdapterCapabilityId(entries[index]);
    if (check.outcome === "rejected") {
      valid = false;
      const rejection: CapabilityListRejection = {
        code: "adapter-capability-list/entry-invalid",
        message: `capabilities[${index}] invalid: ${check.rejection.message}`,
        path: `capabilities[${index}]`,
      };
      rejections.push(Object.freeze(rejection));
      continue;
    }
    if (seen.has(check.capability)) {
      valid = false;
      const rejection: CapabilityListRejection = {
        code: "adapter-capability-list/duplicate",
        message: `capabilities[${index}] duplicates an earlier entry`,
        path: `capabilities[${index}]`,
      };
      rejections.push(Object.freeze(rejection));
      continue;
    }
    seen.add(check.capability);
    list.push(check.capability);
  }
  if (!valid) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }
  return { outcome: "ok", capabilities: Object.freeze(list) };
}

export interface AdapterCapabilityRefusal {
  readonly code: "adapter-capability/not-declared";
  readonly requested: AdapterCapabilityId;
  readonly message: string;
}

export type AdapterCapabilityMediation =
  | { readonly outcome: "granted" }
  | { readonly outcome: "refused"; readonly refusal: AdapterCapabilityRefusal };

/**
 * Pure mediation for a dispatch: the requested capability must be among the
 * capabilities the adapter declared at registration. Anything else is a
 * typed refusal — there is no silent dispatch to an undeclared capability.
 */
export function mediateAdapterCapability(
  declared: readonly AdapterCapabilityId[],
  requested: AdapterCapabilityId,
): AdapterCapabilityMediation {
  if (declared.includes(requested)) {
    return { outcome: "granted" };
  }
  const refusal: AdapterCapabilityRefusal = {
    code: "adapter-capability/not-declared",
    requested,
    message: `capability not declared by this adapter: ${requested}`,
  };
  return { outcome: "refused", refusal: Object.freeze(refusal) };
}
