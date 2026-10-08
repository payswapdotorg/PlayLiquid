/**
 * Ports: the pure seams where lineage persistence/effects would live.
 *
 * The domain (lineage vocabulary, validators, fork/overlay/diff contracts)
 * is pure; {@link LineageStore} is the interface an adapter implements to
 * persist and query lineage facts (a Git-backed store, a registry-backed
 * store, a CAS store — all later work orders). This package ships only the
 * PORT plus deterministic in-memory fakes in `fixtures.ts` (house pattern:
 * not exported from the barrel).
 *
 * Pure interface only: no IO here, no timers, no global mutable state.
 */

import { computeLineageNodeId } from './lineage.ts'
import type { LineageEdge, LineageGraph, LineageNode, LineageNodeId } from './lineage.ts'

/**
 * The lineage persistence port. Implementations own IO; callers see a
 * deterministic, insertion-ordered read model. Node ids are
 * content-addressed, so `putNode` with an already-present id is an
 * idempotent overwrite of the identical value (content addressing makes
 * conflicting writes impossible short of a hash collision).
 */
export interface LineageStore {
  /** Records one lineage node (idempotent by content-addressed id). */
  putNode(node: LineageNode): Promise<void>
  /** Records one lineage edge (identical duplicates are idempotent). */
  putEdge(edge: LineageEdge): Promise<void>
  /** One node by id, or `null`. */
  getNode(nodeId: LineageNodeId): Promise<LineageNode | null>
  /** All nodes in insertion order. */
  listNodes(): Promise<readonly LineageNode[]>
  /** All edges in insertion order. */
  listEdges(): Promise<readonly LineageEdge[]>
  /** Edges whose `from` (child) is the given node, in insertion order. */
  edgesFrom(nodeId: LineageNodeId): Promise<readonly LineageEdge[]>
  /** Edges whose `to` (base) is the given node, in insertion order. */
  edgesTo(nodeId: LineageNodeId): Promise<readonly LineageEdge[]>
}

/** Options for {@link loadLineageGraph}. */
export interface LoadLineageGraphOptions {
  /**
   * When true (the default), nodes whose id is not the content address of
   * their coordinate are dropped instead of loaded (fail closed against
   * tampered ids — E5).
   */
  readonly dropTamperedNodes?: boolean
}

/** A node is tampered when its id is not the content address of its coordinate. */
function isTamperedNode(node: LineageNode): boolean {
  if (typeof node !== 'object' || node === null) {
    return true
  }
  return node.nodeId !== computeLineageNodeId(node.coordinate)
}

/**
 * Loads an immutable lineage graph snapshot from a store. Deterministic
 * given the store's read model; the only async seam in this package.
 *
 * With `dropTamperedNodes` (default), nodes carrying incoherent ids are
 * dropped and edges referencing dropped/unknown nodes are dropped with
 * them — a loaded graph is always coherent (validators then see only
 * well-formed facts; structural violations are still their job).
 */
export async function loadLineageGraph(
  store: LineageStore,
  options?: LoadLineageGraphOptions,
): Promise<LineageGraph> {
  const dropTampered = options?.dropTamperedNodes ?? true
  const nodes = await store.listNodes()
  const edges = await store.listEdges()
  const keptNodes = dropTampered
    ? nodes.filter((node) => !isTamperedNode(node))
    : [...nodes]
  const knownIds = new Set(keptNodes.map((node) => node.nodeId))
  const keptEdges = edges.filter(
    (edge) => knownIds.has(edge.from) && knownIds.has(edge.to),
  )
  return { nodes: keptNodes, edges: keptEdges }
}
