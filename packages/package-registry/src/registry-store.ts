/**
 * RegistryStore — the persistence/transport port of the package registry
 * (Work Order PL-011).
 *
 * The domain performs no IO and no network. The application wires an
 * adapter implementing this port: a local store (JSON file, SQLite), a
 * remote registry client, or the in-memory fake below for tests and
 * in-memory-first wiring.
 *
 * Port contract (async because remote adapters are the expected production
 * shape):
 *
 *   - `listRecords()` — the persisted record set (order is not significant;
 *     the registry index canonicalizes order on load);
 *   - `putRecord(record)` — persist one record; IDEMPOTENT for the same
 *     coordinate+digest (safe to retry); a real adapter SHOULD reject a
 *     different digest at the same coordinate (immutability is ultimately
 *     enforced by the registry index, which fail-closes on conflicts).
 *
 * Mutable state and admission remain owned by the registry facade
 * (`registry.ts`) — the store is a dumb, retriable persistence edge (E1).
 */

import { formatSemver } from '@playliquid/package-system'
import type { PackageRecord } from '@playliquid/package-system'

/** The registry persistence port. Adapters own all IO. */
export interface RegistryStore {
  /** Lists every persisted record. */
  listRecords(): Promise<readonly PackageRecord[]>
  /** Persists one record (idempotent for the same coordinate+digest). */
  putRecord(record: PackageRecord): Promise<void>
}

function coordinateKey(record: PackageRecord): string {
  return `${record.identity.kind}:${record.identity.id}@${formatSemver(record.identity.version)}:${record.identity.contentDigest}`
}

/**
 * In-memory fake for tests and in-memory-first wiring. Keeps insertion
 * order for honest round-tripping; dedupes exact coordinate+digest puts.
 */
export class InMemoryRegistryStore implements RegistryStore {
  readonly #records: PackageRecord[] = []

  /** Snapshot count (test introspection). */
  get recordCount(): number {
    return this.#records.length
  }

  async listRecords(): Promise<readonly PackageRecord[]> {
    return [...this.#records]
  }

  async putRecord(record: PackageRecord): Promise<void> {
    const key = coordinateKey(record)
    if (this.#records.some((existing) => coordinateKey(existing) === key)) {
      return
    }
    this.#records.push(record)
  }
}
