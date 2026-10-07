/**
 * Primitive branded identifiers of `@playliquid/build-contracts`.
 *
 * House pattern (see `@playliquid/runtime-contracts` primitives): branding
 * is compile-time only. The `as*` constructors are documented no-op casts
 * that cross from plain strings into nominal id spaces at system
 * boundaries; misuse fails to compile instead of interchanging unrelated
 * id spaces. This package performs no IO — every identifier is supplied by
 * the caller.
 */

declare const buildBrand: unique symbol;

/** Nominal brand. `Brand<T, B>` is `T` at runtime, a distinct type at compile time. */
export type Brand<T, B extends string> = T & { readonly [buildBrand]: B };

/** Identity of one admitted build (minted by the admitting build service). */
export type BuildId = Brand<string, "BuildId">;

/**
 * Opaque target identifier. The target TAXONOMY (web, spark, windows, …)
 * is owned by `@playliquid/target-profiles`; the build contract layer
 * treats target ids as opaque and enforces console/vendor requirements
 * data-driven, through the target profile reference's vendor gate (R12).
 */
export type BuildTargetId = Brand<string, "BuildTargetId">;

/** A build artifact kind, e.g. `game.bundle` (dotted, lowercase). */
export type BuildArtifactKind = Brand<string, "BuildArtifactKind">;

/** A console/platform vendor identifier, e.g. `nintendo` (opaque string). */
export type VendorId = Brand<string, "VendorId">;

/** Identity of the requesting principal (builder agent or service). */
export type RequesterId = Brand<string, "RequesterId">;

/** Opaque idempotency nonce chosen and reused by the requester (E6). */
export type BuildNonce = Brand<string, "BuildNonce">;

/** Identity of a toolchain/environment profile (content-addressed input). */
export type ToolchainProfileId = Brand<string, "ToolchainProfileId">;

/**
 * Identity of a target profile record as addressed by the target-profile
 * vocabulary (opaque here; `@playliquid/target-profiles` owns the records).
 */
export type ProfileInputId = Brand<string, "ProfileInputId">;

/** Nominal cast: string -> BuildId. */
export function asBuildId(value: string): BuildId {
  return value as BuildId;
}
/** Nominal cast: string -> BuildTargetId. */
export function asBuildTargetId(value: string): BuildTargetId {
  return value as BuildTargetId;
}
/** Nominal cast: string -> VendorId. */
export function asVendorId(value: string): VendorId {
  return value as VendorId;
}
/** Nominal cast: string -> RequesterId. */
export function asRequesterId(value: string): RequesterId {
  return value as RequesterId;
}
/** Nominal cast: string -> BuildNonce. */
export function asBuildNonce(value: string): BuildNonce {
  return value as BuildNonce;
}
/** Nominal cast: string -> ToolchainProfileId. */
export function asToolchainProfileId(value: string): ToolchainProfileId {
  return value as ToolchainProfileId;
}
/** Nominal cast: string -> ProfileInputId. */
export function asProfileInputId(value: string): ProfileInputId {
  return value as ProfileInputId;
}

/** Nominal cast: string -> BuildArtifactKind (assumes {@link isBuildArtifactKind} passed). */
export function asBuildArtifactKind(value: string): BuildArtifactKind {
  return value as BuildArtifactKind;
}

const BUILD_ARTIFACT_KIND_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

/**
 * Type guard: a well-formed dotted artifact kind (`game.bundle`,
 * `assets.pack`, `debug.symbols`). At least one dot is required so every
 * artifact kind is namespaced.
 */
export function isBuildArtifactKind(value: string): value is BuildArtifactKind {
  return BUILD_ARTIFACT_KIND_PATTERN.test(value);
}

/** True iff `value` is a non-empty opaque id text usable as a brand carrier. */
export function isNonEmptyIdText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 214;
}
