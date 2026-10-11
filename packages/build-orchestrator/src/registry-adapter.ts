/**
 * THE REGISTRY ADAPTER — the production wiring of {@link BuildSourcePort}
 * over the PlayLiquid Package Graph authorities (PL-011 + PL-002):
 * `@playliquid/package-registry` is the registry authority (record
 * lookup, deterministic lock resolution) and `@playliquid/package-system`
 * owns the lockfile/record vocabulary this port speaks. The adapter
 * NEVER re-implements resolution — it delegates to the registry facade's
 * `resolveLock` (which itself reuses package-system's `resolve`).
 *
 * Locks and other content blobs (GameIR compositions, target profiles,
 * engine bindings, toolchain profiles) are HOST-PROVIDED content: the
 * registry indexes package RECORDS, not arbitrary blobs, so the host
 * supplies the lock table (fingerprint → lock) and — optionally — the
 * additional content it can resolve (e.g. its artifact-store holdings).
 * Digests the adapter cannot vouch for are UNRESOLVABLE (fail-closed
 * admission, E1); nothing is guessed.
 */

import type { ContentDigest, PackageLock } from "@playliquid/package-system";
import type { PackageRegistry } from "@playliquid/package-registry";
import type { BuildSourcePort } from "./ports.ts";

/** A lock lookup: a fingerprint → lock table, or a total host function. */
export type LockSource = ReadonlyMap<ContentDigest, PackageLock> | ((fingerprint: ContentDigest) => PackageLock | null);

/** Additional resolvable content: a digest set, or a total host predicate. */
export type KnownContent = ReadonlySet<ContentDigest> | ((digest: ContentDigest) => boolean);

/** Options of {@link createRegistryBuildSource}. */
export interface RegistryBuildSourceOptions {
  /** The opened package registry (PL-011 facade; read-only use). */
  readonly registry: PackageRegistry;
  /** The host's lock table (locks are host content, never registry records). */
  readonly locks: LockSource;
  /** Additional content the host can resolve (GameIR blobs, profiles, …). */
  readonly knownContent?: KnownContent;
}

function lookupLock(source: LockSource, fingerprint: ContentDigest): PackageLock | null {
  if (typeof source === "function") {
    return source(fingerprint);
  }
  return source.get(fingerprint) ?? null;
}

function lookupContent(source: KnownContent | undefined, digest: ContentDigest): boolean {
  if (source === undefined) {
    return false;
  }
  if (typeof source === "function") {
    return source(digest);
  }
  return source.has(digest);
}

/**
 * Wires the registry/CAS read seam over the package-registry facade plus
 * the host's lock and content tables. Total; never throws.
 */
export function createRegistryBuildSource(options: RegistryBuildSourceOptions): BuildSourcePort {
  const registry = options.registry;
  const locks = options.locks;
  const knownContent = options.knownContent;
  return {
    canResolve(digest: ContentDigest): boolean {
      if (lookupLock(locks, digest) !== null) {
        return true;
      }
      if (registry.getByDigest(digest) !== null) {
        return true;
      }
      return lookupContent(knownContent, digest);
    },
    loadLock(fingerprint: ContentDigest): PackageLock | null {
      return lookupLock(locks, fingerprint);
    },
    resolveClosure(lock: PackageLock) {
      return registry.resolveLock(lock);
    },
  };
}
