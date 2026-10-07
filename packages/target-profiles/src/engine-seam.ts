/**
 * DOCUMENTED SEAM to `@playliquid/engine-adapter-contract` (Work Order
 * PL-005 — status READY, NOT MERGED at base c9cf856; verified against
 * origin `main` and every remote branch at task start).
 *
 * Per the PL-008 work order, target profile records carry engine-binding
 * compatibility declarations in that package's vocabulary. Because the
 * package does not exist at this base, the minimal STRUCTURAL surfaces
 * needed here are mirrored — exactly the precedent set by
 * `@playliquid/runtime-contracts` (`game-ir-seam.ts`) while PL-001 was in
 * flight.
 *
 * TODO (TL graft when PL-005 merges): replace each local symbol with the
 * corresponding import and delete the mirror:
 *
 *   - EngineId                  -> engine-adapter-contract engine id type
 *   - EngineBindingDigest       -> engine-adapter-contract binding digest type
 *   - EngineBindingDescriptor   -> engine-adapter-contract binding descriptor
 *   - EngineBindingCompatibility-> the compatibility declaration shape the
 *                                  adapter contract defines for profiles
 *
 * Mirrors are STRUCTURAL ONLY: opaque ids and digests plus the
 * supported-target declaration compatibility validation needs. No adapter
 * contracts and no engine SDK types are re-implemented here — engines are
 * adapters, never GameIR authorities (lock rules 20/21). The build-side
 * twin of this seam lives in `@playliquid/build-contracts`
 * (`adapter-seam.ts`).
 */

import type { EngineBindingDigest, EngineId } from "./primitives.ts";
import { isEngineBindingDigest, isNonEmptyIdText, isValidEngineId } from "./primitives.ts";
import type { TargetId } from "./taxonomy.ts";
import { isTargetId } from "./taxonomy.ts";

/**
 * An engine binding as target-profile compatibility validation sees it:
 * opaque content pinned by digest, plus the binding's own supported-target
 * declaration. An engine binding that declares no support for a target is
 * REFUSED for that target's profile.
 */
export interface EngineBindingDescriptor {
  readonly engineId: EngineId;
  readonly bindingDigest: EngineBindingDigest;
  /** Targets this binding declares support for. */
  readonly supportedTargets: readonly TargetId[];
}

/** Type guard: a structurally valid engine binding descriptor. */
export function isEngineBindingDescriptor(value: unknown): value is EngineBindingDescriptor {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<EngineBindingDescriptor>;
  return (
    isValidEngineId(candidate.engineId) &&
    isEngineBindingDigest(candidate.bindingDigest) &&
    Array.isArray(candidate.supportedTargets) &&
    candidate.supportedTargets.every((target) => isTargetId(target))
  );
}

/**
 * The engine-binding compatibility declaration a target profile record
 * carries: which engine families the profile accepts, optionally pinned
 * to exact binding digests. Games targeting native GameIR declare the
 * `native` engine family (package-system's compatibility vocabulary uses
 * the same id).
 */
export interface EngineBindingCompatibility {
  /** Engine families this profile accepts bindings from (non-empty). */
  readonly engines: readonly EngineId[];
  /** Exact binding digests allow-listed, when the profile pins bindings. */
  readonly pinnedBindings: readonly EngineBindingDigest[] | null;
}

/** Type guard: a structurally valid engine-binding compatibility declaration. */
export function isEngineBindingCompatibility(value: unknown): value is EngineBindingCompatibility {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<EngineBindingCompatibility>;
  if (
    !Array.isArray(candidate.engines) ||
    !candidate.engines.every((engine) => isValidEngineId(engine) && isNonEmptyIdText(engine))
  ) {
    return false;
  }
  if (candidate.pinnedBindings === null || candidate.pinnedBindings === undefined) {
    return true;
  }
  return (
    Array.isArray(candidate.pinnedBindings) &&
    candidate.pinnedBindings.every((digest) => isEngineBindingDigest(digest))
  );
}
