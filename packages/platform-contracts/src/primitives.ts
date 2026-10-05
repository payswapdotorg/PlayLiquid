/**
 * Platform-local primitive vocabulary for `@playliquid/platform-contracts`.
 *
 * This package is the typed capability surface of the GameOS platform
 * services (R7, lock rule 17). Per spec/module-dependency-matrix.md its one
 * main dependency is `@playliquid/game-contracts`, imported directly through
 * the workspace link; everything below is platform-local vocabulary built on
 * that root.
 *
 * Purity: this module (and the whole package) performs NO IO. No clock
 * reads, no randomness, no network, no filesystem. Time is always an
 * explicit caller-supplied {@link TimestampMs}; identifiers are supplied by
 * callers. Service implementations live in later Work Orders (PL-015..018).
 *
 * Nominal typing: identifiers are branded strings (house pattern from
 * `@playliquid/game-contracts`) so unrelated id spaces cannot be silently
 * interchanged. Branding is compile-time only; values remain ordinary
 * JSON-serializable strings at runtime.
 */

import type { Brand } from "@playliquid/game-contracts";
import { isValidIdText } from "@playliquid/game-contracts";

/**
 * Tenant identifier (R20). Every platform record and request is scoped to
 * exactly one tenant; isolation is enforced by `tenancy.ts`.
 */
export type TenantId = Brand<string, "TenantId">;

/**
 * Platform subject identifier: the opaque identity a player/account carries
 * across platform services. Not a game entity id (those live in
 * `@playliquid/game-contracts`); subjects are platform-owned.
 */
export type SubjectId = Brand<string, "SubjectId">;

/**
 * Lowercase hex SHA-256 digest (64 chars) of a content-addressed artifact
 * (replay, evidence, outcome record). Large binaries use content-addressed
 * storage (lock rule 9) — digests are how contracts reference them.
 */
export type ContentDigest = Brand<string, "ContentDigest">;

/**
 * Milliseconds since Unix epoch, ALWAYS supplied by the caller. This
 * package never reads a wall clock; comparisons between timestamps are
 * pure functions over explicit inputs.
 */
export type TimestampMs = Brand<number, "TimestampMs">;

/** Parses and validates `text` as a {@link TenantId}, or returns `undefined`. */
export function asTenantId(text: string): TenantId | undefined {
  return isValidIdText(text) ? (text as TenantId) : undefined;
}

/** Parses and validates `text` as a {@link SubjectId}, or returns `undefined`. */
export function asSubjectId(text: string): SubjectId | undefined {
  return isValidIdText(text) ? (text as SubjectId) : undefined;
}

/** True iff `value` is a syntactically valid lowercase-hex SHA-256 digest. */
export function isValidContentDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** Parses and validates `value` as a {@link ContentDigest}, or returns `undefined`. */
export function asContentDigest(value: string): ContentDigest | undefined {
  return isValidContentDigest(value) ? (value as ContentDigest) : undefined;
}

/**
 * Nominal cast: finite non-negative integer milliseconds -> {@link TimestampMs}.
 * Fractions are refused: platform bookkeeping is whole-millisecond.
 */
export function asTimestampMs(ms: number): TimestampMs | undefined {
  return Number.isSafeInteger(ms) && ms >= 0 ? (ms as TimestampMs) : undefined;
}

// ---------------------------------------------------------------------------
// Authority vocabulary (lock rules 18, 19, 41)
// ---------------------------------------------------------------------------

/**
 * Marker literal that ONLY platform services can structurally provide on
 * records they decided. Client/game-originated payloads carry the disjoint
 * {@link "./events.ts".UntrustedClientInput} marker instead, so the two
 * trust domains can never be confused at the type layer.
 */
export type PlatformAuthorityMarker = "platform-authority";

/**
 * Marker value for {@link PlatformAuthorityMarker}. A primitive string is
 * inherently immutable (E1); no freeze call needed or possible.
 */
export const PLATFORM_AUTHORITY: PlatformAuthorityMarker = "platform-authority";

/** Returns true when `value` is the platform authority marker literal. */
export function isPlatformAuthorityMarker(value: unknown): value is PlatformAuthorityMarker {
  return value === "platform-authority";
}
