/**
 * Deterministic seeded RNG (the in-memory fake for {@link RngPort}).
 *
 * Algorithm: SplitMix32 — a small, well-specified, integer-only generator
 * with good statistical quality for simulation fixtures. All arithmetic is
 * pure 32-bit integer math (Math.imul / unsigned shifts), so the stream is
 * identical on every machine and every run (E9).
 *
 * Seeding: the FNV-1a 32-bit hash of the seed string (deterministic,
 * engine-independent). Forking derives a child state by hashing the parent
 * state hex together with the label — the parent is NOT advanced, so the
 * same fork label always yields the same sub-stream from the same parent
 * state.
 *
 * Pure module: no IO, no Math.random, no Date.
 */

import type { DeterminismSeed } from "@playliquid/runtime-contracts";
import type { RngPort, RngState } from "./ports.ts";

/** 2^32, the draw space of {@link RngPort.nextUint32}. */
export const RNG_DRAW_SPACE = 4294967296;

const GAMMA = 0x9e3779b9;

/** One SplitMix32 advance: returns the next state and the drawn output. */
function advance(state: number): { readonly state: number; readonly out: number } {
  const next = (state + GAMMA) | 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return { state: next >>> 0, out: z >>> 0 };
}

/** FNV-1a 32-bit hash of a string (deterministic, engine-independent). */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stateToHex(state: number): RngState {
  return state.toString(16).padStart(8, "0");
}

function stateFromHex(hex: RngState): number {
  const parsed = Number.parseInt(hex, 16);
  if (!/^[0-9a-f]{1,8}$/.test(hex) || !Number.isInteger(parsed)) {
    throw new RangeError(`malformed RNG state: ${hex}`);
  }
  return parsed >>> 0;
}

/** The SplitMix32 implementation of {@link RngPort}. */
class SplitMix32Rng implements RngPort {
  private current: number;

  constructor(initialState: number) {
    this.current = initialState >>> 0;
  }

  nextUint32(): number {
    const stepped = advance(this.current);
    this.current = stepped.state;
    return stepped.out;
  }

  nextUniform(): number {
    return this.nextUint32() / RNG_DRAW_SPACE;
  }

  get state(): RngState {
    return stateToHex(this.current);
  }

  fork(label: string): RngPort {
    return new SplitMix32Rng(fnv1a32(`${this.state}|${label}`));
  }
}

/** Creates a fresh seeded RNG stream from a determinism seed. */
export function makeRng(seed: DeterminismSeed): RngPort {
  return new SplitMix32Rng(fnv1a32(seed));
}

/** Restores an RNG stream from a previously captured state. */
export function restoreRng(state: RngState): RngPort {
  return new SplitMix32Rng(stateFromHex(state));
}

/**
 * Draws `count` values from a fresh stream seeded with `seed` and encodes
 * them as a deterministic fingerprint string. Two streams with the same
 * seed produce the same fingerprint (the reproducibility test oracle).
 */
export function rngFingerprint(seed: DeterminismSeed, count: number): string {
  const rng = makeRng(seed);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    parts.push(rng.nextUint32().toString(16).padStart(8, "0"));
  }
  return parts.join(",");
}

/**
 * A pseudo-random-ish but fully deterministic float in [min, max), derived
 * from a uniform draw — the convenience used by demo systems. Pure with
 * respect to the supplied rng stream.
 */
export function rngRange(rng: RngPort, min: number, max: number): number {
  return min + (max - min) * rng.nextUniform();
}
