import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { computeDigest } from './digest.ts'
import { isContentDigest } from './digest.ts'

test('computeDigest pins the canonical form of a value', () => {
  const canonical = '{"a":1,"b":2}'
  const expected = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
  assert.equal(computeDigest({ b: 2, a: 1 }), expected)
})

test('computeDigest is key-order invariant (E9)', () => {
  const left = computeDigest({ meta: { kind: 'world', id: 'w' }, deps: [1, 2] })
  const right = computeDigest({ deps: [1, 2], meta: { id: 'w', kind: 'world' } })
  assert.equal(left, right)
})

test('computeDigest changes when content changes', () => {
  const base = computeDigest({ a: 1 })
  assert.notEqual(computeDigest({ a: 2 }), base)
  assert.notEqual(computeDigest({ a: 1, extra: true }), base)
  assert.notEqual(computeDigest([1, 2]), computeDigest([2, 1]))
})

test('computeDigest is stable across repeated calls', () => {
  const value = { nested: { deep: [true, null, 'x'] } }
  const first = computeDigest(value)
  for (let i = 0; i < 5; i += 1) {
    assert.equal(computeDigest(value), first)
  }
})

test('isContentDigest validates the sha256:<64-hex> format', () => {
  assert.equal(isContentDigest('sha256:' + 'a'.repeat(64)), true)
  assert.equal(isContentDigest('sha256:' + 'A'.repeat(64)), false)
  assert.equal(isContentDigest('sha512:' + 'a'.repeat(64)), false)
  assert.equal(isContentDigest('sha256:' + 'a'.repeat(63)), false)
  assert.equal(isContentDigest(''), false)
  assert.equal(isContentDigest(null), false)
  assert.equal(isContentDigest(123), false)
})
