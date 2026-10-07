/**
 * The port-wired registry facade (Work Order PL-011) — app orchestration
 * over the `RegistryStore` port (module matrix rule: "app orchestrates
 * through ports").
 *
 * `openRegistry` loads the persisted record set into the pure
 * `RegistryIndex` (fail closed on invalid or conflicting store records);
 * `publish` follows a transactional admission order:
 *
 *   1. pure pre-flight (structural validation, release gate, immutability
 *      conflict check) — no side effects;
 *   2. `store.putRecord` — persistence; port failures surface as
 *      `store-error` and leave the in-memory index UNTOUCHED;
 *   3. index commit — re-checked fail-closed, so the in-memory index and
 *      the store can never diverge on a visible record.
 *
 * Async/stateful work documentation (worker contract):
 *   - mutable state owner: this facade object — the single owner of the
 *     in-memory index and of the admission queue (E1);
 *   - command admission: mutating commands serialize through an internal
 *     promise chain — concurrent publishes are admitted one at a time, in
 *     call order (no interleaved read-modify-write);
 *   - event order: load-once at open; publish is check → persist → commit;
 *   - idempotency key: (kind, id, version, contentDigest) — re-publishing
 *     the identical record is a no-op success;
 *   - stale-result rule: every publish verdict reflects the committed index
 *     state at its admission turn (serialized), never a torn state;
 *   - retry semantics: `putRecord` port calls are idempotent, so a retried
 *     publish after a transient port failure is safe;
 *   - cancellation: not modeled — publish either completes or fails closed
 *     without mutating visible state.
 */

import type {
  CapabilityId,
  CapabilityReference,
  ContentDigest,
  PackageId,
  PackageLock,
  PackageRecord,
  ResolutionResult,
  SemanticVersion,
} from '@playliquid/package-system'
import {
  createRegistryIndex,
  loadRecords,
} from './registry-index.ts'
import type {
  RegistryCoordinate,
  RegistryIndex,
  RegistryIndexOptions,
  RegistryPublishResult,
} from './registry-index.ts'
import type { RegistryStore } from './registry-store.ts'

/** One record the store refused to load, with the registry's verdict. */
export interface InvalidStoreRecord {
  readonly record: PackageRecord
  readonly result: RegistryPublishResult
}

/** The failure arm of `openRegistry`. */
export interface RegistryOpenFailure {
  readonly ok: false
  readonly code: 'invalid-store-record'
  readonly message: string
  readonly failures: readonly InvalidStoreRecord[]
}

/** The result of opening a registry over a store. */
export type RegistryOpenResult =
  | { readonly ok: true; readonly registry: PackageRegistry }
  | RegistryOpenFailure

/** The publication error produced when the persistence port fails. */
export interface RegistryStoreError {
  readonly ok: false
  readonly code: 'store-error'
  readonly message: string
}

/** The port-wired registry. */
export interface PackageRegistry {
  /** Transactional publish (check → persist → commit; serialized). */
  publish(record: PackageRecord): Promise<RegistryPublishResult | RegistryStoreError>
  /** The underlying pure index (read-only access). */
  readonly index: RegistryIndex
  /** Deterministic lock resolution over the current snapshot (E9). */
  resolveLock(lock: PackageLock): ResolutionResult
  /** Exact-coordinate lookup (build metadata significant). */
  get(coordinate: RegistryCoordinate): PackageRecord | null
  /** Digest lookup. */
  getByDigest(digest: ContentDigest): PackageRecord | null
  /** Highest-precedence version of `id` satisfying `constraint`. */
  bestMatch(id: PackageId, constraint: string): PackageRecord | null
  /** Capability provider lookup. */
  findProviders(reference: CapabilityReference): readonly PackageRecord[]
  /** Capability requirement lookup. */
  findRequiring(capabilityId: CapabilityId): readonly PackageRecord[]
  /** Permission filter. */
  findByPermission(capabilityId: CapabilityId): readonly PackageRecord[]
  /** Stable-ordered listing. */
  list(): readonly PackageRecord[]
  /** Precedence-ordered versions of one id. */
  listVersions(id: PackageId): readonly SemanticVersion[]
  /** Record snapshot (package-system `PackageIndex` compatible). */
  snapshot(): readonly PackageRecord[]
  /** Number of indexed records. */
  size(): number
}

/** Options of {@link openRegistry}. */
export interface OpenRegistryOptions extends RegistryIndexOptions {
  readonly store: RegistryStore
}

/**
 * Opens a registry over a persistence port. Fails closed
 * (`invalid-store-record`) when the store contains structurally invalid,
 * gate-failing or mutually conflicting records — a poisoned store is an
 * operational fault that must be fixed, not silently quarantined.
 */
export async function openRegistry(
  options: OpenRegistryOptions,
): Promise<RegistryOpenResult> {
  const index = createRegistryIndex(options)
  let records: readonly PackageRecord[]
  try {
    records = await options.store.listRecords()
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-store-record',
      message: `store listRecords failed: ${error instanceof Error ? error.message : String(error)}`,
      failures: [],
    }
  }
  const { failures } = loadRecords(index, records)
  if (failures.length > 0) {
    return {
      ok: false,
      code: 'invalid-store-record',
      message: `store contains ${failures.length} record(s) the registry refuses to load (fail closed): ${failures
        .map((failure) => failure.result.ok ? 'ok' : `${failure.result.code}`)
        .join(', ')}`,
      failures,
    }
  }
  return { ok: true, registry: createFacade(options.store, index) }
}

function createFacade(store: RegistryStore, index: RegistryIndex): PackageRegistry {
  /** Serialized admission queue (E1/E2: one writer, in call order). */
  let queue: Promise<unknown> = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation, operation)
    queue = next.catch(() => undefined)
    return next
  }

  async function publishNow(record: PackageRecord): Promise<RegistryPublishResult | RegistryStoreError> {
    // 1. Pure pre-flight — no side effects yet.
    const verdict = index.checkPublish(record)
    if (!verdict.ok || verdict.status === 'already-published') {
      return verdict
    }
    // 2. Persist first; a port failure leaves the index untouched.
    try {
      await store.putRecord(record)
    } catch (error) {
      return {
        ok: false,
        code: 'store-error',
        message: `putRecord failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    // 3. Commit; commit re-runs the full check fail-closed, so an unexpected
    //    conflict can never surface a divergent record.
    return index.publish(record)
  }

  return {
    index,
    publish: (record: PackageRecord) => serialize(() => publishNow(record)),
    resolveLock: (lock: PackageLock) => index.resolveLock(lock),
    get: (coordinate: RegistryCoordinate) => index.get(coordinate),
    getByDigest: (digest: ContentDigest) => index.getByDigest(digest),
    bestMatch: (id: PackageId, constraint: string) => index.bestMatch(id, constraint),
    findProviders: (reference: CapabilityReference) => index.findProviders(reference),
    findRequiring: (capabilityId: CapabilityId) => index.findRequiring(capabilityId),
    findByPermission: (capabilityId: CapabilityId) => index.findByPermission(capabilityId),
    list: () => index.list(),
    listVersions: (id: PackageId) => index.listVersions(id),
    snapshot: () => index.snapshot(),
    size: () => index.size(),
  }
}
