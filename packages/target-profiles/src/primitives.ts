/**
 * Primitive branded identifiers of `@playliquid/target-profiles`.
 *
 * House pattern (compile-time-only brands; see `@playliquid/runtime-contracts`
 * primitives). This package performs no IO — identifiers and digests are
 * supplied by the caller.
 *
 * Digest vocabulary note (E7): the CAS/artifact digest authority is
 * `@playliquid/package-system`; this package (per its dependency list)
 * does not import it. {@link ProfileDigest} uses the SAME wire format
 * (`sha256:<64 lowercase hex>`) so build inputs can pin profile records
 * without format conversion, while the seal discipline itself follows the
 * game-ir house pattern (node:crypto over a canonical form — see
 * digest.ts). Profile sealing is record integrity, not a second CAS
 * authority.
 */

declare const targetBrand: unique symbol;

/** Nominal brand. `Brand<T, B>` is `T` at runtime, a distinct type at compile time. */
export type Brand<T, B extends string> = T & { readonly [targetBrand]: B };

/** Content digest of a sealed target profile record: `sha256:<64 hex>`. */
export type ProfileDigest = Brand<string, "ProfileDigest">;

/** Engine identifier, e.g. `native`, `playcanvas`, `unreal` (seam vocabulary). */
export type EngineId = Brand<string, "EngineId">;

/** Content digest pinning one engine binding (seam vocabulary). */
export type EngineBindingDigest = Brand<string, "EngineBindingDigest">;

/** A console/platform vendor identifier, e.g. `nintendo` (opaque string). */
export type VendorId = Brand<string, "VendorId">;

/** Nominal cast: string -> ProfileDigest. */
export function asProfileDigest(value: string): ProfileDigest {
  return value as ProfileDigest;
}
/** Nominal cast: string -> EngineId (seam-local constructor). */
export function asEngineId(value: string): EngineId {
  return value as EngineId;
}
/** Nominal cast: string -> EngineBindingDigest (seam-local constructor). */
export function asEngineBindingDigest(value: string): EngineBindingDigest {
  return value as EngineBindingDigest;
}
/** Nominal cast: string -> VendorId. */
export function asVendorId(value: string): VendorId {
  return value as VendorId;
}

const PROFILE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const LOWERCASE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Type guard: a well-formed profile digest (`sha256:<64 hex>`). */
export function isProfileDigest(value: unknown): value is ProfileDigest {
  return typeof value === "string" && PROFILE_DIGEST_PATTERN.test(value);
}

/** Type guard: a well-formed engine id (lowercase, hyphenated). */
export function isValidEngineId(value: unknown): value is EngineId {
  return typeof value === "string" && LOWERCASE_ID_PATTERN.test(value);
}

/** Type guard: a well-formed engine binding digest. */
export function isEngineBindingDigest(value: unknown): value is EngineBindingDigest {
  return typeof value === "string" && PROFILE_DIGEST_PATTERN.test(value);
}

/** True iff `value` is a non-empty opaque id text usable as a brand carrier. */
export function isNonEmptyIdText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 214;
}
