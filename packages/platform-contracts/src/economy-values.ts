/**
 * ECONOMY VALUE CARRIERS (R10 refinement, PL-009 — zero numeric authority).
 *
 * New settlement-era contract shapes carry NO bare `number` amounts.
 * Economy values arrive in exactly two admissible forms:
 *
 * - {@link OpaqueEconomyValue} — the value is content-addressed and
 *   opaque: the platform settles on the DIGEST, and magnitude is the
 *   economy service's (PL-017) concern, read from CAS;
 * - {@link TypedKernelValueReading} — a TYPED READING of a game-ir
 *   kernel value: the primitive kind that was read, plus the digest of
 *   the game-ir ValueShape the value was checked against, plus the
 *   digest of the checked payload.
 *
 * Boundary note (E3 / module matrix): the ValueShape LANGUAGE is
 * `@playliquid/game-ir` authority and is NOT re-declared here — this
 * package depends on `@playliquid/game-contracts` only. The kind union
 * below is a read-only PROJECTION of game-ir's primitive kind
 * vocabulary, carried so readings are typed; the shape-checking
 * functions themselves (isValueShape/valueMatchesShape) are NOT
 * duplicated. If game-ir's primitive vocabulary ever changes, this
 * projection follows via Architecture Change Request.
 *
 * Purity: pure types + pure guards + pure constructors. No IO, and NO
 * arithmetic — carriers never add, compare or scale magnitudes.
 */

import type { ContentDigest } from "./primitives.ts";
import { isValidContentDigest } from "./primitives.ts";

// ---------------------------------------------------------------------------
// Kernel value kind projection (read-only mirror of game-ir primitives)
// ---------------------------------------------------------------------------

/**
 * The primitive kinds of a game-ir kernel value a reading can project.
 * Read-only projection of game-ir's ValueShape primitive vocabulary —
 * see the module doc: the shape language stays in game-ir.
 */
export type KernelValueKind = "unit" | "bool" | "int" | "float" | "string" | "entity-ref";

/** All valid {@link KernelValueKind} values. */
export const KERNEL_VALUE_KINDS: readonly KernelValueKind[] = Object.freeze([
  "unit",
  "bool",
  "int",
  "float",
  "string",
  "entity-ref",
]);

/** Returns true when `value` is a valid {@link KernelValueKind}. */
export function isKernelValueKind(value: unknown): value is KernelValueKind {
  return typeof value === "string" && (KERNEL_VALUE_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The two carriers (disjoint on the `carrier` literal)
// ---------------------------------------------------------------------------

/**
 * An opaque economy value: digest-pinned, magnitude unknown to
 * contracts. The platform settles on the digest; the economy service
 * reads the actual value from content-addressed storage when needed.
 */
export interface OpaqueEconomyValue {
  readonly carrier: "opaque-digest";
  readonly payloadDigest: ContentDigest;
}

/**
 * A typed reading of ONE game-ir kernel value: the primitive kind read,
 * the digest of the ValueShape the value was checked against, and the
 * digest of the checked payload. The reading is a CARRIER of a checked
 * fact — it never re-states the value itself as bare contract data, and
 * it never performs economy math.
 */
export interface TypedKernelValueReading {
  readonly carrier: "kernel-reading";
  readonly kind: KernelValueKind;
  readonly shapeDigest: ContentDigest;
  readonly payloadDigest: ContentDigest;
}

/** An economy value as new contract shapes may carry it. */
export type EconomyValueRef = OpaqueEconomyValue | TypedKernelValueReading;

/** Returns true when `value` is a structurally valid {@link EconomyValueRef}. */
export function isEconomyValueRef(value: unknown): value is EconomyValueRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  if (ref.carrier === "opaque-digest") {
    return typeof ref.payloadDigest === "string" && isValidContentDigest(ref.payloadDigest);
  }
  if (ref.carrier === "kernel-reading") {
    if (!isKernelValueKind(ref.kind)) return false;
    if (typeof ref.shapeDigest !== "string" || !isValidContentDigest(ref.shapeDigest)) return false;
    return typeof ref.payloadDigest === "string" && isValidContentDigest(ref.payloadDigest);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pure constructors (house `as*` pattern for carriers)
// ---------------------------------------------------------------------------

/**
 * Nominal constructor: wrap a payload digest as an
 * {@link OpaqueEconomyValue}. Returns `undefined` for non-digest input.
 */
export function asOpaqueEconomyValue(payloadDigest: string): OpaqueEconomyValue | undefined {
  return isValidContentDigest(payloadDigest)
    ? { carrier: "opaque-digest", payloadDigest: payloadDigest as ContentDigest }
    : undefined;
}

/**
 * Nominal constructor: assemble a {@link TypedKernelValueReading} from a
 * kind and two digests. Returns `undefined` unless the kind is a valid
 * projection kind and both digests are well-formed.
 */
export function asTypedKernelValueReading(
  kind: string,
  shapeDigest: string,
  payloadDigest: string,
): TypedKernelValueReading | undefined {
  if (!isKernelValueKind(kind)) return undefined;
  if (!isValidContentDigest(shapeDigest) || !isValidContentDigest(payloadDigest)) return undefined;
  return {
    carrier: "kernel-reading",
    kind,
    shapeDigest: shapeDigest as ContentDigest,
    payloadDigest: payloadDigest as ContentDigest,
  };
}

// ---------------------------------------------------------------------------
// Pure reader-helpers (branching only — never magnitude math)
// ---------------------------------------------------------------------------

/**
 * Type guard: the value is a kernel reading of a QUANTITY kind (`int` or
 * `float`) — the only readings a quantity-carrying settlement may pin.
 * Branching only; magnitude is still digest-pinned.
 */
export function isQuantityReading(
  value: EconomyValueRef,
): value is TypedKernelValueReading & { readonly kind: "int" | "float" } {
  return value.carrier === "kernel-reading" && (value.kind === "int" || value.kind === "float");
}

/**
 * Pure shape-pin check: the reading was checked against `shapeDigest`.
 * Opaque values carry no shape pin and never claim one.
 */
export function readingPinnedToShape(value: EconomyValueRef, shapeDigest: ContentDigest): boolean {
  return value.carrier === "kernel-reading" && value.shapeDigest === shapeDigest;
}
