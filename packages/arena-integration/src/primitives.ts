/**
 * Arena-local primitive vocabulary for `@playliquid/arena-integration`.
 *
 * This package is the typed, provider-neutral integration layer between the
 * Game Engineering Lab and the EXTERNAL Arena (architecture.md §Arena;
 * architecture-lock rules 6 "Arena is an external human-capability provider"
 * and 32 "Arena escalation is external").
 *
 * Per spec/module-dependency-matrix.md the intended main dependencies of
 * arena-integration are `lab-contracts` and `capability-broker`. At the
 * pinned base of this Work Order neither package exists yet (PL-006 and
 * PL-026 are not merged), so this package builds ONLY on the vocabulary
 * root `@playliquid/game-contracts` (Brand / isValidIdText), exactly like
 * `@playliquid/platform-contracts` does. See the Architecture Change
 * Request note in `src/index.ts` for the pending seam.
 *
 * Purity: this module (and the whole package) performs NO IO. No clock
 * reads, no randomness, no network, no filesystem, no Arena SDK. Time is
 * always an explicit caller-supplied {@link ArenaTimestampMs}; digests are
 * caller-supplied values that this package shape-validates and compares,
 * but never computes (canonical serialization + hashing authority belongs
 * to package-system, reached via the lab-contracts seam once PL-006 lands —
 * re-implementing it here would create a second serialization authority).
 *
 * Nominal typing: identifiers are branded strings (house pattern) so
 * unrelated id spaces cannot be silently interchanged. Branding is
 * compile-time only; values remain JSON-serializable strings at runtime.
 */

import type { Brand } from "@playliquid/game-contracts";

// ---------------------------------------------------------------------------
// Content digests (package-system wire shape)
// ---------------------------------------------------------------------------

/**
 * Lowercase-hex SHA-256 content digest in the PACKAGE-SYSTEM wire shape
 * (`sha256:<64 hex>` — see packages/package-system/src/digest.ts). Large
 * artifacts use content-addressed storage (lock rule 9); digests are how
 * contracts reference them.
 *
 * NOTE (ACR): the intended source of this vocabulary is the package-system
 * digest seam re-exported by lab-contracts. Because PL-006 is not merged at
 * the pinned base, this package brands the SAME wire shape locally (the
 * platform-contracts package sets the precedent for package-local branded
 * digest primitives). When `@playliquid/lab-contracts` lands, this alias
 * should be re-parented to the lab-contracts seam type — a type-level swap
 * with zero data migration, because the wire shape is identical.
 */
export type ArenaContentDigest = Brand<string, "ArenaContentDigest">;

/** Pattern of a well-formed {@link ArenaContentDigest}: `sha256:` + 64 lowercase hex. */
export const ARENA_CONTENT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Returns true when `value` is a well-formed {@link ArenaContentDigest}. */
export function isValidArenaContentDigest(value: string): boolean {
  return ARENA_CONTENT_DIGEST_PATTERN.test(value);
}

/** Parses and validates `value` as an {@link ArenaContentDigest}, or returns `undefined`. */
export function asArenaContentDigest(value: string): ArenaContentDigest | undefined {
  return isValidArenaContentDigest(value) ? (value as ArenaContentDigest) : undefined;
}

// ---------------------------------------------------------------------------
// Timestamps (caller-supplied; this package never reads a clock)
// ---------------------------------------------------------------------------

/**
 * Milliseconds since Unix epoch, ALWAYS supplied by the caller. Comparisons
 * between timestamps are pure functions over explicit inputs; deadline
 * checks (lifecycle expiry) take both `now` and the deadline as arguments.
 */
export type ArenaTimestampMs = Brand<number, "ArenaTimestampMs">;

/**
 * Nominal cast: finite non-negative integer milliseconds → {@link ArenaTimestampMs}.
 * Fractions are refused: Arena bookkeeping is whole-millisecond.
 */
export function asArenaTimestampMs(ms: number): ArenaTimestampMs | undefined {
  return Number.isSafeInteger(ms) && ms >= 0 ? (ms as ArenaTimestampMs) : undefined;
}

// ---------------------------------------------------------------------------
// External Arena identity (opaque, digest-pinned, provider-neutral)
// ---------------------------------------------------------------------------

/**
 * Structural kind marker of an {@link ArenaEndpointRef}. A frozen literal so
 * endpoint refs are recognizable in serialized records without reflection.
 */
export type ArenaEndpointRefKind = "arena-endpoint";

/** Marker value for {@link ArenaEndpointRefKind}. */
export const ARENA_ENDPOINT_REF_KIND: ArenaEndpointRefKind = "arena-endpoint";

/**
 * The identity of one EXTERNAL Arena counterpart: an opaque, digest-pinned
 * reference (E3: provider SDKs and vendor vocabulary never leak into
 * domain contracts). There is deliberately NO name, URL, vendor or
 * protocol field — two endpoints that resolve to the same pinned content
 * are the same endpoint, and any provider-specific detail lives behind the
 * {@link "./transport.ts".ArenaTransport} port implementation, never in
 * the contract types. Provider vocabulary appearing in this type (or any
 * authority type of this package) is a negative-tested violation — see
 * `src/provider-neutrality.test.ts`.
 */
export type ArenaEndpointRef = Readonly<{
  refKind: ArenaEndpointRefKind;
  endpointDigest: ArenaContentDigest;
}>;

/** Returns true when `value` is structurally a valid {@link ArenaEndpointRef}. */
export function isArenaEndpointRef(value: unknown): value is ArenaEndpointRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return ref.refKind === ARENA_ENDPOINT_REF_KIND && typeof ref.endpointDigest === "string" && isValidArenaContentDigest(ref.endpointDigest);
}

/**
 * Canonical comparison key for an {@link ArenaEndpointRef}: its pinned
 * digest. Endpoint identity IS the digest; there is nothing else to compare.
 */
export function arenaEndpointRefKey(ref: ArenaEndpointRef): string {
  return ref.endpointDigest;
}

/** Structural equality of two {@link ArenaEndpointRef}s. */
export function arenaEndpointRefEquals(a: ArenaEndpointRef, b: ArenaEndpointRef): boolean {
  return a.endpointDigest === b.endpointDigest;
}

// ---------------------------------------------------------------------------
// Provenance marker (Arena-originated records)
// ---------------------------------------------------------------------------

/**
 * Provenance marker literal for records that ORIGINATED on the external
 * Arena side and entered PlayLiquid only through validated ingestion.
 *
 * The literal `"arena-external"` is shared vocabulary with lab-contracts'
 * ArenaEscalationRef marker (the Lab marks escalation refs with the same
 * "came from / went to the external Arena" semantics). This package uses
 * the same literal for response payloads and evidence packages so the two
 * vocabularies can never drift apart at the wire level; when PL-006 lands
 * the marker TYPE should be imported from lab-contracts instead of being
 * restated here (see the ACR note in `src/index.ts`).
 */
export type ArenaExternalOriginMarker = "arena-external";

/** Marker value for {@link ArenaExternalOriginMarker}. */
export const ARENA_EXTERNAL_ORIGIN: ArenaExternalOriginMarker = "arena-external";

/** Returns true when `value` is the Arena-external provenance marker literal. */
export function isArenaExternalOriginMarker(value: unknown): value is ArenaExternalOriginMarker {
  return value === ARENA_EXTERNAL_ORIGIN;
}

// ---------------------------------------------------------------------------
// Frozen-vocabulary helper (house pattern)
// ---------------------------------------------------------------------------

/**
 * Builds a frozen membership guard over a frozen vocabulary. Every frozen
 * vocabulary in this package uses this helper so the "frozen table + guard"
 * shape stays uniform (single pattern, single owner — E1/E2).
 */
export function frozenVocabulary<V extends string>(
  name: string,
  values: readonly V[],
): { readonly name: string; readonly values: readonly V[]; is(value: unknown): value is V } {
  const frozen = Object.freeze([...values] as readonly V[]);
  return {
    name,
    values: frozen,
    is(value: unknown): value is V {
      return typeof value === "string" && (frozen as readonly string[]).includes(value);
    },
  };
}
