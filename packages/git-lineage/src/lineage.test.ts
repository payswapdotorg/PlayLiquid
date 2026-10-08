import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDigest } from '@playliquid/package-system'
import {
  LINEAGE_EDGE_KINDS,
  LINEAGE_EDGE_RULES,
  checkEdgeRule,
  computeLineageNodeId,
  edgesFrom,
  edgesTo,
  findNode,
  isLineageEdge,
  isLineageEdgeKind,
  isLineageNode,
  isLineageNodeId,
  makeLineageNode,
} from './lineage.ts'
import { coordinateOf, makeRecord, nodeOf } from './fixtures.ts'
import type { LineageGraph } from './lineage.ts'

const baseWorld = makeRecord('world', '@demo/arena-world', '2.1.0')
const forkWorld = makeRecord('world', '@fork/hardened-arena', '1.0.0')
const overlayPkg = makeRecord('overlay', '@demo/arena-tuning', '0.1.0')
const assetsPkg = makeRecord('assets', '@demo/base-assets', '1.4.2')
const combatSystem = makeRecord('system', '@demo/combat-system', '0.3.1')
const sameIdOtherVersion = makeRecord('world', '@fork/hardened-arena', '1.1.0')

const baseNode = nodeOf(baseWorld)
const forkNode = nodeOf(forkWorld)
const overlayNode = nodeOf(overlayPkg)
const assetsNode = nodeOf(assetsPkg)
const systemNode = nodeOf(combatSystem)
const rebasedNode = nodeOf(sameIdOtherVersion)

test('LINEAGE_EDGE_KINDS is the frozen architecture vocabulary', () => {
  assert.deepEqual([...LINEAGE_EDGE_KINDS], [
    'fork-of',
    'overlay-of',
    'derived-from',
    'rebased-on',
    'merged-from',
  ])
  for (const kind of LINEAGE_EDGE_KINDS) {
    assert.equal(isLineageEdgeKind(kind), true)
    assert.ok(LINEAGE_EDGE_RULES[kind] !== undefined)
  }
  assert.equal(isLineageEdgeKind('parent-of'), false)
  assert.equal(isLineageEdgeKind('fork'), false)
  assert.equal(isLineageEdgeKind(null), false)
})

test('computeLineageNodeId is deterministic and value-dependent only', () => {
  const coordinate = coordinateOf(baseWorld)
  const first = computeLineageNodeId(coordinate)
  assert.equal(computeLineageNodeId(coordinate), first)
  // Key insertion order must not matter (canonical JSON under the hood).
  const reordered = {
    contentDigest: coordinate.contentDigest,
    version: coordinate.version,
    id: coordinate.id,
    kind: coordinate.kind,
  }
  assert.equal(computeLineageNodeId(reordered), first)
  // A different package content produces a different node id.
  assert.notEqual(computeLineageNodeId(coordinateOf(forkWorld)), first)
  // Node ids are content digests (package-system authority).
  assert.equal(isLineageNodeId(first), true)
  assert.equal(isLineageNodeId('not-a-digest'), false)
})

test('makeLineageNode and isLineageNode: tampered ids fail (E5)', () => {
  const node = makeLineageNode(coordinateOf(baseWorld))
  assert.equal(isLineageNode(node), true)
  assert.equal(
    isLineageNode({ coordinate: node.coordinate, nodeId: computeDigest({ evil: true }) }),
    false,
  )
  assert.equal(isLineageNode({ coordinate: null, nodeId: node.nodeId }), false)
  assert.equal(isLineageNode(null), false)
  // The same coordinate always rebuilds the same node.
  assert.deepEqual(makeLineageNode(coordinateOf(baseWorld)), node)
})

test('isLineageEdge validates shape', () => {
  assert.equal(
    isLineageEdge({ kind: 'fork-of', from: baseNode.nodeId, to: forkNode.nodeId }),
    true,
  )
  assert.equal(isLineageEdge({ kind: 'parent-of', from: baseNode.nodeId, to: forkNode.nodeId }), false)
  assert.equal(isLineageEdge({ kind: 'fork-of', from: 'sha256:bad', to: forkNode.nodeId }), false)
  assert.equal(isLineageEdge(null), false)
})

test('edge rules: legal pairs pass with no violation', () => {
  assert.equal(checkEdgeRule('fork-of', forkNode, baseNode), null)
  assert.equal(checkEdgeRule('overlay-of', overlayNode, baseNode), null)
  assert.equal(checkEdgeRule('derived-from', systemNode, assetsNode), null)
  assert.equal(checkEdgeRule('rebased-on', rebasedNode, forkNode), null)
  assert.equal(checkEdgeRule('merged-from', baseNode, forkNode), null)
})

test('edge rules: fork-of must be whole-package (same kind, no overlays)', () => {
  const kindMismatch = checkEdgeRule('fork-of', systemNode, baseNode)
  assert.ok(kindMismatch !== null)
  assert.equal(kindMismatch.code, 'fork-kind-mismatch')
  const overlayBase = checkEdgeRule('fork-of', forkNode, overlayNode)
  assert.ok(overlayBase !== null)
  assert.equal(overlayBase.code, 'illegal-edge')
})

test('edge rules: overlay-of child must be an overlay, base must not be', () => {
  const childNotOverlay = checkEdgeRule('overlay-of', forkNode, baseNode)
  assert.ok(childNotOverlay !== null)
  assert.equal(childNotOverlay.code, 'illegal-edge')
  const overlayOnOverlay = checkEdgeRule('overlay-of', overlayNode, nodeOf(makeRecord('overlay', '@demo/other-overlay', '0.2.0')))
  assert.ok(overlayOnOverlay !== null)
  assert.equal(overlayOnOverlay.code, 'overlay-base-forbidden')
})

test('edge rules: derived-from/rebased-on/merged-from constraints', () => {
  // derived-from rejects overlay packages on either side
  const overlayChild = checkEdgeRule('derived-from', overlayNode, baseNode)
  assert.ok(overlayChild !== null)
  assert.equal(overlayChild.code, 'illegal-edge')
  const overlayBase = checkEdgeRule('derived-from', forkNode, overlayNode)
  assert.ok(overlayBase !== null)
  assert.equal(overlayBase.code, 'illegal-edge')
  // rebased-on stays within one package id
  const idMismatch = checkEdgeRule('rebased-on', rebasedNode, baseNode)
  assert.ok(idMismatch !== null)
  assert.equal(idMismatch.code, 'illegal-edge')
  // merged-from requires same kind
  const mergedMismatch = checkEdgeRule('merged-from', systemNode, baseNode)
  assert.ok(mergedMismatch !== null)
  assert.equal(mergedMismatch.code, 'illegal-edge')
})

test('findNode/edgesFrom/edgesTo read the graph in declaration order', () => {
  const graph: LineageGraph = {
    nodes: [baseNode, forkNode, overlayNode],
    edges: [
      { kind: 'fork-of', from: forkNode.nodeId, to: baseNode.nodeId },
      { kind: 'overlay-of', from: overlayNode.nodeId, to: baseNode.nodeId },
    ],
  }
  assert.deepEqual(findNode(graph, forkNode.nodeId), forkNode)
  assert.equal(findNode(graph, computeDigest({ absent: true })), null)
  assert.equal(edgesFrom(graph, forkNode.nodeId).length, 1)
  assert.equal(edgesFrom(graph, baseNode.nodeId).length, 0)
  assert.equal(edgesTo(graph, baseNode.nodeId).length, 2)
  assert.deepEqual(
    edgesTo(graph, baseNode.nodeId).map((edge) => edge.kind),
    ['fork-of', 'overlay-of'],
  )
})
