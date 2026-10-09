/**
 * Module role: an in-memory content-addressed artifact exchange — the
 * reference ArtifactExchangePort implementation. `put` computes the sha256
 * digest of the bytes (node:crypto; this is a flat, unlayered module so
 * the import stays out of the pure layers) and stores them keyed by
 * digest; `resolve` re-verifies the content hash on every read so a
 * corrupted entry is reported as `corrupt`, never silently trusted.
 *
 * TRUTHFUL LIMITATION (E11): this implementation is process-local memory.
 * It is NOT durable across restarts; real deployments provide a CAS-backed
 * implementation of the same port.
 *
 * Implements: PL-019 exchange handling — content-addressed references.
 */

import { createHash } from "node:crypto";
import type { ArtifactDigest, ArtifactRef } from "./domain/exchange.ts";
import type { ArtifactExchangePort, ArtifactResolution, StoredArtifact } from "./domain/ports.ts";

export interface InMemoryArtifactExchange extends ArtifactExchangePort {
  /** Stores bytes content-addressed; returns the artifact reference. */
  put(bytes: Uint8Array): ArtifactRef;
  /** Number of stored artifacts (observation for tests). */
  readonly size: number;
}

/** Creates an empty in-memory content-addressed artifact exchange. */
export function createInMemoryArtifactExchange(): InMemoryArtifactExchange {
  const store = new Map<ArtifactDigest, Uint8Array>();

  function digestOf(bytes: Uint8Array): ArtifactDigest {
    return createHash("sha256").update(bytes).digest("hex");
  }

  return Object.freeze({
    put: (bytes: Uint8Array): ArtifactRef => {
      const digest = digestOf(bytes);
      store.set(digest, bytes);
      return Object.freeze({ kind: "artifact-ref", digest, bytes: bytes.byteLength });
    },
    async resolve(ref: ArtifactRef): Promise<ArtifactResolution> {
      const stored = store.get(ref.digest);
      if (stored === undefined) {
        return { outcome: "missing", digest: ref.digest };
      }
      if (stored.byteLength !== ref.bytes) {
        return {
          outcome: "corrupt",
          digest: ref.digest,
          reason: `declared size ${ref.bytes} but stored artifact holds ${stored.byteLength} bytes`,
        };
      }
      if (digestOf(stored) !== ref.digest) {
        return {
          outcome: "corrupt",
          digest: ref.digest,
          reason: "stored content no longer hashes to its digest",
        };
      }
      const artifact: StoredArtifact = { digest: ref.digest, bytes: stored.byteLength };
      return { outcome: "resolved", artifact: Object.freeze(artifact) };
    },
    get size(): number {
      return store.size;
    },
  });
}
