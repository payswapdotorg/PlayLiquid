import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLineageNodeId } from './lineage.ts'
import type { LineageEdge, LineageGraph, LineageNode } from './lineage.ts'
import { loadLineageGraph } from './ports.ts'
import { createInMemoryLineageStore, makeRecord, nodeOf } from './fixtures.ts'

const baseWorld = makeRecord('world', '@demo/arena-world', '2.1.0')
const forkWorld = makeRecord('world', '@fork/hardened-arena', '1.0.0')
const overlayPkg = makeRecord('overlay', '@demo/arena-tuning', '0.1.0')

const baseNode = nodeOf(baseWorld)
const forkNode = nodeOf(forkWorld)
const overlayNode = nodeOf(overlayPkg)

const forkEdge: LineageEdge = { kind: 'fork-of', from: forkNode.nodeId, to: baseNode.nodeId }
const overlayEdge: LineageEdge = { kind: 'overlay-of', from: overlayNode.nodeId, to: baseNode.nodeId }

test('in-memory store: put/get/list with insertion order and idempotency', async () => {
  const store = createInMemoryLineageStore()
  await store.putNode(baseNode)
  await store.putNode(forkNode)
  await store.putNode(baseNode) // idempotent by content-addressed id

  assert.deepEqual(await store.getNode(baseNode.nodeId), baseNode)
  assert.equal(await store.getNode(computeLineageNodeId(forkNode.coordinate)), forkNode)
  assert.equal(
    await store.getNode('sha256:' + '0'.repeat(64)),
    null,
  )
  assert.deepEqual(await store.listNodes(), [baseNode, forkNode])

  await store.putEdge(forkEdge)
  await store.putEdge(forkEdge) // identical duplicate is a no-op
  await store.putEdge(overlayEdge)
  assert.deepEqual(await store.listEdges(), [forkEdge, overlayEdge])
  assert.deepEqual(await store.edgesFrom(forkNode.nodeId), [forkEdge])
  assert.deepEqual(await store.edgesTo(baseNode.nodeId), [forkEdge, overlayEdge])
  assert.deepEqual(await store.edgesFrom(baseNode.nodeId), [])
})

test('in-memory store is deterministic across identical runs', async () => {
  async function build(): Promise<LineageGraph> {
    const store = createInMemoryLineageStore()
    await store.putNode(baseNode)
    await store.putNode(forkNode)
    await store.putEdge(forkEdge)
    return loadLineageGraph(store)
  }
  assert.deepEqual(await build(), await build())
})

test('loadLineageGraph round-trips a store into a coherent snapshot', async () => {
  const store = createInMemoryLineageStore()
  for (const node of [baseNode, forkNode, overlayNode]) {
    await store.putNode(node)
  }
  for (const edge of [forkEdge, overlayEdge]) {
    await store.putEdge(edge)
  }
  const graph = await loadLineageGraph(store)
  assert.deepEqual(graph.nodes, [baseNode, forkNode, overlayNode])
  assert.deepEqual(graph.edges, [forkEdge, overlayEdge])
})

test('loadLineageGraph drops tampered nodes and their edges (fail closed)', async () => {
  const store = createInMemoryLineageStore()
  const tampered: LineageNode = {
    coordinate: overlayNode.coordinate,
    // a digest-shaped id that is NOT the content address of the coordinate
    nodeId: `sha256:${'ff'.repeat(32)}`,
  }
  await store.putNode(baseNode)
  await store.putNode(forkNode)
  await store.putNode(tampered)
  await store.putEdge(forkEdge)
  await store.putEdge({ kind: 'overlay-of', from: tampered.nodeId, to: baseNode.nodeId })

  const graph = await loadLineageGraph(store)
  assert.deepEqual(graph.nodes, [baseNode, forkNode])
  // the edge from the dropped tampered node is dropped with it
  assert.deepEqual(graph.edges, [forkEdge])

  // with dropTamperedNodes: false, everything is loaded as-is
  const raw = await loadLineageGraph(store, { dropTamperedNodes: false })
  assert.equal(raw.nodes.length, 3)
  assert.equal(raw.edges.length, 2)
})

test('edges to unknown nodes are dropped by the loader', async () => {
  const store = createInMemoryLineageStore()
  await store.putNode(baseNode)
  await store.putEdge({ kind: 'fork-of', from: forkNode.nodeId, to: baseNode.nodeId })
  // forkNode was never put: the edge references an unknown node
  const graph = await loadLineageGraph(store)
  assert.deepEqual(graph.nodes, [baseNode])
  assert.deepEqual(graph.edges, [])
})
