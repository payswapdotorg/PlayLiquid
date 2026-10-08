/**
 * Lineage graph core: the typed, immutable lineage vocabulary over
 * package-system package identities.
 *
 * Spec: spec/architecture.md "Git lifecycle" (forks, overlays, lineage) and
 * "Package Graph" ("Overlay packages are supported for narrow changes
 * without whole-package forks"); architecture-lock rule 34 — "Forks preserve
 * lineage".
 *
 * Design:
 * - A lineage NODE is one exact package coordinate; its content-addressed id
 *   is computed with package-system's digest machinery over the coordinate
 *   (which itself pins the package content digest), so node ids inherit
 *   content addressing from the package system — this package never hashes
 *   anything itself (E7: no parallel digest authority).
 * - A lineage EDGE is one derivation fact: `from` is the derivative (child),
 *   `to` is the base (ancestor). Edges are immutable values; graphs are
 *   plain immutable snapshots.
 * - Which package-kind pairs each edge kind admits is a FROZEN rule table
 *   (mirroring the architecture's fork/overlay split: forks are
 *   whole-package, overlays are narrow).
 *
 * Pure only: no IO, no git CLI, no filesystem, no network.
 */

import { computeDigest } from '@playliquid/package-system'
import { isContentDigest } from '@playliquid/package-system'
import type { PackageCoordinate } from '@playliquid/package-system'
import { isPackageCoordinate } from '@playliquid/package-system'

/** The lineage edge vocabulary (frozen; architecture "Git lifecycle"). */
export const LINEAGE_EDGE_KINDS = [
  'fork-of',
  'overlay-of',
  'derived-from',
  'rebased-on',
  'merged-from',
] as const

/** One kind of lineage edge. */
export type LineageEdgeKind = (typeof LINEAGE_EDGE_KINDS)[number]

/** Type guard: a member of the lineage edge vocabulary. */
export function isLineageEdgeKind(value: unknown): value is LineageEdgeKind {
  return (
    typeof value === 'string' &&
    (LINEAGE_EDGE_KINDS as readonly string[]).includes(value)
  )
}

/**
 * A lineage node id: a content digest (`sha256:<64 hex>`) computed by
 * package-system's digest machinery over the node's package coordinate.
 */
export type LineageNodeId = string

/** Domain-separation tag for lineage node ids (collision-safe namespace). */
const LINEAGE_NODE_TAG = 'playliquid:lineage-node:1'

/**
 * Computes the content-addressed id of a lineage node: package-system's
 * SHA-256-over-canonical-JSON of `{ tag, coordinate }`. Because the
 * coordinate pins the package's own content digest, the node id is
 * transitively content-addressed (E5/E7 — digest authority stays with
 * package-system).
 */
export function computeLineageNodeId(coordinate: PackageCoordinate): LineageNodeId {
  return computeDigest({ tag: LINEAGE_NODE_TAG, coordinate })
}

/** Type guard: a well-formed lineage node id. */
export function isLineageNodeId(value: unknown): value is LineageNodeId {
  return isContentDigest(value)
}

/** One node in the lineage graph: an exact package coordinate plus its id. */
export interface LineageNode {
  readonly coordinate: PackageCoordinate
  readonly nodeId: LineageNodeId
}

/** Builds a lineage node, deriving its content-addressed id. */
export function makeLineageNode(coordinate: PackageCoordinate): LineageNode {
  return { coordinate, nodeId: computeLineageNodeId(coordinate) }
}

/**
 * Type guard: a structurally valid lineage node whose id is the content
 * address of its own coordinate (tampered ids fail — E5 immutability).
 */
export function isLineageNode(value: unknown): value is LineageNode {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<LineageNode>
  if (!isPackageCoordinate(candidate.coordinate)) {
    return false
  }
  return candidate.nodeId === computeLineageNodeId(candidate.coordinate)
}

/** One derivation fact: `from` derives from `to`. */
export interface LineageEdge {
  readonly kind: LineageEdgeKind
  /** The derivative (child) node. */
  readonly from: LineageNodeId
  /** The base (ancestor) node. */
  readonly to: LineageNodeId
}

/** Type guard: a structurally valid lineage edge. */
export function isLineageEdge(value: unknown): value is LineageEdge {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<LineageEdge>
  return (
    isLineageEdgeKind(candidate.kind) &&
    isLineageNodeId(candidate.from) &&
    isLineageNodeId(candidate.to)
  )
}

/** An immutable lineage graph snapshot: its nodes and edges. */
export interface LineageGraph {
  readonly nodes: readonly LineageNode[]
  readonly edges: readonly LineageEdge[]
}

/** Frozen per-edge-kind rules (the fork/overlay split, as data). */
export interface EdgeKindRule {
  readonly kind: LineageEdgeKind
  /** Child kind must equal base kind (whole-package lines). */
  readonly sameKind: boolean
  /** Child id must equal base id (one package line only). */
  readonly sameId: boolean
  /** Neither side may be an overlay package. */
  readonly forbidsOverlay: boolean
  /** The child must be an overlay package. */
  readonly childIsOverlay: boolean
}

/**
 * The frozen edge rule table.
 *
 * - `fork-of` — whole-package fork: same kind as the base, any id (a fork
 *   may be renamed into the forker's scope), never an overlay on either
 *   side (narrow changes are overlays, not forks).
 * - `overlay-of` — narrow change: the child is an overlay package; the base
 *   is any non-overlay package kind (overlays do not stack on overlays).
 * - `derived-from` — generic semantic derivation (port/transform): a full
 *   package derived from a full package; kinds may differ.
 * - `rebased-on` — a package line rebased onto a newer base of the SAME
 *   package id and kind.
 * - `merged-from` — merge result of same-kind package lines (ids may differ
 *   because forks may be renamed).
 */
export const LINEAGE_EDGE_RULES: Readonly<
  Record<LineageEdgeKind, EdgeKindRule>
> = Object.freeze({
  'fork-of': {
    kind: 'fork-of',
    sameKind: true,
    sameId: false,
    forbidsOverlay: true,
    childIsOverlay: false,
  },
  'overlay-of': {
    kind: 'overlay-of',
    sameKind: false,
    sameId: false,
    forbidsOverlay: true,
    childIsOverlay: true,
  },
  'derived-from': {
    kind: 'derived-from',
    sameKind: false,
    sameId: false,
    forbidsOverlay: true,
    childIsOverlay: false,
  },
  'rebased-on': {
    kind: 'rebased-on',
    sameKind: true,
    sameId: true,
    forbidsOverlay: true,
    childIsOverlay: false,
  },
  'merged-from': {
    kind: 'merged-from',
    sameKind: true,
    sameId: false,
    forbidsOverlay: true,
    childIsOverlay: false,
  },
})

/** Violation codes produced by the frozen edge rule table. */
export type EdgeRuleCode =
  | 'overlay-base-forbidden'
  | 'fork-kind-mismatch'
  | 'illegal-edge'

/** One edge-rule violation. */
export interface EdgeRuleViolation {
  readonly code: EdgeRuleCode
  readonly message: string
}

/**
 * Checks one (child, base) pair against the frozen rule table for an edge
 * kind. Pure; returns `null` when the pair is legal.
 */
export function checkEdgeRule(
  kind: LineageEdgeKind,
  child: LineageNode,
  base: LineageNode,
): EdgeRuleViolation | null {
  const rule = LINEAGE_EDGE_RULES[kind]
  const childKind = child.coordinate.kind
  const baseKind = base.coordinate.kind
  if (rule.childIsOverlay && childKind !== 'overlay') {
    return {
      code: 'illegal-edge',
      message: `overlay-of child must be an overlay package, but ${child.coordinate.id} is a ${childKind} package`,
    }
  }
  if (rule.forbidsOverlay) {
    if (baseKind === 'overlay') {
      if (kind === 'overlay-of') {
        return {
          code: 'overlay-base-forbidden',
          message: `overlays may only attach to overlay-legal (non-overlay) bases, but the base ${base.coordinate.id} is itself an overlay package`,
        }
      }
      return {
        code: 'illegal-edge',
        message: `${kind} cannot use an overlay package (${base.coordinate.id}) as its base; narrow changes compose through the overlay's own base`,
      }
    }
    if (!rule.childIsOverlay && childKind === 'overlay') {
      return {
        code: 'illegal-edge',
        message: `overlay package ${child.coordinate.id} may only participate in lineage as an overlay-of child`,
      }
    }
  }
  if (rule.sameKind && childKind !== baseKind) {
    if (kind === 'fork-of') {
      return {
        code: 'fork-kind-mismatch',
        message: `forks are whole-package: fork kind ${childKind} must equal base kind ${baseKind}`,
      }
    }
    return {
      code: 'illegal-edge',
      message: `${kind} requires child and base of the same package kind, but ${child.coordinate.id} (${childKind}) and ${base.coordinate.id} (${baseKind}) differ`,
    }
  }
  if (rule.sameId && child.coordinate.id !== base.coordinate.id) {
    return {
      code: 'illegal-edge',
      message: `${kind} stays within one package id, but ${child.coordinate.id} and ${base.coordinate.id} differ`,
    }
  }
  return null
}

/** Finds a node by id in a graph snapshot. */
export function findNode(
  graph: LineageGraph,
  nodeId: LineageNodeId,
): LineageNode | null {
  return graph.nodes.find((node) => node.nodeId === nodeId) ?? null
}

/** All edges whose `from` (child) is the given node, in declaration order. */
export function edgesFrom(
  graph: LineageGraph,
  nodeId: LineageNodeId,
): readonly LineageEdge[] {
  return graph.edges.filter((edge) => edge.from === nodeId)
}

/** All edges whose `to` (base) is the given node, in declaration order. */
export function edgesTo(
  graph: LineageGraph,
  nodeId: LineageNodeId,
): readonly LineageEdge[] {
  return graph.edges.filter((edge) => edge.to === nodeId)
}
