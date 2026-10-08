/**
 * Fixture builders and deterministic in-memory fakes.
 *
 * House pattern (mirrors package-system's `test-fixtures.ts` and game-ir's
 * `fixtures.ts`): NOT exported from the package barrel — tests and the
 * harness import this module directly.
 *
 * Everything digested is computed at runtime via package-system's sealing
 * machinery, so no digest literal ever appears in source, and the fake
 * {@link LineageStore} is deterministic (insertion-ordered, idempotent).
 */

import type {
  PackageCoordinate,
  PackageIdentity,
  PackageKind,
  PackageMetadata,
  PackageRecord,
  UnsealedPackageRecord,
} from '@playliquid/package-system'
import { parseSemver, sealPackageRecord } from '@playliquid/package-system'
import type { LineageEdge, LineageNode } from './lineage.ts'
import { makeLineageNode } from './lineage.ts'
import type { LineageStore } from './ports.ts'

/** A well-formed fixture commit SHA (assembled, not secret-shaped). */
export const FIXTURE_COMMIT = '0123456789abcdef0123456789abcdef01234567'

/** Parses or throws — for fixture literals only. */
export function semver(value: string) {
  const parsed = parseSemver(value)
  if (parsed === null) {
    throw new Error(`fixture semver literal is invalid: ${value}`)
  }
  return parsed
}

/** Default metadata: gate-passing provenance/license, no capabilities. */
export function makeMetadata(
  overrides?: Partial<PackageMetadata>,
): PackageMetadata {
  return {
    dependencies: [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: {
      spdxExpression: 'Apache-2.0',
      status: 'verified',
    },
    provenance: {
      origin: { type: 'original' },
      sourceCommit: FIXTURE_COMMIT,
      transformationHistory: [
        { kind: 'author', description: 'authored for the fixture corpus' },
      ],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ['simulation'], engines: ['native'], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [],
    extensionPoints: [],
    overlay: null,
    ...overrides,
  }
}

/** Builds a sealed package record with gate-passing defaults. */
export function makeRecord(
  kind: PackageKind,
  id: string,
  version: string,
  metadata?: Partial<PackageMetadata>,
): PackageRecord {
  const identity: Omit<PackageIdentity, 'contentDigest'> = {
    kind,
    id,
    version: semver(version),
  }
  const unsealed: UnsealedPackageRecord = {
    identity,
    metadata: makeMetadata(metadata),
  }
  return sealPackageRecord(unsealed)
}

/** The exact coordinate of a record. */
export function coordinateOf(record: PackageRecord): PackageCoordinate {
  return {
    kind: record.identity.kind,
    id: record.identity.id,
    version: record.identity.version,
    contentDigest: record.identity.contentDigest,
  }
}

/** A lineage node for a record's coordinate. */
export function nodeOf(record: PackageRecord): LineageNode {
  return makeLineageNode(coordinateOf(record))
}

/** Convenience: a dependency entry for fixture metadata. */
export function dependencyOn(id: string, constraint = '*') {
  return { id, constraint, kind: null, optional: false }
}

/** Re-seals a record after replacing parts of its metadata (fixture surgery). */
export function withMetadata(
  record: PackageRecord,
  overrides: Partial<PackageMetadata>,
): PackageRecord {
  return sealPackageRecord({
    identity: {
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
    },
    metadata: { ...record.metadata, ...overrides },
  })
}

/**
 * Returns a TAMPERED variant: the declared content digest is kept while
 * metadata is mutated, so the record fails package-system digest-integrity
 * validation (for fail-closed negative tests).
 */
export function tamperMetadata(
  record: PackageRecord,
  overrides: Partial<PackageMetadata>,
): PackageRecord {
  return { identity: record.identity, metadata: { ...record.metadata, ...overrides } }
}

/**
 * Deterministic in-memory {@link LineageStore} fake.
 *
 * - insertion-ordered Maps (no hidden nondeterminism);
 * - `putNode` is idempotent by content-addressed id;
 * - `putEdge` appends, skipping byte-identical duplicates.
 */
export function createInMemoryLineageStore(): LineageStore {
  const nodesById = new Map<string, LineageNode>()
  const edges: LineageEdge[] = []
  return {
    async putNode(node) {
      nodesById.set(node.nodeId, node)
    },
    async putEdge(edge) {
      const duplicate = edges.some(
        (existing) =>
          existing.kind === edge.kind &&
          existing.from === edge.from &&
          existing.to === edge.to,
      )
      if (!duplicate) {
        edges.push(edge)
      }
    },
    async getNode(nodeId) {
      return nodesById.get(nodeId) ?? null
    },
    async listNodes() {
      return [...nodesById.values()]
    },
    async listEdges() {
      return [...edges]
    },
    async edgesFrom(nodeId) {
      return edges.filter((edge) => edge.from === nodeId)
    },
    async edgesTo(nodeId) {
      return edges.filter((edge) => edge.to === nodeId)
    },
  }
}
