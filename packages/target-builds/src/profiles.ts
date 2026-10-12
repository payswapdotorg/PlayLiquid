/**
 * THE TARGET PROFILE SOURCE (PL-036) — the host seam through which
 * target-set resolution obtains the SEALED target profile record of each
 * requested target.
 *
 * One authority per concern: target-profile records, their taxonomy and
 * their seal/verification discipline belong to @playliquid/target-profiles
 * (PL-008) — this port only READS. The bundle adds the one declaration
 * target-profiles records do not carry: the vendor gate the PER-TARGET
 * BUILD INPUTS will declare (build-contracts' data-driven
 * VendorGateRequirement — "build contracts enforce the gate the PROFILE
 * declares", R12/lock rule 24). Keeping the gate on the bundle (host
 * declaration) rather than hardcoding it per target keeps the surface
 * data-driven: any profile may declare a vendor gate, and resolution
 * enforces it fail-closed (typed `evidence-missing` when the request's
 * out-of-band evidence pool does not satisfy it).
 *
 * Pure module: verification helpers only; no IO, no throws.
 */

import type { VendorGateRequirement } from "@playliquid/build-contracts";
import { isVendorGateRequirement } from "@playliquid/build-contracts";
import type { TargetId, TargetProfileRecord } from "@playliquid/target-profiles";
import { validateTargetProfileRecord, verifyTargetProfileDigest } from "@playliquid/target-profiles";

/** A sealed target profile record plus its build-side vendor gate declaration. */
export interface TargetProfileBundle {
  readonly record: TargetProfileRecord;
  /** The vendor gate the per-target build inputs declare (data-driven). */
  readonly vendorGate: VendorGateRequirement;
}

/** The host seam: the sealed profile bundle for one target, or null when unpublished. */
export interface TargetProfilePort {
  bundleFor(target: TargetId): TargetProfileBundle | null;
}

/** Why a profile was refused. Typed; first failure wins. */
export type ProfileRefusalCode = "profile-unavailable" | "profile-invalid";

/** The typed profile-verification verdict of {@link verifyProfileBundle}. */
export type ProfileVerification =
  | { readonly ok: true; readonly bundle: TargetProfileBundle }
  | { readonly ok: false; readonly code: ProfileRefusalCode; readonly message: string };

/**
 * Verifies one bundle for one target (fail-closed): total pre-guard (the
 * port may return anything — untrusted input), vendor-gate shape, target
 * match, content-addressed seal integrity (tamper check, E8) and the
 * target-profiles structural validator. Typed refusals only.
 */
export function verifyProfileBundle(bundle: TargetProfileBundle | null, target: TargetId): ProfileVerification {
  if (bundle === null || typeof bundle !== "object") {
    return { ok: false, code: "profile-unavailable", message: `no target profile is published for target "${target}"` };
  }
  if (!isVendorGateRequirement(bundle.vendorGate)) {
    return { ok: false, code: "profile-invalid", message: `profile bundle for "${target}" declares a structurally invalid vendor gate` };
  }
  const record = bundle.record;
  if (typeof record !== "object" || record === null || record.target !== target) {
    return { ok: false, code: "profile-invalid", message: `profile bundle for "${target}" carries a record for a different target` };
  }
  try {
    if (!verifyTargetProfileDigest(record)) {
      return { ok: false, code: "profile-invalid", message: `profile record for "${target}" fails its content-addressed seal (tampered digest, E8)` };
    }
    const validation = validateTargetProfileRecord(record);
    if (!validation.ok) {
      return { ok: false, code: "profile-invalid", message: `profile record for "${target}" is structurally invalid: ${validation.reasons.map((reason) => reason.code).join(", ")}` };
    }
  } catch {
    // Totality against hostile port values (e.g. a cyclic object breaking the
    // canonical serialization): malformed is refused, never thrown (E8).
    return { ok: false, code: "profile-invalid", message: `profile record for "${target}" is not verifiable (malformed; fail closed, E8)` };
  }
  return { ok: true, bundle };
}
