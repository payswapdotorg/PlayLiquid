import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CAS_DIGEST_ALGORITHM, computeBlobDigest, isBlobDigest, utf8Bytes } from './digest.ts'

test('blob digests are sha256: + 64 lowercase hex', () => {
  const digest = computeBlobDigest(utf8Bytes('playliquid'))
  assert.ok(isBlobDigest(digest))
  assert.match(digest, /^sha256:[0-9a-f]{64}$/)
  assert.equal(CAS_DIGEST_ALGORITHM, 'sha256')
})

test('determinism: byte-identical payloads produce identical digests', () => {
  const first = computeBlobDigest(new Uint8Array([1, 2, 3, 4]))
  const second = computeBlobDigest(new Uint8Array([1, 2, 3, 4]))
  assert.equal(first, second)
})

test('one differing byte produces a different digest', () => {
  const first = computeBlobDigest(new Uint8Array([1, 2, 3, 4]))
  const second = computeBlobDigest(new Uint8Array([1, 2, 3, 5]))
  assert.notEqual(first, second)
})

test('the empty payload has the canonical empty SHA-256 digest', () => {
  assert.equal(
    computeBlobDigest(new Uint8Array(0)),
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
})

test('isBlobDigest rejects malformed digests', () => {
  assert.equal(isBlobDigest('sha256:abc'), false)
  assert.equal(isBlobDigest('sha512:' + 'a'.repeat(64)), false)
  assert.equal(isBlobDigest('SHA256:' + 'a'.repeat(64)), false)
  assert.equal(isBlobDigest('sha256:' + 'A'.repeat(64)), false)
  assert.equal(isBlobDigest(null), false)
  assert.equal(isBlobDigest(42), false)
})

test('utf8Bytes round-trips ASCII and non-ASCII content', () => {
  const value = 'PlayLiquid 🎮 package registry — PL-011'
  const bytes = utf8Bytes(value)
  assert.equal(new TextDecoder().decode(bytes), value)
})
