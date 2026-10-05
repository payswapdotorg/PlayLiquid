import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_INLINE_ARTIFACT_BYTES,
  base64DecodedBytes,
  checkArtifactPlacement,
} from './cas.ts'
import type { CasArtifactRef, InlineArtifact, PackageArtifact } from './cas.ts'
import { computeDigest } from './digest.ts'

const digest = computeDigest({ artifact: 'synthetic-bytes' })

const casRef: CasArtifactRef = {
  storage: 'cas',
  digest,
  sizeBytes: 1_048_576,
  mediaType: 'model/gltf-binary',
}

const smallInline: InlineArtifact = {
  storage: 'inline',
  base64: Buffer.from('small payload').toString('base64'),
  mediaType: 'text/plain',
}

test('CAS pointers are always valid placements', () => {
  assert.deepEqual(checkArtifactPlacement(casRef), { ok: true })
})

test('small inline artifacts are valid placements', () => {
  assert.deepEqual(checkArtifactPlacement(smallInline), { ok: true })
})

test('E7: inline artifacts above 1 MiB are rejected', () => {
  // Assemble the oversized payload at runtime; no huge literal in source.
  const block = 'A'.repeat(64)
  const repeats = Math.ceil((MAX_INLINE_ARTIFACT_BYTES + 1024) / block.length)
  const oversized: InlineArtifact = {
    storage: 'inline',
    base64: Buffer.from(block.repeat(repeats)).toString('base64'),
    mediaType: 'application/octet-stream',
  }
  assert.ok(base64DecodedBytes(oversized.base64) !== null)
  const verdict = checkArtifactPlacement(oversized)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.ok === false && verdict.code, 'inline-artifact-too-large')
})

test('exactly-at-limit inline artifacts are accepted', () => {
  const oversized: InlineArtifact = {
    storage: 'inline',
    base64: Buffer.from('A'.repeat(MAX_INLINE_ARTIFACT_BYTES)).toString('base64'),
    mediaType: 'application/octet-stream',
  }
  assert.deepEqual(checkArtifactPlacement(oversized), { ok: true })
})

test('base64DecodedBytes validates and counts', () => {
  assert.equal(base64DecodedBytes(''), 0)
  assert.equal(base64DecodedBytes('QQ=='), 1)
  assert.equal(base64DecodedBytes('QUI='), 2)
  assert.equal(base64DecodedBytes('QUJD'), 3)
  assert.equal(base64DecodedBytes('QUJD!'), null)
  assert.equal(base64DecodedBytes('QQ='), null)
  assert.equal(base64DecodedBytes('QQ'), null)
})

test('malformed artifacts fail closed', () => {
  const badMediaType = { storage: 'cas', digest, sizeBytes: 1, mediaType: 'not-a-media-type' }
  assert.equal(checkArtifactPlacement(badMediaType as unknown as PackageArtifact).ok, false)

  const badDigest = { storage: 'cas', digest: 'nope', sizeBytes: 1, mediaType: 'image/png' }
  assert.equal(checkArtifactPlacement(badDigest as unknown as PackageArtifact).ok, false)

  const badSize = { storage: 'cas', digest, sizeBytes: -1, mediaType: 'image/png' }
  assert.equal(checkArtifactPlacement(badSize as unknown as PackageArtifact).ok, false)

  const badStorage = { storage: 'ftp', digest, sizeBytes: 1, mediaType: 'image/png' }
  assert.equal(checkArtifactPlacement(badStorage as unknown as PackageArtifact).ok, false)

  const badBase64 = { storage: 'inline', base64: '!!!', mediaType: 'text/plain' }
  assert.equal(checkArtifactPlacement(badBase64 as unknown as PackageArtifact).ok, false)
})
