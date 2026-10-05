import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CanonicalJsonError, canonicalJson } from './canonical-json.ts'

test('canonicalJson sorts object keys', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}')
})

test('canonicalJson is key-order invariant at every nesting level', () => {
  const left = { z: { d: 4, c: 3 }, a: [{ y: 1, x: 2 }], m: 0 }
  const right = { m: 0, a: [{ x: 2, y: 1 }], z: { c: 3, d: 4 } }
  assert.equal(canonicalJson(left), canonicalJson(right))
})

test('canonicalJson preserves array order', () => {
  assert.equal(canonicalJson({ list: [3, 1, 2] }), '{"list":[3,1,2]}')
  assert.notEqual(canonicalJson({ list: [1, 2, 3] }), canonicalJson({ list: [3, 2, 1] }))
})

test('canonicalJson emits no insignificant whitespace', () => {
  assert.equal(canonicalJson({ a: [1, 2], b: { c: null } }), '{"a":[1,2],"b":{"c":null}}')
})

test('canonicalJson serializes primitives per JSON.stringify', () => {
  assert.equal(canonicalJson(null), 'null')
  assert.equal(canonicalJson(true), 'true')
  assert.equal(canonicalJson(false), 'false')
  assert.equal(canonicalJson(42), '42')
  assert.equal(canonicalJson(0.5), '0.5')
  assert.equal(canonicalJson('quote"back\\slash'), '"quote\\"back\\\\slash"')
  assert.equal(canonicalJson('ünïcödé'), '"ünïcödé"')
})

test('canonicalJson is deterministic across repeated runs', () => {
  const value = { b: { bb: [1, { x: 'y' }] }, a: 'first' }
  const first = canonicalJson(value)
  for (let i = 0; i < 5; i += 1) {
    assert.equal(canonicalJson(value), first)
  }
})

test('canonicalJson rejects non-JSON values', () => {
  for (const bad of [
    undefined,
    () => 1,
    Symbol('no'),
    10n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0,
    new Date(0),
    new Map(),
    new Set([1]),
  ]) {
    assert.throws(() => canonicalJson(bad), CanonicalJsonError, `must reject: ${String(bad)}`)
  }
})

test('canonicalJson rejects cyclic structures', () => {
  const cyclic: Record<string, unknown> = { name: 'cycle' }
  cyclic.self = cyclic
  assert.throws(() => canonicalJson(cyclic), CanonicalJsonError)

  const mutualA: Record<string, unknown> = {}
  const mutualB: Record<string, unknown> = { a: mutualA }
  mutualA.b = mutualB
  assert.throws(() => canonicalJson(mutualA), CanonicalJsonError)
})

test('canonicalJson rejects non-plain objects and sparse arrays holes', () => {
  class Custom {
    value = 1
  }
  assert.throws(() => canonicalJson(new Custom()), CanonicalJsonError)
  const sparse = [1, 2, 3]
  delete sparse[1]
  assert.throws(() => canonicalJson(sparse), CanonicalJsonError)
})

test('canonicalJson accepts objects with null prototype', () => {
  const plain = Object.create(null) as Record<string, unknown>
  plain.key = 'value'
  assert.equal(canonicalJson(plain), '{"key":"value"}')
})

test('canonicalJson error carries the offending path', () => {
  try {
    canonicalJson({ outer: { inner: Number.NaN } })
    assert.fail('must throw')
  } catch (error) {
    assert.ok(error instanceof CanonicalJsonError)
    assert.equal((error as CanonicalJsonError).path, '$.outer.inner')
  }
})
