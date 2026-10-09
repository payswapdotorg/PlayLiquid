/**
 * Module role: an in-memory ClockPort test double — a caller-programmed
 * deterministic time cursor. This is the fake that makes "no wall-clock in
 * the domain" testable: the runtime under test cannot observe real time
 * even by accident. TEST DOUBLE; not production.
 *
 * Implements: PL-019 ClockPort fake (deterministic time seam).
 */

import type { ClockPort } from "./domain/ports.ts";

export interface InMemoryClock extends ClockPort {
  /** Advances the cursor by `ms` and returns the new reading. */
  advanceBy(ms: number): number;
  /** Forces the cursor to an absolute reading. */
  setTo(epochMs: number): number;
}

/** Creates a deterministic in-memory clock starting at `startEpochMs`. */
export function createInMemoryClock(startEpochMs = 0): InMemoryClock {
  let cursor = startEpochMs;
  return Object.freeze({
    now: () => cursor,
    advanceBy: (ms: number): number => {
      cursor += ms;
      return cursor;
    },
    setTo: (epochMs: number): number => {
      cursor = epochMs;
      return cursor;
    },
  });
}
