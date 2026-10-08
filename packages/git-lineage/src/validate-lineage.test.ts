import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkLicenseCompatibility,
  checkLineageProvenance,
  validateLineageGraph,
} from './validate-lineage.ts'
import type { LineageGraph } from './index.ts'
import { computeLineageNodeId, makeLineageNode } from './lineage.ts'
import type { LineageEdge, LineageNode } from './lineage.ts'
import {
  coordinateOf,
  makeRecord,
  nodeOf,
  withMetadata,
} from './fixtures.ts'

const BASE_COMMIT = '0123456789abcdef0123456789abcdef01234567'

const baseWorld = makeRecord('world', '@demo/arena-world', '2.1.0')

function derivativeOf(
  id: string,
  version: string,
  base = baseWorld,
  extra = {},
) {
  return makeRecord('world', id, version, {
    provenance: {
      origin: { type: 'package', coordinate: coordinateOf(base) },
      sourceCommit: BASE_COMMIT,
      transformationHistory: [
        { kind: 'derive', description: `derivative of ${base.identity.id}` },
      ],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: coordinateOf(base), parent: coordinateOf(base) },
    ...extra,
  })
}

const forkWorld = derivativeOf('@fork/hardened-arena', '1.0.0')
const rebasedFork = makeRecord('world', '@fork/hardened-arena', '1.1.0', {
  provenance: {
    origin: { type: 'package', coordinate: coordinateOf(baseWorld) },
    sourceCommit: BASE_COMMIT,
    transformationHistory: [
      { kind: 'derive', description: 'rebased derivative' },
    ],
    modelProvenance: [],
    generatedByAi: false,
  },
  lineage: { origin: coordinateOf(baseWorld), parent: coordinateOf(forkWorld) },
})

function edge(
  kind: LineageEdge['kind'],
  child: LineageNode,
  base: LineageNode,
): LineageEdge {
  return { kind, from: child.nodeId, to: base.nodeId }
}

test('a sound lineage graph validates clean', () => {
  const overlayPkg = makeRecord('overlay', '@demo/arena-tuning', '0.1.0', {
    provenance: {
      origin: { type: 'package', coordinate: coordinateOf(baseWorld) },
      sourceCommit: BASE_COMMIT,
      transformationHistory: [{ kind: 'overlay', description: 'tuning overlay' }],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: coordinateOf(baseWorld), parent: coordinateOf(baseWorld) },
  })
  const graph: LineageGraph = {
    nodes: [baseWorld, forkWorld, rebasedFork, overlayPkg].map(nodeOf),
    edges: [
      edge('fork-of', nodeOf(forkWorld), nodeOf(baseWorld)),
      edge('rebased-on', nodeOf(rebasedFork), nodeOf(forkWorld)),
      edge('overlay-of', nodeOf(overlayPkg), nodeOf(baseWorld)),
    ],
  }
  assert.deepEqual(validateLineageGraph(graph), [])
})

test('node-level violations: malformed coordinate, tampered id, duplicates', () => {
  const good = nodeOf(baseWorld)
  const tampered: LineageNode = {
    coordinate: good.coordinate,
    nodeId: computeLineageNodeId(coordinateOf(forkWorld)),
  }
  const duplicate = nodeOf(baseWorld)
  const graph: LineageGraph = { nodes: [good, tampered, duplicate], edges: [] }
  const codes = validateLineageGraph(graph).map((v) => v.code)
  assert.ok(codes.includes('node-id-mismatch'))
  assert.ok(codes.includes('duplicate-node'))

  const malformed: LineageGraph = {
    nodes: [
      { coordinate: { kind: 'world', id: 'Bad Id', version: good.coordinate.version, contentDigest: good.coordinate.contentDigest }, nodeId: 'sha256:' + '0'.repeat(64) },
    ],
    edges: [],
  }
  assert.ok(
    validateLineageGraph(malformed).some((v) => v.code === 'invalid-node'),
  )
})

test('edges referencing unknown digests fail (negative)', () => {
  const child = nodeOf(forkWorld)
  const ghostId = computeLineageNodeId(coordinateOf(makeRecord('world', '@ghost/pkg', '0.0.1')))
  const graph: LineageGraph = {
    nodes: [child],
    edges: [{ kind: 'fork-of', from: child.nodeId, to: ghostId }],
  }
  const violations = validateLineageGraph(graph)
  assert.equal(violations.length, 1)
  assert.equal(violations[0]?.code, 'unknown-node')
  assert.ok(violations[0]?.message.includes(ghostId))
})

test('unknown edge kinds, malformed ids and self-edges fail (negative)', () => {
  const node = nodeOf(baseWorld)
  const badKind: LineageGraph = {
    nodes: [node],
    edges: [{ kind: 'parent-of' as unknown as LineageEdge['kind'], from: node.nodeId, to: node.nodeId }],
  }
  assert.equal(validateLineageGraph(badKind)[0]?.code, 'unknown-edge-kind')

  const badIds: LineageGraph = {
    nodes: [node],
    edges: [{ kind: 'fork-of', from: 'garbage', to: node.nodeId }],
  }
  assert.equal(validateLineageGraph(badIds)[0]?.code, 'invalid-edge')

  const selfEdge: LineageGraph = {
    nodes: [node],
    edges: [{ kind: 'fork-of', from: node.nodeId, to: node.nodeId }],
  }
  assert.equal(validateLineageGraph(selfEdge)[0]?.code, 'self-edge')
})

test('edge-rule violations surface their specific codes (negative)', () => {
  const overlayPkg = makeRecord('overlay', '@demo/arena-tuning', '0.1.0')
  const assetsPkg = makeRecord('assets', '@demo/base-assets', '1.4.2')

  // fork kind mismatch
  const forkMismatch: LineageGraph = {
    nodes: [nodeOf(assetsPkg), nodeOf(baseWorld)],
    edges: [edge('fork-of', nodeOf(assetsPkg), nodeOf(baseWorld))],
  }
  assert.equal(validateLineageGraph(forkMismatch)[0]?.code, 'fork-kind-mismatch')

  // overlay attaching to an overlay-forbidden base (an overlay package)
  const overlayOnOverlay: LineageGraph = {
    nodes: [nodeOf(overlayPkg), nodeOf(makeRecord('overlay', '@demo/other', '0.2.0'))],
    edges: [
      edge('overlay-of', nodeOf(overlayPkg), nodeOf(makeRecord('overlay', '@demo/other', '0.2.0'))),
    ],
  }
  assert.equal(
    validateLineageGraph(overlayOnOverlay)[0]?.code,
    'overlay-base-forbidden',
  )

  // rebased-on across different package ids
  const rebaseAcrossIds: LineageGraph = {
    nodes: [nodeOf(forkWorld), nodeOf(baseWorld)],
    edges: [edge('rebased-on', nodeOf(forkWorld), nodeOf(baseWorld))],
  }
  assert.equal(validateLineageGraph(rebaseAcrossIds)[0]?.code, 'illegal-edge')
})

test('cyclic lineage fails with the cycle path (negative)', () => {
  const a = nodeOf(derivativeOf('@cycle/a', '1.0.0'))
  const b = nodeOf(derivativeOf('@cycle/b', '1.0.0'))
  const twoCycle: LineageGraph = {
    nodes: [a, b],
    edges: [edge('fork-of', a, b), edge('fork-of', b, a)],
  }
  const two = validateLineageGraph(twoCycle)
  assert.equal(two[0]?.code, 'cycle')
  assert.deepEqual(two[0]?.cyclePath, [a.nodeId, b.nodeId, a.nodeId])

  const c = nodeOf(derivativeOf('@cycle/c', '1.0.0'))
  const threeCycle: LineageGraph = {
    nodes: [a, b, c],
    edges: [edge('derived-from', a, b), edge('derived-from', b, c), edge('derived-from', c, a)],
  }
  const three = validateLineageGraph(threeCycle)
  assert.ok(three.some((v) => v.code === 'cycle'))
  const cycleViolation = three.find((v) => v.code === 'cycle')
  assert.equal(cycleViolation?.cyclePath?.length, 4)
})

test('diamond DAGs are not reported as cycles (no false positives)', () => {
  // A derives from B and C; B and C both derive from D (diamond, acyclic).
  const d = nodeOf(baseWorld)
  const b = nodeOf(derivativeOf('@diamond/b', '1.0.0'))
  const c = nodeOf(derivativeOf('@diamond/c', '1.0.0'))
  const a = nodeOf(derivativeOf('@diamond/a', '1.0.0'))
  const diamond: LineageGraph = {
    nodes: [a, b, c, d],
    edges: [edge('derived-from', a, b), edge('derived-from', a, c), edge('derived-from', b, d), edge('derived-from', c, d)],
  }
  const violations = validateLineageGraph(diamond)
  assert.ok(!violations.some((v) => v.code === 'cycle'))
})

test('validation is deterministic: same graph, same violations in order', () => {
  const overlayA = nodeOf(makeRecord('overlay', '@demo/arena-tuning', '0.1.0'))
  const overlayB = nodeOf(makeRecord('overlay', '@demo/other-overlay', '0.2.0'))
  const graph: LineageGraph = {
    nodes: [nodeOf(baseWorld), nodeOf(forkWorld), overlayA, overlayB],
    edges: [
      edge('fork-of', nodeOf(forkWorld), nodeOf(baseWorld)),
      edge('overlay-of', overlayA, overlayB),
    ],
  }
  const first = validateLineageGraph(graph)
  const second = validateLineageGraph(graph)
  assert.deepEqual(first, second)
  assert.deepEqual(first.map((v) => v.code), ['overlay-base-forbidden'])
})

test('checkLicenseCompatibility: compatible, divergent, incompatible', () => {
  const mitFork = withMetadata(forkWorld, {
    license: { spdxExpression: 'MIT', status: 'verified' },
  })
  assert.deepEqual(checkLicenseCompatibility(baseWorld, forkWorld), {
    verdict: 'compatible',
    base: 'Apache-2.0',
    child: 'Apache-2.0',
  })
  const divergent = checkLicenseCompatibility(baseWorld, mitFork)
  assert.equal(divergent.verdict, 'divergent')
  assert.equal(divergent.base, 'Apache-2.0')
  assert.equal(divergent.child, 'MIT')

  const declaredBase = withMetadata(baseWorld, {
    license: { spdxExpression: 'Apache-2.0', status: 'declared' },
  })
  const incompatible = checkLicenseCompatibility(declaredBase, forkWorld)
  assert.equal(incompatible.verdict, 'incompatible')
  assert.deepEqual(incompatible.reasons, ['base-unverified'])
})

test('checkLineageProvenance: sound chains carry complete R19 evidence', () => {
  const graph: LineageGraph = {
    nodes: [baseWorld, forkWorld, rebasedFork].map(nodeOf),
    edges: [
      edge('fork-of', nodeOf(forkWorld), nodeOf(baseWorld)),
      edge('rebased-on', nodeOf(rebasedFork), nodeOf(forkWorld)),
    ],
  }
  const verdicts = checkLineageProvenance(graph, [baseWorld, forkWorld, rebasedFork])
  // only derivative nodes get verdicts, in node declaration order
  assert.deepEqual(
    verdicts.map((v) => v.coordinate.id),
    ['@fork/hardened-arena', '@fork/hardened-arena'],
  )
  assert.ok(verdicts.every((v) => v.pass))
  assert.ok(verdicts.every((v) => v.reasons.length === 0))
})

test('checkLineageProvenance: missing records and gate failures fail (negative)', () => {
  const graph: LineageGraph = {
    nodes: [nodeOf(baseWorld), nodeOf(forkWorld)],
    edges: [edge('fork-of', nodeOf(forkWorld), nodeOf(baseWorld))],
  }
  // no records at all -> unknown-record for child and base
  const unknown = checkLineageProvenance(graph, [])
  assert.equal(unknown.length, 1)
  assert.equal(unknown[0]?.pass, false)
  assert.ok(unknown[0]?.reasons.some((r) => r.code === 'unknown-record'))

  // child record that fails the package-system release gate (unverified
  // license); the resealed record carries a new coordinate, so the graph is
  // rebuilt from it
  const unverifiedFork = withMetadata(forkWorld, {
    license: { spdxExpression: 'Apache-2.0', status: 'declared' },
  })
  const gateGraph: LineageGraph = {
    nodes: [nodeOf(baseWorld), nodeOf(unverifiedFork)],
    edges: [edge('fork-of', nodeOf(unverifiedFork), nodeOf(baseWorld))],
  }
  const gateFailed = checkLineageProvenance(gateGraph, [baseWorld, unverifiedFork])
  assert.equal(gateFailed.length, 1)
  assert.equal(gateFailed[0]?.pass, false)
  const reason = gateFailed[0]?.reasons.find((r) => r.code === 'release-gate-failed')
  assert.ok(reason !== undefined)
  assert.equal(reason.gate?.pass, false)
  assert.ok(
    gateFailed[0]?.reasons.some((r) => r.code === 'license-unverified'),
    'the unverified child license is also carried as a typed reason',
  )
})

test('checkLineageProvenance: graph/record lineage consistency (negative)', () => {
  // child record retains NO parent (resealed -> new coordinate, rebuild graph)
  const orphanFork = withMetadata(forkWorld, {
    lineage: { origin: coordinateOf(baseWorld), parent: null },
  })
  const orphanGraph: LineageGraph = {
    nodes: [nodeOf(baseWorld), nodeOf(orphanFork)],
    edges: [edge('fork-of', nodeOf(orphanFork), nodeOf(baseWorld))],
  }
  const noParent = checkLineageProvenance(orphanGraph, [baseWorld, orphanFork])
  assert.equal(noParent.length, 1)
  assert.equal(noParent[0]?.pass, false)
  assert.ok(noParent[0]?.reasons.some((r) => r.code === 'lineage-mismatch'))

  // child record retains a parent its edges do not carry
  const stranger = makeRecord('world', '@stranger/world', '9.9.9')
  const wrongParent = withMetadata(forkWorld, {
    lineage: { origin: coordinateOf(stranger), parent: coordinateOf(stranger) },
  })
  const mismatchGraph: LineageGraph = {
    nodes: [nodeOf(baseWorld), nodeOf(wrongParent)],
    edges: [edge('fork-of', nodeOf(wrongParent), nodeOf(baseWorld))],
  }
  const mismatched = checkLineageProvenance(mismatchGraph, [baseWorld, wrongParent])
  assert.equal(mismatched[0]?.pass, false)
  assert.ok(mismatched[0]?.reasons.some((r) => r.code === 'lineage-mismatch'))
})

test('checkLineageProvenance: unverified base licenses fail, divergence records (negative)', () => {
  // unverified BASE license: a lineage-level fact the per-record gate cannot
  // see. The resealed base carries a new coordinate, so the graph is rebuilt.
  const declaredBase = withMetadata(baseWorld, {
    license: { spdxExpression: 'Apache-2.0', status: 'declared' },
  })
  const unverifiedGraph: LineageGraph = {
    nodes: [nodeOf(declaredBase), nodeOf(forkWorld)],
    edges: [edge('fork-of', nodeOf(forkWorld), nodeOf(declaredBase))],
  }
  const unverified = checkLineageProvenance(unverifiedGraph, [declaredBase, forkWorld])
  assert.equal(unverified.length, 1)
  assert.equal(unverified[0]?.pass, false)
  const reason = unverified[0]?.reasons.find((r) => r.code === 'license-unverified')
  assert.ok(reason !== undefined)
  assert.equal(reason.license?.verdict, 'incompatible')
  assert.deepEqual(reason.license?.reasons, ['base-unverified'])

  // relicensed fork: divergent is RECORDED but does not fail (gate decides)
  const mitFork = withMetadata(forkWorld, {
    license: { spdxExpression: 'MIT', status: 'verified' },
  })
  const divergentGraph: LineageGraph = {
    nodes: [nodeOf(baseWorld), nodeOf(mitFork)],
    edges: [edge('fork-of', nodeOf(mitFork), nodeOf(baseWorld))],
  }
  const divergent = checkLineageProvenance(divergentGraph, [baseWorld, mitFork])
  assert.equal(divergent.length, 1)
  assert.equal(divergent[0]?.pass, true)
  const recorded = divergent[0]?.reasons.find((r) => r.code === 'license-divergent')
  assert.ok(recorded !== undefined)
  assert.equal(recorded.license?.verdict, 'divergent')
  assert.equal(recorded.license?.base, 'Apache-2.0')
  assert.equal(recorded.license?.child, 'MIT')
})

test('verdicts are pure over snapshots: repeated calls agree', () => {
  const graph: LineageGraph = {
    nodes: [baseWorld, forkWorld].map(nodeOf),
    edges: [edge('fork-of', nodeOf(forkWorld), nodeOf(baseWorld))],
  }
  const first = checkLineageProvenance(graph, [baseWorld, forkWorld])
  const second = checkLineageProvenance(graph, [baseWorld, forkWorld])
  assert.deepEqual(first, second)
  // makeLineageNode and nodeOf agree on content-addressed ids
  assert.deepEqual(makeLineageNode(coordinateOf(baseWorld)), nodeOf(baseWorld))
})
