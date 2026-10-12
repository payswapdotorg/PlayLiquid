/**
 * THE SEEDED SEARCH TRAVERSAL (PL-029) — deterministic, cursorable
 * enumeration of the candidate space (spec/architecture.md §Lab loop:
 * "organization search"; R16, lock 25).
 *
 * Traversal model (E9): the request's seed deterministically selects a
 * STRIDE WALK over the finite space — `spaceIndex(position) = (start +
 * position * stride) mod size` — where `start` and `stride` are derived by
 * hashing (seed, space digest) and `stride` is adjusted to be COPRIME with
 * the space size, so the walk is a BIJECTION: every candidate is visited
 * exactly once per full traversal, in a stable, reproducible,
 * content-derived order. No Math.random, no wall-clock, no IO.
 *
 * Consequences:
 * - identical request (same canonical catalogs + same seed) → identical
 *   sequence, always (negative-tested);
 * - a different seed walks the same space differently (usually) — the
 *   candidate SET is identical, only the order changes;
 * - the generalist baseline (lock 26, space index 0) appears at the
 *   sequence position that solves `start + p·stride ≡ 0 (mod size)` —
 *   always present, never duplicated.
 *
 * The cursor is single-use and monotonic: each page issues the next cursor,
 * and the service refuses stale, skipped-ahead, foreign-space and
 * past-the-end cursors with typed codes (E8).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import type { EvaluationSeed } from "@playliquid/lab-contracts";
import type { CandidateSpace, SearchedCandidate } from "./records.ts";
import { organizationDigestOf } from "./digest.ts";
import { candidateAtSpaceIndex } from "./generate.ts";

/** Domain-separation tag for traversal derivation. */
const TRAVERSAL_TAG = "playliquid:lab-organization:traversal:1";

/** The derived stride walk of one search (bijective over the space). */
export interface SearchTraversal {
  readonly size: number;
  readonly start: number;
  readonly stride: number;
}

/** Greatest common divisor (safe integers; Euclid). */
function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) {
    const rest = left % right;
    left = right;
    right = rest;
  }
  return left;
}

/**
 * Derives the traversal of (space, seed): two independent 32-bit halves of
 * the SHA-256 over (tag, space digest, seed) become `start` (mod size) and
 * `stride` (1..size-1, adjusted to the nearest coprime). Deterministic and
 * total; size >= 3 is guaranteed by the space model (the role axis alone
 * contributes a factor of 2).
 */
export function traversalOf(space: CandidateSpace, seed: EvaluationSeed): SearchTraversal {
  const size = space.size;
  const digest = organizationDigestOf({ tag: TRAVERSAL_TAG, space: space.digest, seed: String(seed) });
  const first = Number.parseInt(digest.slice(0, 8), 16);
  const second = Number.parseInt(digest.slice(8, 16), 16);
  const start = first % size;
  let stride = (second % (size - 1)) + 1;
  while (gcd(stride, size) !== 1) {
    stride = (stride % (size - 1)) + 1;
  }
  return { size, start, stride };
}

/** The space index visited at sequence `position` (total). */
export function spaceIndexOf(traversal: SearchTraversal, position: number): number {
  const normalized = ((position % traversal.size) + traversal.size) % traversal.size;
  return (traversal.start + normalized * traversal.stride) % traversal.size;
}

/**
 * The candidate at sequence `position` of the traversal (pure: derives the
 * space index, then generates the candidate). Total: out-of-range positions
 * yield `undefined`.
 */
export function candidateAtPosition(
  space: CandidateSpace,
  traversal: SearchTraversal,
  position: number,
): SearchedCandidate | undefined {
  if (position < 0 || position >= space.size) return undefined;
  const candidate = candidateAtSpaceIndex(space, spaceIndexOf(traversal, position));
  return candidate === undefined ? undefined : { ...candidate, position };
}

/**
 * The sequence position of the generalist baseline (lock 26): the position
 * that solves `start + p·stride ≡ 0 (mod size)` — `p = -start ·
 * stride⁻¹ (mod size)`, computed by the walk itself (deterministic scan is
 * unnecessary: stride is coprime, so the inverse exists).
 */
export function baselinePositionOf(traversal: SearchTraversal): number {
  for (let position = 0; position < traversal.size; position += 1) {
    if (spaceIndexOf(traversal, position) === 0) return position;
  }
  return 0;
}

/**
 * The whole traversal as an eager array (tests/harness only — the service
 * streams lazily through {@link candidateAtPosition}).
 */
export function enumerateTraversal(space: CandidateSpace, traversal: SearchTraversal): readonly SearchedCandidate[] {
  const out: SearchedCandidate[] = [];
  for (let position = 0; position < space.size; position += 1) {
    const candidate = candidateAtPosition(space, traversal, position);
    if (candidate !== undefined) out.push(candidate);
  }
  return out;
}
