/**
 * Pure-check harness (PL-012 evidence).
 *
 * Builds a synthetic lineage: one original world package, one whole-package
 * fork of it, one rebased derivative of the fork, one overlay package over
 * the original, plus a semantic diff between the original and the fork.
 * Validates the graph, checks overlay applicability against the base
 * record, evaluates the R19 provenance/license verdicts along the chains,
 * and exercises the LineageStore port through the in-memory fake.
 *
 * Prints a canonical-JSON summary so the output is byte-stable across runs
 * and machines.
 *
 * Run: `node src/harness.ts`
 * Exit code 0 when every check passes, 1 otherwise.
 */

import { canonicalJson, computeDigest } from '@playliquid/package-system'
import {
  checkLineageProvenance,
  checkOverlayApplicability,
  semanticDiffId,
  validateForkRecord,
  validateLineageGraph,
  validateOverlayRecord,
  validateSemanticDiff,
} from './index.ts'
import type {
  ForkRecord,
  LineageGraph,
  OverlayRecord,
  SemanticDiff,
} from './index.ts'
import { loadLineageGraph } from './index.ts'
import { coordinateOf, makeRecord, nodeOf } from './fixtures.ts'
import { createInMemoryLineageStore } from './fixtures.ts'

const BASE_COMMIT = '0123456789abcdef0123456789abcdef01234567'

// --- synthetic package corpus -------------------------------------------

const baseWorld = makeRecord('world', '@demo/arena-world', '2.1.0', {
  resources: { minMemoryBytes: 64 },
})

const forkWorld = makeRecord('world', '@fork/hardened-arena', '1.0.0', {
  license: { spdxExpression: 'MIT', status: 'verified' },
  provenance: {
    origin: { type: 'package', coordinate: coordinateOf(baseWorld) },
    sourceCommit: BASE_COMMIT,
    transformationHistory: [
      { kind: 'derive', description: 'security hardening fork of @demo/arena-world' },
    ],
    modelProvenance: [],
    generatedByAi: false,
  },
  lineage: {
    origin: coordinateOf(baseWorld),
    parent: coordinateOf(baseWorld),
  },
})

const rebasedFork = makeRecord('world', '@fork/hardened-arena', '1.1.0', {
  license: { spdxExpression: 'MIT', status: 'verified' },
  provenance: {
    origin: { type: 'package', coordinate: coordinateOf(baseWorld) },
    sourceCommit: BASE_COMMIT,
    transformationHistory: [
      { kind: 'derive', description: 'rebased onto @fork/hardened-arena 1.0.0' },
    ],
    modelProvenance: [],
    generatedByAi: false,
  },
  lineage: {
    origin: coordinateOf(baseWorld),
    parent: coordinateOf(forkWorld),
  },
})

const overlayPkg = makeRecord('overlay', '@demo/arena-tuning', '0.1.0', {
  provenance: {
    origin: { type: 'package', coordinate: coordinateOf(baseWorld) },
    sourceCommit: BASE_COMMIT,
    transformationHistory: [
      { kind: 'overlay', description: 'narrow tuning overlay of @demo/arena-world' },
    ],
    modelProvenance: [],
    generatedByAi: false,
  },
  lineage: {
    origin: coordinateOf(baseWorld),
    parent: coordinateOf(baseWorld),
  },
})

// --- lineage graph --------------------------------------------------------

const baseNode = nodeOf(baseWorld)
const forkNode = nodeOf(forkWorld)
const rebaseNode = nodeOf(rebasedFork)
const overlayNode = nodeOf(overlayPkg)
const forkEdge: LineageGraph['edges'][number] = {
  kind: 'fork-of',
  from: forkNode.nodeId,
  to: baseNode.nodeId,
}
const rebaseEdge: LineageGraph['edges'][number] = {
  kind: 'rebased-on',
  from: rebaseNode.nodeId,
  to: forkNode.nodeId,
}
const overlayEdge: LineageGraph['edges'][number] = {
  kind: 'overlay-of',
  from: overlayNode.nodeId,
  to: baseNode.nodeId,
}
const graph: LineageGraph = {
  nodes: [baseNode, forkNode, rebaseNode, overlayNode],
  edges: [forkEdge, rebaseEdge, overlayEdge],
}

// --- contracts -------------------------------------------------------------

const forkRecord: ForkRecord = {
  fork: coordinateOf(forkWorld),
  base: { package: coordinateOf(baseWorld), commit: BASE_COMMIT },
  reason: 'security',
  note: 'harden spawn rules',
}

const overlayRecord: OverlayRecord = {
  base: coordinateOf(baseWorld),
  operations: [
    {
      op: 'add',
      surface: 'dependencies',
      key: '@demo/combat-system',
      valueDigest: computeDigest({
        id: '@demo/combat-system',
        constraint: '^0.3.0',
        kind: 'system',
        optional: false,
      }),
    },
    {
      op: 'replace',
      surface: 'resources',
      key: 'minMemoryBytes',
      valueDigest: computeDigest(128),
    },
  ],
}

const diff: SemanticDiff = {
  base: coordinateOf(baseWorld),
  target: coordinateOf(forkWorld),
  changes: [
    {
      kind: 'world',
      subject: { type: 'semantic-path', path: 'world.rules.combat' },
      payloadDigest: computeDigest({ changed: 'spawn-rate' }),
    },
    {
      kind: 'license',
      subject: { type: 'package', coordinate: coordinateOf(forkWorld) },
      payloadDigest: computeDigest({ from: 'Apache-2.0', to: 'MIT' }),
    },
  ],
}

// --- port round-trip --------------------------------------------------------

const store = createInMemoryLineageStore()
for (const node of graph.nodes) {
  await store.putNode(node)
}
for (const edge of graph.edges) {
  await store.putEdge(edge)
}
await store.putEdge(forkEdge) // idempotent duplicate
const reloaded = await loadLineageGraph(store)

// --- summary -----------------------------------------------------------------

const graphViolations = validateLineageGraph(graph)
const reloadedViolations = validateLineageGraph(reloaded)
const provenance = checkLineageProvenance(
  graph,
  [baseWorld, forkWorld, rebasedFork, overlayPkg],
)

const summary = {
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  storeRoundTrip:
    reloaded.nodes.length === graph.nodes.length &&
    reloaded.edges.length === graph.edges.length &&
    reloadedViolations.length === 0,
  graphViolations: graphViolations.map((violation) => violation.code),
  forkRecordValid: validateForkRecord(forkRecord).length === 0,
  overlayRecordValid: validateOverlayRecord(overlayRecord).length === 0,
  overlayApplicable: checkOverlayApplicability(overlayRecord, baseWorld).ok,
  semanticDiffValid: validateSemanticDiff(diff).length === 0,
  semanticDiffId: semanticDiffId(diff),
  provenanceVerdicts: provenance.map((verdict) => ({
    id: verdict.coordinate.id,
    pass: verdict.pass,
    reasons: verdict.reasons.map((reason) => reason.code),
  })),
}

console.log('=== PlayLiquid git-lineage pure-check harness (PL-012) ===')
console.log(canonicalJson(summary))

const failed =
  graphViolations.length > 0 ||
  reloadedViolations.length > 0 ||
  !summary.storeRoundTrip ||
  !summary.forkRecordValid ||
  !summary.overlayRecordValid ||
  !summary.overlayApplicable ||
  !summary.semanticDiffValid ||
  provenance.some((verdict) => !verdict.pass)

if (failed) {
  console.error('harness: at least one lineage check failed')
  process.exitCode = 1
} else {
  console.log(
    'lineage graph: valid; store round-trip: ok; contracts: valid; provenance verdicts: 3/3 evidence complete',
  )
}
