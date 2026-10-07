/**
 * Target + engine-binding compatibility validation (pure, fail-closed).
 *
 * The rule the architecture demands: an engine binding that declares no
 * support for a target is REFUSED for that target's profile. Mutual
 * consent is required — the profile's own declaration must accept the
 * binding's engine family (and, when pinned, the exact binding digest),
 * AND the binding must declare support for the profile's target.
 *
 * The build-side admission twin of this check lives in
 * `@playliquid/build-contracts` (admission code
 * `target-engine-incompatible`); both sides must agree for a build to run.
 */

import type { EngineBindingDescriptor } from "./engine-seam.ts";
import { isEngineBindingDescriptor } from "./engine-seam.ts";
import type { TargetProfileRecord } from "./records.ts";

/** Stable refusal codes. */
export type EngineCompatibilityErrorCode =
  | "invalid-binding"
  | "engine-not-declared"
  | "binding-not-pinned"
  | "target-not-supported";

/** The compatibility verdict. */
export type EngineCompatibilityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: EngineCompatibilityErrorCode; readonly message: string };

/** Pure compatibility check of a binding against a target profile record. */
export function checkEngineBindingCompatibility(
  profile: TargetProfileRecord,
  binding: EngineBindingDescriptor,
): EngineCompatibilityResult {
  if (!isEngineBindingDescriptor(binding)) {
    return {
      ok: false,
      code: "invalid-binding",
      message: "engine binding descriptor is structurally invalid (fail closed)",
    };
  }
  if (!profile.engineBindings.engines.includes(binding.engineId)) {
    return {
      ok: false,
      code: "engine-not-declared",
      message: `profile does not declare engine "${binding.engineId}" in its compatibility declaration`,
    };
  }
  const pinned = profile.engineBindings.pinnedBindings;
  if (pinned !== null && pinned.length > 0 && !pinned.includes(binding.bindingDigest)) {
    return {
      ok: false,
      code: "binding-not-pinned",
      message: "profile pins exact engine bindings and this binding digest is not among them",
    };
  }
  if (!binding.supportedTargets.includes(profile.target)) {
    return {
      ok: false,
      code: "target-not-supported",
      message: `engine binding "${binding.engineId}" declares no support for target "${profile.target}"`,
    };
  }
  return { ok: true };
}
