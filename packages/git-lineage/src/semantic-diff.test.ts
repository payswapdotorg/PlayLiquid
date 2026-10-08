import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDigest } from '@playliquid/package-system'
import { asNodeId } from '@playliquid/game-ir'
import {
  SEMANTIC_CHANGE_KINDS,
  SEMANTIC_KIND_IR_NODE_RULES,
  SEMANTIC_KIND_SUBJECT_RULES,
  classifyChangeKinds,
  isSemanticChangeKind,
  isSemanticDiff,
  semanticDiffId,
  validateSemanticDiff,
} from './semantic-diff.ts'
import type { SemanticChange, SemanticDiff } from './semantic-diff.ts'
import { coordinateOf, makeRecord } from './fixtures.ts'

const baseWorld = makeRecord('world', '@demo/arena-world', '2.1.0')
const forkWorld = makeRecord('world', '@fork/hardened-arena', '1.0.0')

const PAYLOAD = computeDigest({ native: 'details' })

function changeOf(partial: Partial<SemanticChange>): SemanticChange {
  return {
    kind: 'world',
    subject: { type: 'semantic-path', path: 'world.rules.combat' },
    payloadDigest: PAYLOAD,
    ...partial,
  }
}

function irNode(kind: 'capability-declaration' | 'rule' | 'avatar-binding' | 'world', id: string) {
  const nodeId = asNodeId(id)
  if (nodeId === undefined) {
    throw new Error(`fixture node id is invalid: ${id}`)
  }
  return { type: 'ir-node', nodeKind: kind, nodeId } as const
}

function diffOf(changes: readonly SemanticChange[]): SemanticDiff {
  return {
    base: coordinateOf(baseWorld),
    target: coordinateOf(forkWorld),
    changes,
  }
}

test('SEMANTIC_CHANGE_KINDS is the frozen architecture vocabulary', () => {
  assert.deepEqual([...SEMANTIC_CHANGE_KINDS], [
    'code',
    'package',
    'world',
    'asset',
    'avatar',
    'capability',
    'policy',
    'license',
    'simulation',
    'replay',
    'performance',
  ])
  for (const kind of SEMANTIC_CHANGE_KINDS) {
    assert.equal(isSemanticChangeKind(kind), true)
    assert.ok(SEMANTIC_KIND_SUBJECT_RULES[kind] !== undefined)
    assert.ok(SEMANTIC_KIND_IR_NODE_RULES[kind] !== undefined)
  }
})

test('a well-formed typed diff validates clean', () => {
  const diff = diffOf([
    changeOf({ kind: 'world', subject: { type: 'semantic-path', path: 'world.rules.combat' } }),
    changeOf({
      kind: 'license',
      subject: { type: 'package', coordinate: coordinateOf(forkWorld) },
    }),
    changeOf({
      kind: 'capability',
      subject: irNode('capability-declaration', 'capability-replay'),
    }),
    changeOf({
      kind: 'code',
      subject: irNode('rule', 'rule-hero-motion'),
    }),
  ])
  assert.deepEqual(validateSemanticDiff(diff), [])
  assert.equal(isSemanticDiff(diff), true)
})

test('illegal change kinds fail closed (negative)', () => {
  const diff = diffOf([
    changeOf({ kind: 'cosmetic' as unknown as 'world' }),
  ])
  const violations = validateSemanticDiff(diff)
  assert.equal(violations.length, 1)
  assert.equal(violations[0]?.code, 'invalid-kind')
  assert.equal(isSemanticDiff(diff), false)

  const nonString = diffOf([
    changeOf({ kind: null as unknown as 'world' }),
  ])
  assert.equal(validateSemanticDiff(nonString)[0]?.code, 'invalid-kind')
})

test('kind/subject coherence is enforced (negative)', () => {
  // policy changes may only address semantic paths
  const policyPackage = diffOf([
    changeOf({ kind: 'policy', subject: { type: 'package', coordinate: coordinateOf(forkWorld) } }),
  ])
  assert.equal(
    validateSemanticDiff(policyPackage)[0]?.code,
    'kind-subject-mismatch',
  )

  // world changes may not target avatar bindings
  const worldAvatar = diffOf([
    changeOf({
      kind: 'world',
      subject: irNode('avatar-binding', 'avatar-binding-hero'),
    }),
  ])
  assert.equal(
    validateSemanticDiff(worldAvatar)[0]?.code,
    'kind-subject-mismatch',
  )

  // simulation changes may target rules and event declarations only
  const simulationWorldNode = diffOf([
    changeOf({
      kind: 'simulation',
      subject: irNode('world', 'world-primus-node'),
    }),
  ])
  assert.equal(
    validateSemanticDiff(simulationWorldNode)[0]?.code,
    'kind-subject-mismatch',
  )
})

test('malformed subjects, payload digests and duplicates fail (negative)', () => {
  const malformedSubject = diffOf([
    changeOf({ subject: { type: 'semantic-path', path: 'bad path!!' } as SemanticChange['subject'] }),
  ])
  assert.equal(validateSemanticDiff(malformedSubject)[0]?.code, 'invalid-subject')

  const badPayload = diffOf([
    changeOf({ payloadDigest: 'not-a-digest' }),
  ])
  assert.equal(validateSemanticDiff(badPayload)[0]?.code, 'invalid-payload-digest')

  const duplicate = diffOf([
    changeOf({ kind: 'world', subject: { type: 'semantic-path', path: 'world.rules.combat' } }),
    changeOf({ kind: 'world', subject: { type: 'semantic-path', path: 'world.rules.combat' } }),
  ])
  assert.equal(validateSemanticDiff(duplicate)[0]?.code, 'duplicate-change')

  const badCoordinate = validateSemanticDiff({
    base: { kind: 'world', id: 'Bad Id', version: coordinateOf(baseWorld).version, contentDigest: coordinateOf(baseWorld).contentDigest },
    target: coordinateOf(forkWorld),
    changes: [],
  })
  assert.ok(badCoordinate.some((v) => v.code === 'invalid-coordinate'))
})

test('semanticDiffId is content-addressed and value-stable', () => {
  const diff = diffOf([
    changeOf({ kind: 'world', subject: { type: 'semantic-path', path: 'world.rules.combat' } }),
  ])
  const first = semanticDiffId(diff)
  assert.equal(semanticDiffId(diff), first)
  assert.match(first, /^sha256:[0-9a-f]{64}$/)
  // same value, different object identity and key order -> same id
  const reordered = diffOf([
    {
      subject: { path: 'world.rules.combat', type: 'semantic-path' },
      kind: 'world',
      payloadDigest: PAYLOAD,
    },
  ])
  assert.equal(semanticDiffId(reordered), first)
  // a different change set -> a different id
  const other = diffOf([
    changeOf({ kind: 'policy', subject: { type: 'semantic-path', path: 'policy.rate-limit' } }),
  ])
  assert.notEqual(semanticDiffId(other), first)
})

test('classifyChangeKinds summarizes in frozen vocabulary order', () => {
  const kinds = classifyChangeKinds(
    diffOf([
      changeOf({ kind: 'replay', subject: { type: 'semantic-path', path: 'replay.capture' } }),
      changeOf({ kind: 'asset', subject: { type: 'package', coordinate: coordinateOf(baseWorld) } }),
      changeOf({ kind: 'world', subject: { type: 'semantic-path', path: 'world.rules.combat' } }),
      changeOf({ kind: 'world', subject: { type: 'semantic-path', path: 'world.rules.movement' } }),
    ]),
  )
  assert.deepEqual([...kinds], ['world', 'asset', 'replay'])
})
