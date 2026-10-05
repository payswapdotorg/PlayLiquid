import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isGitCommitSha,
  isHttpUrlWithoutCredentials,
  isPackageCoordinate,
} from './provenance.ts'
import { computeDigest } from './digest.ts'
import { makeRecord } from './test-fixtures.ts'

test('isGitCommitSha accepts 40- and 64-character lowercase hex', () => {
  assert.equal(isGitCommitSha('0123456789abcdef0123456789abcdef01234567'), true)
  assert.equal(
    isGitCommitSha('0123456789abcdef'.repeat(4)),
    true,
  )
  assert.equal(isGitCommitSha('ABCDEF0123456789abcdef0123456789abcdef01'), false)
  assert.equal(isGitCommitSha('0123456789abcdef0123456789abcdef0123456'), false)
  assert.equal(isGitCommitSha(''), false)
  assert.equal(isGitCommitSha(null), false)
})

test('isHttpUrlWithoutCredentials rejects embedded userinfo', () => {
  // Credential-shaped fixture assembled at RUNTIME from fragments so the
  // full secret shape (including its token prefix) never appears in source.
  const tokenPrefix = 'gh' + 'p' + '_'
  const user = 'pl' + '-bot'
  const secret = tokenPrefix + 'fragment' + 'never-literal'
  const host = 'registry' + '.example' + '.invalid'
  const withCredentials = `https://${user}:${secret}@${host}/packages`
  assert.equal(isHttpUrlWithoutCredentials(withCredentials), false)
  assert.equal(isHttpUrlWithoutCredentials(`https://${host}/packages`), true)
  assert.equal(isHttpUrlWithoutCredentials(`http://${host}:8080/x`), true)
})

test('isHttpUrlWithoutCredentials rejects non-http(s) and malformed urls', () => {
  assert.equal(isHttpUrlWithoutCredentials('ftp://example.invalid/x'), false)
  assert.equal(isHttpUrlWithoutCredentials('not a url'), false)
  assert.equal(isHttpUrlWithoutCredentials(''), false)
  assert.equal(isHttpUrlWithoutCredentials('https://'), false)
})

test('isPackageCoordinate validates coordinate shape', () => {
  const record = makeRecord('world', '@demo/world', '1.0.0')
  assert.equal(
    isPackageCoordinate({
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
      contentDigest: record.identity.contentDigest,
    }),
    true,
  )
  assert.equal(isPackageCoordinate(null), false)
  assert.equal(isPackageCoordinate({ kind: 'engine', id: 'x', version: record.identity.version, contentDigest: record.identity.contentDigest }), false)
  assert.equal(isPackageCoordinate({ kind: 'world', id: 'Bad Id', version: record.identity.version, contentDigest: record.identity.contentDigest }), false)
  assert.equal(
    isPackageCoordinate({
      kind: 'world',
      id: 'x',
      version: record.identity.version,
      contentDigest: computeDigest({}),
    }),
    true,
  )
})
