/**
 * IN-MEMORY FAKES for the Spark runtime's IO ports (E11).
 *
 * STATUS: TEST SUPPORT ONLY. These fakes exist so the runtime's streaming
 * and caching seams can be exercised without any real network, CDN or
 * storage (lock rule 44: no hidden mocks presented as production).
 *
 * Determinism (E9):
 * - {@link FakeSparkContentSource} serves bytes derived PURELY from the
 *   unit's pinned content digest (seeded from it, never random) and
 *   re-verifies the digest of what it serves — the port contract — so a
 *   tampered source is an observable typed refusal;
 * - {@link InMemorySparkCache} is a volatile content-addressed map (a
 *   truthful E11 limitation of the double, never of the design);
 * - {@link ManualSparkClock} is the injected time authority.
 */

import { createHash } from "node:crypto";
import { asTimestamp } from "@playliquid/runtime-contracts";
import type { Timestamp } from "@playliquid/runtime-contracts";
import type { ClockPort } from "@playliquid/runtime-core";
import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type {
  SparkCacheEntry,
  SparkCachePort,
  SparkClock,
  SparkContentSourcePort,
  SparkFetchedContent,
  SparkFetchRefusal,
} from "./ports.ts";
import type { SparkDeferredUnit } from "./content.ts";

/**
 * A manually advanced clock double. Implements BOTH the SparkClock seam
 * and runtime-core's ClockPort (branded Timestamp return), so one clock
 * drives the whole runtime kit in tests (E3/E9).
 */
export class ManualSparkClock implements SparkClock, ClockPort {
  #now: number;
  constructor(startMs = 0) {
    this.#now = startMs;
  }
  now(): Timestamp {
    return asTimestamp(this.#now);
  }
  advance(ms: number): void {
    this.#now += ms;
  }
}

/** Deterministic bytes for a unit: derived from its pinned digest. */
function fakeUnitBytes(unit: SparkDeferredUnit): Uint8Array {
  return createHash("sha256").update(`spark-fake:${unit.contentDigest}:${unit.unitId}`).digest();
}

/** How the fake misbehaves when asked to (tamper tests, E8). */
export type TamperMode = "none" | "wrong-digest" | "wrong-bytes";

/** Options of {@link FakeSparkContentSource}. */
export interface FakeSparkContentSourceOptions {
  /** Units the source refuses outright (source/unit-unavailable). */
  readonly unavailable?: ReadonlySet<string>;
  /** The scripted misbehavior (default "none"). */
  readonly tamper?: TamperMode;
}

/**
 * ContentSourcePort double: serves digest-derived deterministic bytes,
 * re-verifying the pin per the port contract. Under `wrong-digest` it
 * RETURNS a mismatched digest (the runtime's tamper check fires); under
 * `wrong-bytes` it refuses with the port's own digest-mismatch code.
 */
export class FakeSparkContentSource implements SparkContentSourcePort {
  readonly #unavailable: ReadonlySet<string>;
  readonly #tamper: TamperMode;

  constructor(options: FakeSparkContentSourceOptions = {}) {
    this.#unavailable = options.unavailable ?? new Set<string>();
    this.#tamper = options.tamper ?? "none";
  }

  fetch(unit: SparkDeferredUnit): SparkFetchedContent | SparkFetchRefusal {
    if (this.#unavailable.has(unit.unitId)) {
      return { ok: false, code: "source/unit-unavailable", message: `fake source has no bytes for unit ${unit.unitId}` };
    }
    const bytes = fakeUnitBytes(unit);
    if (this.#tamper === "wrong-bytes") {
      return {
        ok: false,
        code: "source/content-digest-mismatch",
        message: `fake source bytes do not hash to unit ${unit.unitId}'s pinned digest (scripted tamper)`,
      };
    }
    if (this.#tamper === "wrong-digest") {
      // Serve honest bytes but claim a forged digest: the runtime's own
      // pin check must refuse this (E8 content-tamper coverage).
      return { ok: true, unitId: unit.unitId, contentDigest: computeDigest({ forged: unit.unitId }), bytes };
    }
    return { ok: true, unitId: unit.unitId, contentDigest: unit.contentDigest, bytes };
  }
}

/** A write-once refusal script for cache tamper tests (E8). */
export type CacheTamperScript = "none" | "reject-writes" | "mismatched-read";

/**
 * CachePort double: a volatile content-addressed map with an honest
 * stored-bytes counter and optional scripted misbehavior.
 */
export class InMemorySparkCache implements SparkCachePort {
  readonly #byDigest = new Map<string, SparkCacheEntry>();
  readonly #tamper: CacheTamperScript;

  constructor(tamper: CacheTamperScript = "none") {
    this.#tamper = tamper;
  }

  read(contentDigest: ContentDigest): SparkCacheEntry | undefined {
    const entry = this.#byDigest.get(contentDigest);
    if (entry === undefined) return undefined;
    if (this.#tamper === "mismatched-read") {
      // Return an entry whose unit id does not match what was written:
      // the runtime's pin check must refuse this (E8).
      return { ...entry, unitId: `forged-${entry.unitId}` };
    }
    return entry;
  }

  storedBytes(): number {
    let total = 0;
    for (const entry of this.#byDigest.values()) {
      total += entry.bytes.length;
    }
    return total;
  }

  write(entry: SparkCacheEntry): true | { ok: false; code: "cache-port/write-refused"; message: string } {
    if (this.#tamper === "reject-writes") {
      return { ok: false, code: "cache-port/write-refused", message: `scripted write refusal for unit ${entry.unitId}` };
    }
    this.#byDigest.set(entry.contentDigest, entry);
    return true;
  }

  /** Test-support view of the stored entries. */
  entries(): readonly SparkCacheEntry[] {
    return [...this.#byDigest.values()];
  }
}
