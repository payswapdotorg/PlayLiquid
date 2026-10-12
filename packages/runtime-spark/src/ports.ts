/**
 * SPARK IO PORTS (E11 — external platform limitations are represented
 * truthfully; no real network/CDN/storage is built here).
 *
 * The Spark runtime's streaming and caching seams are PURE PORTS:
 * - {@link SparkClock} — the only time source (injected; E3/E9);
 * - {@link SparkContentSourcePort} — resolves the bytes of one deferred
 *   unit. Implementations MUST digest-verify what they return; a source
 *   whose bytes do not match the unit's pinned content digest is a typed
 *   `content-digest-mismatch` refusal, never silently accepted content;
 * - {@link SparkCachePort} — the content-addressed cache read/write seam.
 *
 * The in-repo implementations are deterministic fakes (fakes.ts) clearly
 * labeled as test support — never production integrations (lock rule 44).
 *
 * Pure module: interfaces only.
 */

import type { ContentDigest } from "@playliquid/package-system";
import type { SparkDeferredUnit } from "./content.ts";

/** The injected time authority (milliseconds; never a wall clock). */
export interface SparkClock {
  now(): number;
}

/** Fetched deferred-unit content, digest-pinned. */
export interface SparkFetchedContent {
  /** Discriminator: fetched content (never a refusal). */
  readonly ok: true;
  readonly unitId: string;
  readonly contentDigest: ContentDigest;
  readonly bytes: Uint8Array;
}

/** Why a fetch was refused. */
export interface SparkFetchRefusal {
  readonly ok: false;
  readonly code: "source/unit-unavailable" | "source/content-digest-mismatch";
  readonly message: string;
}

/** The deferred-remainder content source seam (E11: no real network). */
export interface SparkContentSourcePort {
  fetch(unit: SparkDeferredUnit): SparkFetchedContent | SparkFetchRefusal;
}

/** One cached blob, content-addressed by digest. */
export interface SparkCacheEntry {
  readonly unitId: string;
  readonly contentDigest: ContentDigest;
  readonly bytes: Uint8Array;
}

/** Why a cache write was refused. */
export interface SparkCacheWriteRefusal {
  readonly ok: false;
  readonly code: "cache-port/write-refused";
  readonly message: string;
}

/** The cache store seam (E11: no real storage backend). */
export interface SparkCachePort {
  /** Reads a cached blob by its pinned content digest, when present. */
  read(contentDigest: ContentDigest): SparkCacheEntry | undefined;
  /** The total bytes currently stored. */
  storedBytes(): number;
  /** Writes one admitted entry (admission happened BEFORE, cache.ts). */
  write(entry: SparkCacheEntry): true | SparkCacheWriteRefusal;
}
