/**
 * Lineage validation: pure validators over lineage graph snapshots, plus
 * the R19 provenance/license gate SHAPES carried along derivation chains.
 *
 * Spec: spec/architecture.md "Git lifecycle"; architecture-lock rule 34 —
 * "Forks preserve lineage"; requirements R19 — "Provenance/licensing is a
 * release/build gate" (enforcement stays at release-gate time; this module
 * produces typed VERDICT RECORDS only); E5/E10 — lineage records are
 * immutable, content-addressed values and historical evidence is never
 * rewritten (validators are pure functions over snapshots).
 *
 * Checks, in fixed order (deterministic output):
 * 1. node shape, id/coordinate coherence, duplicates;
 * 2. per-edge: known edge kind, well-formed endpoints, known endpoints
 *    (edges must reference known digests), no self-edges, frozen edge-kind
 *    rules (the fork/overlay split);
 * 3. acyclicity (deterministic DFS; each distinct cycle reported once);
 * 4. chain provenance/license verdicts ({@link checkLineageProvenance}),
 *    which reuse package-system's release gate per record and add the
 *    cross-node facts only the lineage layer can see (graph/record lineage
 *    consistency, base-vs-child license relationship).
 *
 * Pure only.
 */

import type { PackageRecord } from '@playliquid/package-system'
import type { PackageCoordinate } from '@playliquid/package-system'
import { formatSemver, isPackageCoordinate } from '@playliquid/package-system'
import { checkReleaseGate } from '@playliquid/package-system'
import type { ReleaseGateResult } from '@playliquid/package-system'
import { checkEdgeRule, computeLineageNodeId, edgesFrom } from './lineage.ts'
import type {
  LineageEdge,
  LineageGraph,
  LineageNode,
  LineageNodeId,
} from './lineage.ts'
import { isLineageEdgeKind, isLineageNodeId } from './lineage.ts'

/** Violation codes produced by lineage graph validation. */
export type LineageValidationCode =
  | 'invalid-node'
  | 'node-id-mismatch'
  | 'duplicate-node'
  | 'unknown-edge-kind'
  | 'invalid-edge'
  | 'unknown-node'
  | 'self-edge'
  | 'overlay-base-forbidden'
  | 'fork-kind-mismatch'
  | 'illegal-edge'
  | 'cycle'

/** One lineage graph violation. */
export interface LineageViolation {
  readonly code: LineageValidationCode
  readonly message: string
  readonly nodeId?: LineageNodeId
  readonly edgeIndex?: number
  /** For cycles: the path, start repeated at the end. */
  readonly cyclePath?: readonly LineageNodeId[]
}

/**
 * Validates a lineage graph snapshot. Pure and total; an empty violation
 * list means the graph is structurally sound, references only known
 * digests, obeys the frozen edge rules and is cycle-free.
 */
export function validateLineageGraph(
  graph: LineageGraph,
): readonly LineageViolation[] {
  const violations: LineageViolation[] = []
  if (graph === null || typeof graph !== 'object') {
    return [{ code: 'invalid-node', message: 'lineage graph is not an object' }]
  }
  // Array.isArray narrows readonly arrays to any[]; restore the typed views.
  const nodes = (Array.isArray(graph.nodes) ? graph.nodes : []) as readonly LineageNode[]
  const edges = (Array.isArray(graph.edges) ? graph.edges : []) as readonly LineageEdge[]
  const byId = new Map<LineageNodeId, LineageNode>()
  const seenIds = new Set<LineageNodeId>()
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (typeof node !== 'object' || node === null || !isPackageCoordinate(node.coordinate)) {
      violations.push({
        code: 'invalid-node',
        message: `node at index ${index} has a malformed package coordinate`,
      })
      continue
    }
    if (node.nodeId !== computeLineageNodeId(node.coordinate)) {
      violations.push({
        code: 'node-id-mismatch',
        message: `node ${node.coordinate.id} carries a node id that is not the content address of its own coordinate (tampered or mis-computed)`,
        nodeId: node.nodeId,
      })
    }
    byId.set(node.nodeId, node)
    if (seenIds.has(node.nodeId)) {
      violations.push({
        code: 'duplicate-node',
        message: `node id ${node.nodeId} is declared more than once`,
        nodeId: node.nodeId,
      })
    }
    seenIds.add(node.nodeId)
  }
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index]
    if (typeof edge !== 'object' || edge === null || !isLineageEdgeKind(edge.kind)) {
      violations.push({
        code: 'unknown-edge-kind',
        message: `edge at index ${index} has unknown kind: ${String(edge?.kind)}`,
        edgeIndex: index,
      })
      continue
    }
    if (!isLineageNodeId(edge.from) || !isLineageNodeId(edge.to)) {
      violations.push({
        code: 'invalid-edge',
        message: `edge at index ${index} has malformed node ids`,
        edgeIndex: index,
      })
      continue
    }
    const child = byId.get(edge.from)
    const base = byId.get(edge.to)
    if (child === undefined || base === undefined) {
      const missing = child === undefined ? edge.from : edge.to
      violations.push({
        code: 'unknown-node',
        message: `edge ${edge.kind} references unknown digest/node id ${missing}; edges may only connect declared nodes`,
        nodeId: missing,
        edgeIndex: index,
      })
      continue
    }
    if (edge.from === edge.to) {
      violations.push({
        code: 'self-edge',
        message: `edge at index ${index} is a self-edge on ${edge.from}`,
        nodeId: edge.from,
        edgeIndex: index,
      })
      continue
    }
    const ruleViolation = checkEdgeRule(edge.kind, child, base)
    if (ruleViolation !== null) {
      violations.push({
        code: ruleViolation.code,
        message: ruleViolation.message,
        edgeIndex: index,
      })
    }
  }
  for (const cycle of findCycles(nodes, edges)) {
    violations.push({
      code: 'cycle',
      message: `lineage graph contains a cycle: ${cycle.join(' -> ')}`,
      cyclePath: cycle,
    })
  }
  return violations
}

/**
 * Deterministic cycle detection over declared nodes in declaration order
 * and edges in declaration order (iterative DFS, three colors). Self-edges
 * are excluded (reported separately as `self-edge`). Each distinct cycle is
 * reported once, keyed by its member set.
 */
function findCycles(
  nodes: readonly LineageNode[],
  edges: readonly LineageEdge[],
): readonly (readonly LineageNodeId[])[] {
  const adjacency = new Map<LineageNodeId, LineageNodeId[]>()
  for (const node of nodes) {
    if (typeof node === 'object' && node !== null) {
      adjacency.set(node.nodeId, [])
    }
  }
  for (const edge of edges) {
    if (typeof edge !== 'object' || edge === null) {
      continue
    }
    if (edge.from === edge.to) {
      continue
    }
    adjacency.get(edge.from)?.push(edge.to)
  }
  const color = new Map<LineageNodeId, 1 | 2>()
  const path: LineageNodeId[] = []
  const seenCycleKeys = new Set<string>()
  const cycles: (readonly LineageNodeId[])[] = []
  for (const start of adjacency.keys()) {
    if (color.has(start)) {
      continue
    }
    const frames: { id: LineageNodeId; next: number }[] = [{ id: start, next: 0 }]
    color.set(start, 1)
    path.push(start)
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      if (frame === undefined) {
        break
      }
      const neighbors = adjacency.get(frame.id) ?? []
      if (frame.next >= neighbors.length) {
        color.set(frame.id, 2)
        path.pop()
        frames.pop()
        continue
      }
      const next = neighbors[frame.next]
      frame.next += 1
      if (next === undefined) {
        continue
      }
      if (color.get(next) === 1) {
        const startAt = path.indexOf(next)
        const cycle = [...path.slice(startAt), next]
        const key = [...new Set(cycle)].sort().join('\u0000')
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key)
          cycles.push(cycle)
        }
      } else if (!color.has(next)) {
        color.set(next, 1)
        path.push(next)
        frames.push({ id: next, next: 0 })
      }
    }
  }
  return cycles
}

/** The verdict of comparing a derivative's license state with its base's. */
export type LicenseCompatibilityVerdict =
  | { readonly verdict: 'compatible'; readonly base: string; readonly child: string }
  | { readonly verdict: 'divergent'; readonly base: string; readonly child: string }
  | {
      readonly verdict: 'incompatible'
      readonly base: string
      readonly child: string
      readonly reasons: readonly ('base-unverified' | 'child-unverified')[]
    }

function licenseOf(record: PackageRecord): { expression: string; verified: boolean } {
  const license = record?.metadata?.license
  return {
    expression: typeof license?.spdxExpression === 'string' ? license.spdxExpression : '',
    verified: license?.status === 'verified',
  }
}

/**
 * Compares the license/rights states of a derivative and its base, as a
 * TYPED RECORD (R19): `compatible` (both verified, same expression),
 * `divergent` (both verified, expressions differ — legitimate relicensing,
 * recorded for the release gate to adjudicate) or `incompatible` (at least
 * one side unverified — fail-closed signal). This contract layer performs
 * no SPDX algebra; enforcement lives at release-gate time.
 */
export function checkLicenseCompatibility(
  base: PackageRecord,
  child: PackageRecord,
): LicenseCompatibilityVerdict {
  const baseLicense = licenseOf(base)
  const childLicense = licenseOf(child)
  if (!baseLicense.verified || !childLicense.verified) {
    const reasons: ('base-unverified' | 'child-unverified')[] = []
    if (!baseLicense.verified) {
      reasons.push('base-unverified')
    }
    if (!childLicense.verified) {
      reasons.push('child-unverified')
    }
    return {
      verdict: 'incompatible',
      base: baseLicense.expression,
      child: childLicense.expression,
      reasons,
    }
  }
  if (baseLicense.expression !== childLicense.expression) {
    return {
      verdict: 'divergent',
      base: baseLicense.expression,
      child: childLicense.expression,
    }
  }
  return {
    verdict: 'compatible',
    base: baseLicense.expression,
    child: childLicense.expression,
  }
}

/** Reason codes a lineage provenance verdict can carry. */
export type LineageProvenanceReasonCode =
  | 'unknown-record'
  | 'release-gate-failed'
  | 'lineage-mismatch'
  | 'license-unverified'
  | 'license-divergent'

/** One reason inside a provenance verdict. */
export interface LineageProvenanceReason {
  readonly code: LineageProvenanceReasonCode
  readonly message: string
  /** For `release-gate-failed`: package-system's own gate result. */
  readonly gate?: ReleaseGateResult
  /** For license reasons: the typed compatibility verdict. */
  readonly license?: LicenseCompatibilityVerdict
}

/**
 * The R19 gate shape for one derivative node: does its chain carry
 * complete provenance/license evidence? Typed verdict record only —
 * enforcement lives at release-gate time.
 */
export interface LineageProvenanceVerdict {
  readonly nodeId: LineageNodeId
  readonly coordinate: PackageCoordinate
  /**
   * False when any hard reason is present (unknown-record,
   * release-gate-failed, lineage-mismatch, license-unverified).
   * `license-divergent` is recorded without failing: relicensing is
   * legitimate and adjudicated at the gate.
   */
  readonly pass: boolean
  readonly reasons: readonly LineageProvenanceReason[]
}

function coordinateKey(coordinate: PackageCoordinate): string {
  return `${coordinate.kind}\u0000${coordinate.id}\u0000${formatSemver(coordinate.version)}\u0000${coordinate.contentDigest}`
}

function coordinatesEqual(a: PackageCoordinate, b: PackageCoordinate): boolean {
  return coordinateKey(a) === coordinateKey(b)
}

/**
 * Produces the R19 provenance/license verdict for every DERIVATIVE node of
 * a lineage graph (nodes with at least one incoming edge), given the
 * package records for the graph's coordinates.
 *
 * Per derivative:
 * - its own record must be present and must pass package-system's release
 *   gate (reused seam — this layer adds no second gate);
 * - its record-carried `lineage.parent` must match one of its incoming
 *   edge bases (graph/record consistency — lock rule 34);
 * - every base record's license state is compared with the child's
 *   ({@link checkLicenseCompatibility}); unverified bases fail closed,
 *   divergent expressions are recorded for the gate.
 *
 * Pure and total; verdict order follows node declaration order.
 */
export function checkLineageProvenance(
  graph: LineageGraph,
  records: readonly PackageRecord[],
): readonly LineageProvenanceVerdict[] {
  const recordByCoordinate = new Map<string, PackageRecord>()
  for (const record of records) {
    const identity = record?.identity
    if (
      typeof identity?.id === 'string' &&
      typeof identity.kind === 'string' &&
      typeof identity.contentDigest === 'string'
    ) {
      recordByCoordinate.set(coordinateKey(identity as PackageCoordinate), record)
    }
  }
  const verdicts: LineageProvenanceVerdict[] = []
  for (const node of graph.nodes) {
    if (typeof node !== 'object' || node === null) {
      continue
    }
    // Derivation edges where THIS node is the child (edge.from).
    const derivations = edgesFrom(graph, node.nodeId)
    if (derivations.length === 0) {
      continue
    }
    const reasons: LineageProvenanceReason[] = []
    const record = recordByCoordinate.get(coordinateKey(node.coordinate))
    if (record === undefined) {
      reasons.push({
        code: 'unknown-record',
        message: `no package record was supplied for ${node.coordinate.id}; provenance evidence cannot be evaluated`,
      })
    } else {
      const gate = checkReleaseGate(record)
      if (!gate.pass) {
        reasons.push({
          code: 'release-gate-failed',
          message: `the derivative's own package record fails the package-system release gate (R19)`,
          gate,
        })
      }
      const parent = record.metadata?.lineage?.parent ?? null
      if (parent === null) {
        reasons.push({
          code: 'lineage-mismatch',
          message: `derivative ${node.coordinate.id} does not retain its lineage parent (lock rule 34)`,
        })
      } else if (!derivations.some((edge) => {
        const base = graph.nodes.find((candidate) => candidate.nodeId === edge.to)
        return base !== undefined && coordinatesEqual(base.coordinate, parent)
      })) {
        reasons.push({
          code: 'lineage-mismatch',
          message: `derivative ${node.coordinate.id} records a lineage parent that none of its incoming lineage edges carries`,
        })
      }
    }
    for (const edge of derivations) {
      const baseNode = graph.nodes.find((candidate) => candidate.nodeId === edge.to)
      const baseRecord =
        baseNode === undefined
          ? undefined
          : recordByCoordinate.get(coordinateKey(baseNode.coordinate))
      if (baseRecord === undefined) {
        reasons.push({
          code: 'unknown-record',
          message: `no package record was supplied for the ${edge.kind} base of ${node.coordinate.id}`,
        })
        continue
      }
      if (record !== undefined) {
        const compatibility = checkLicenseCompatibility(baseRecord, record)
        if (compatibility.verdict === 'incompatible') {
          reasons.push({
            code: 'license-unverified',
            message: `license evidence along the ${edge.kind} chain of ${node.coordinate.id} is unverified (R19 fail-closed)`,
            license: compatibility,
          })
        } else if (compatibility.verdict === 'divergent') {
          reasons.push({
            code: 'license-divergent',
            message: `${node.coordinate.id} relicenses its ${edge.kind} base (${compatibility.base} -> ${compatibility.child}); recorded for the release gate`,
            license: compatibility,
          })
        }
      }
    }
    const hardFail = reasons.some((reason) => reason.code !== 'license-divergent')
    verdicts.push({
      nodeId: node.nodeId,
      coordinate: node.coordinate,
      pass: !hardFail,
      reasons,
    })
  }
  return verdicts
}
