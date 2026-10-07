/**
 * DOCUMENTED SEAM to `@playliquid/tool-fabric` and
 * `@playliquid/engine-adapter-contract` (Work Order PL-005 — status READY,
 * NOT MERGED at base c9cf856; verified against origin `main` and every
 * remote branch at task start).
 *
 * Per the PL-008 work order, build inputs cite the tool-operation and
 * engine-binding vocabulary owned by those packages. Because the packages
 * do not exist at this base, the minimal STRUCTURAL surfaces build inputs
 * need are mirrored here — exactly the precedent set by
 * `@playliquid/runtime-contracts` (`game-ir-seam.ts`) and
 * `@playliquid/package-system` (`game-ir-seam.ts`) while their upstream
 * packages were in flight.
 *
 * TODO (TL graft when PL-005 merges): replace each local symbol with the
 * corresponding import and delete the mirror. Every mirrored symbol:
 *
 *   - EngineId         -> engine-adapter-contract engine id type
 *   - ToolOperationId  -> tool-fabric tool-operation id type
 *   - EngineBindingRef -> engine-adapter-contract engine binding reference
 *
 * The mirrors are STRUCTURAL ONLY: opaque ids, a content digest pinning the
 * binding, and the supported-target declaration build admission needs. No
 * tool-operation semantics, no adapter contracts and no engine SDK types
 * are re-implemented here — engines and DCC tools are adapters, never
 * GameIR authorities (architecture-lock rules 20/21). This seam never
 * becomes a second tool/engine authority.
 */

import type { Brand } from "./primitives.ts";
import type { BuildTargetId } from "./primitives.ts";
import { isNonEmptyIdText } from "./primitives.ts";
import type { ContentDigest } from "@playliquid/package-system";
import { isContentDigest } from "@playliquid/package-system";

/** Engine identifier, e.g. `native`, `playcanvas`, `unreal` (seam mirror). */
export type EngineId = Brand<string, "EngineId">;

/** Nominal cast: string -> EngineId (seam-local constructor). */
export function asEngineId(value: string): EngineId {
  return value as EngineId;
}

/** Tool Fabric operation identifier, e.g. `build`, `cook` (seam mirror). */
export type ToolOperationId = Brand<string, "ToolOperationId">;

/** Nominal cast: string -> ToolOperationId (seam-local constructor). */
export function asToolOperationId(value: string): ToolOperationId {
  return value as ToolOperationId;
}

const LOWERCASE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Type guard: a well-formed engine id (lowercase, hyphenated). */
export function isValidEngineId(value: unknown): value is EngineId {
  return typeof value === "string" && LOWERCASE_ID_PATTERN.test(value);
}

/** Type guard: a well-formed tool-operation id (lowercase, hyphenated). */
export function isValidToolOperationId(value: unknown): value is ToolOperationId {
  return typeof value === "string" && LOWERCASE_ID_PATTERN.test(value);
}

/**
 * A digest-pinned engine binding, as build inputs cite it (seam mirror).
 *
 * The binding CONTENT is opaque to build contracts: `bindingDigest` pins
 * it (the engine-adapter-contract vocabulary defines what a binding
 * contains). `supportedTargets` is the binding's own compatibility
 * declaration — an engine binding that declares no support for the
 * requested target is REFUSED at build admission.
 */
export interface EngineBindingRef {
  readonly engineId: EngineId;
  /** Content digest pinning the opaque binding content. */
  readonly bindingDigest: ContentDigest;
  /** Targets this binding declares support for (compatibility declaration). */
  readonly supportedTargets: readonly BuildTargetId[];
}

/** Type guard: a structurally valid engine binding reference. */
export function isEngineBindingRef(value: unknown): value is EngineBindingRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<EngineBindingRef>;
  return (
    isValidEngineId(candidate.engineId) &&
    isContentDigest(candidate.bindingDigest) &&
    Array.isArray(candidate.supportedTargets) &&
    candidate.supportedTargets.every(
      (target) => isNonEmptyIdText(target) && typeof target === "string",
    ) &&
    isNonEmptyIdText(candidate.engineId)
  );
}
