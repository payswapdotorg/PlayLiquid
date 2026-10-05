import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SemanticVersion } from './semver.ts'
import {
  compareSemver,
  formatSemver,
  parseSemver,
  parseSemverRange,
  satisfiesParsed,
  semverSatisfies,
} from './semver.ts'

const v = (value: string): SemanticVersion => {
  const parsed = parseSemver(value)
  if (parsed === null) {
    throw new Error(`literal must parse: ${value}`)
  }
  return parsed
}

test('parseSemver accepts valid versions', () => {
  assert.deepEqual(parseSemver('0.0.4'), {
    major: 0,
    minor: 0,
    patch: 4,
    prerelease: [],
    build: [],
  })
  assert.deepEqual(parseSemver('1.2.3-alpha.7'), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: ['alpha', '7'],
    build: [],
  })
  assert.deepEqual(parseSemver('10.20.30-beta+build.1'), {
    major: 10,
    minor: 20,
    patch: 30,
    prerelease: ['beta'],
    build: ['build', '1'],
  })
})

test('parseSemver rejects invalid versions', () => {
  for (const bad of ['1.2', '1.2.3.4', '01.2.3', '1.02.3', 'v1.2.3', '', '1.2.3-', '1.2.3+', 'a.b.c', '1.2.3-01']) {
    assert.equal(parseSemver(bad), null, `must reject: ${bad}`)
  }
})

test('formatSemver round-trips', () => {
  for (const literal of ['0.0.4', '1.2.3-alpha.7', '10.20.30-beta+build.1', '1.0.0-alpha.beta.1']) {
    assert.equal(formatSemver(v(literal)), literal)
  }
})

test('compareSemver follows semver.org §11 precedence chain', () => {
  const chain = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ]
  for (let i = 0; i < chain.length - 1; i += 1) {
    const lower = v(chain[i] ?? '')
    const higher = v(chain[i + 1] ?? '')
    assert.equal(compareSemver(lower, higher), -1, `${chain[i]} < ${chain[i + 1]}`)
    assert.equal(compareSemver(higher, lower), 1, `${chain[i + 1]} > ${chain[i]}`)
  }
})

test('compareSemver: build metadata is ignored for precedence', () => {
  assert.equal(compareSemver(v('1.0.0+build.1'), v('1.0.0+other')), 0)
})

test('compareSemver: numeric ordering across components', () => {
  assert.equal(compareSemver(v('2.0.0'), v('10.0.0')), -1)
  assert.equal(compareSemver(v('1.10.0'), v('1.9.0')), 1)
  assert.equal(compareSemver(v('1.0.10'), v('1.0.9')), 1)
})

test('parseSemverRange grammar', () => {
  assert.deepEqual(parseSemverRange('*'), { kind: 'any' })
  assert.equal(parseSemverRange('^1.2.3')?.kind, 'caret')
  assert.equal(parseSemverRange('~1.2.3')?.kind, 'tilde')
  assert.equal(parseSemverRange('1.2.3')?.kind, 'exact')
  for (const bad of ['>=1.0.0', '1.x', '^1.2', '**', '1.2.3 - 2.0.0', '^', '~x']) {
    assert.equal(parseSemverRange(bad), null, `must reject range: ${bad}`)
  }
})

test('exact ranges require exact match (build metadata significant)', () => {
  assert.equal(semverSatisfies(v('1.2.3'), '1.2.3'), true)
  assert.equal(semverSatisfies(v('1.2.4'), '1.2.3'), false)
  assert.equal(semverSatisfies(v('1.2.3+build'), '1.2.3'), false)
  assert.equal(semverSatisfies(v('1.2.3+build'), '1.2.3+build'), true)
})

test('any range admits everything', () => {
  assert.equal(semverSatisfies(v('0.0.1-alpha'), '*'), true)
  assert.equal(semverSatisfies(v('99.99.99'), '*'), true)
})

test('caret ranges respect the leftmost non-zero component', () => {
  assert.equal(semverSatisfies(v('1.2.3'), '^1.2.3'), true)
  assert.equal(semverSatisfies(v('1.9.9'), '^1.2.3'), true)
  assert.equal(semverSatisfies(v('2.0.0'), '^1.2.3'), false)
  assert.equal(semverSatisfies(v('1.2.2'), '^1.2.3'), false)
  assert.equal(semverSatisfies(v('0.2.9'), '^0.2.3'), true)
  assert.equal(semverSatisfies(v('0.3.0'), '^0.2.3'), false)
  assert.equal(semverSatisfies(v('0.0.3'), '^0.0.3'), true)
  assert.equal(semverSatisfies(v('0.0.4'), '^0.0.3'), false)
})

test('tilde ranges allow patch-level changes', () => {
  assert.equal(semverSatisfies(v('1.2.3'), '~1.2.3'), true)
  assert.equal(semverSatisfies(v('1.2.9'), '~1.2.3'), true)
  assert.equal(semverSatisfies(v('1.3.0'), '~1.2.3'), false)
  assert.equal(semverSatisfies(v('1.2.2'), '~1.2.3'), false)
})

test('prereleases only satisfy ranges on the same version tuple', () => {
  assert.equal(semverSatisfies(v('1.2.3-alpha'), '^1.2.3-alpha'), true)
  assert.equal(semverSatisfies(v('1.2.4-alpha'), '^1.2.3-alpha'), false)
  assert.equal(semverSatisfies(v('1.2.3-beta'), '^1.2.3-alpha'), true)
  assert.equal(semverSatisfies(v('1.3.0-alpha'), '^1.2.3'), false)
})

test('unparseable constraints satisfy nothing (fail closed)', () => {
  assert.equal(semverSatisfies(v('1.0.0'), 'not-a-range'), false)
})

test('satisfiesParsed agrees with semverSatisfies', () => {
  const range = parseSemverRange('^0.3.0')
  assert.notEqual(range, null)
  assert.equal(satisfiesParsed(v('0.3.1'), range as { kind: 'caret'; base: ReturnType<typeof v> }), true)
  assert.equal(semverSatisfies(v('0.3.1'), '^0.3.0'), true)
})
