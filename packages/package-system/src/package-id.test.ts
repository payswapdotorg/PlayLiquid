import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PACKAGE_KINDS,
  formatPackageId,
  isPackageKind,
  parsePackageId,
} from './package-id.ts'

test('package kinds enumerate the architecture composition units', () => {
  assert.deepEqual([...PACKAGE_KINDS], [
    'game',
    'world',
    'assets',
    'avatar',
    'system',
    'overlay',
    'evaluation-suite',
  ])
})

test('isPackageKind accepts members and rejects non-members', () => {
  for (const kind of PACKAGE_KINDS) {
    assert.equal(isPackageKind(kind), true, kind)
  }
  assert.equal(isPackageKind('engine'), false)
  assert.equal(isPackageKind(''), false)
  assert.equal(isPackageKind(null), false)
  assert.equal(isPackageKind(42), false)
})

test('parsePackageId accepts unscoped and scoped ids', () => {
  assert.deepEqual(parsePackageId('arena-world'), { scope: null, name: 'arena-world' })
  assert.deepEqual(parsePackageId('@demo/arena-world'), { scope: 'demo', name: 'arena-world' })
  assert.deepEqual(parsePackageId('@playliquid/package-system'), {
    scope: 'playliquid',
    name: 'package-system',
  })
})

test('parsePackageId rejects invalid ids', () => {
  for (const bad of [
    '',
    'Arena-World',
    '@demo/',
    '/name',
    '@Demo/name',
    '-leading-dash',
    '.leading-dot',
    'spaces in name',
    'trailing/slash/',
    'a'.repeat(215),
  ]) {
    assert.equal(parsePackageId(bad), null, `must reject: ${bad}`)
  }
})

test('formatPackageId round-trips', () => {
  assert.equal(formatPackageId({ scope: null, name: 'arena-world' }), 'arena-world')
  assert.equal(formatPackageId({ scope: 'demo', name: 'arena-world' }), '@demo/arena-world')
})
