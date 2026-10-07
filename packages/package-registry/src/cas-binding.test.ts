import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createArtifactStore } from '@playliquid/artifact-store'
import { InMemoryBlobStore } from '@playliquid/artifact-store'
import type { ArtifactStore } from '@playliquid/artifact-store'
import {
  fetchRecordFromCas,
  packageRecordContentBytes,
  publishPackage,
  publishRecordToCas,
  verifyLockAgainstStores,
  verifyRecordArtifacts,
} from './cas-binding.ts'
import { openRegistry } from './registry.ts'
import type { PackageRegistry } from './registry.ts'
import { InMemoryRegistryStore } from './registry-store.ts'
import {
  capability,
  makeCasArtifact,
  makeLock,
  makeMetadata,
  makePin,
  makeRecord,
  requires,
} from './test-fixtures.ts'
import { computeBlobDigest, utf8Bytes } from '@playliquid/artifact-store'

const wire = async (): Promise<{
  blobs: InMemoryBlobStore
  artifacts: ArtifactStore
  registry: PackageRegistry
}> => {
  const blobs = new InMemoryBlobStore()
  const artifacts = createArtifactStore({ blobStore: blobs })
  const opened = await openRegistry({ store: new InMemoryRegistryStore() })
  assert.equal(opened.ok, true)
  if (!opened.ok) {
    throw new Error('unreachable')
  }
  return { blobs, artifacts, registry: opened.registry }
}

/** A record whose metadata references one stored CAS artifact. */
async function recordWithArtifact(
  artifacts: ArtifactStore,
  id: string,
): Promise<ReturnType<typeof makeRecord>> {
  const bytes = utf8Bytes(`artifact-bytes-for-${id}`)
  const digest = computeBlobDigest(bytes)
  const stored = artifacts.store(bytes, { mediaType: 'model/gltf-binary' })
  assert.equal(stored.ok, true)
  return makeRecord('assets', id, '1.0.0', {
    artifacts: [makeCasArtifact(bytes, digest, 'model/gltf-binary')],
  })
}

test('the binding invariant: record content bytes hash to the record digest', () => {
  const record = makeRecord('assets', '@demo/base', '1.0.0', makeMetadata())
  const bytes = packageRecordContentBytes(record)
  assert.equal(computeBlobDigest(bytes), record.identity.contentDigest)
})

test('the invariant holds for every field of the metadata surface', () => {
  const record = makeRecord('system', '@demo/full', '2.3.4', {
    dependencies: [{ id: '@demo/base', constraint: '^1.0.0', kind: 'assets', optional: false }],
    providedCapabilities: [capability('sim.deterministic-step', '1.1.0')],
    requiredCapabilities: [requires('asset.mesh-format', '*')],
    permissions: [{ capability: 'asset.mesh-format', access: 'read' }],
    compatibility: { runtimes: ['simulation'], engines: ['native'], targets: [] },
    resources: { minMemoryBytes: 128 },
  })
  assert.equal(
    computeBlobDigest(packageRecordContentBytes(record)),
    record.identity.contentDigest,
  )
})

test('publishRecordToCas stores content whose digest equals the record digest', async () => {
  const { artifacts } = await wire()
  const record = makeRecord('assets', '@demo/base', '1.0.0')
  const result = publishRecordToCas(artifacts, record)
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.equal(result.manifest.digest, record.identity.contentDigest)
  assert.equal(result.deduplicated, false)
  assert.equal(artifacts.stat(record.identity.contentDigest)?.sizeBytes, packageRecordContentBytes(record).byteLength)

  const again = publishRecordToCas(artifacts, record)
  assert.equal(again.ok, true)
  if (again.ok) {
    assert.equal(again.deduplicated, true)
  }
})

test('publishRecordToCas rejects a mis-sealed record (declared digest lies)', async () => {
  const { artifacts } = await wire()
  const record = makeRecord('assets', '@demo/liar', '1.0.0')
  const misSealed = {
    ...record,
    identity: { ...record.identity, contentDigest: computeBlobDigest(utf8Bytes('other')) },
  }
  const result = publishRecordToCas(artifacts, misSealed)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'digest-mismatch')
  }
})

test('fetchRecordFromCas resolves a digest back to the deep-equal record', async () => {
  const { artifacts } = await wire()
  const record = makeRecord('system', '@demo/sys', '1.0.1', {
    providedCapabilities: [capability('sim.deterministic-step', '1.0.0')],
  })
  assert.equal(publishRecordToCas(artifacts, record).ok, true)
  const fetched = fetchRecordFromCas(artifacts, record.identity.contentDigest)
  assert.equal(fetched.ok, true)
  if (!fetched.ok) {
    return
  }
  assert.deepEqual(fetched.record, record)
})

test('fetchRecordFromCas: unknown digest fails closed', async () => {
  const { artifacts } = await wire()
  const result = fetchRecordFromCas(artifacts, computeBlobDigest(utf8Bytes('never stored')))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'unknown-digest')
  }
})

test('fetchRecordFromCas: corrupted content is an integrity failure (E10)', async () => {
  const { blobs, artifacts } = await wire()
  const record = makeRecord('assets', '@demo/base', '1.0.0')
  assert.equal(publishRecordToCas(artifacts, record).ok, true)
  // The record content is a single chunk for small records at default size.
  const stat = artifacts.stat(record.identity.contentDigest)
  assert.ok(stat !== null)
  assert.equal(blobs.corruptChunkForTests(record.identity.contentDigest, 0), true)
  const result = fetchRecordFromCas(artifacts, record.identity.contentDigest)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'integrity')
  }
})

test('fetchRecordFromCas: non-JSON content is invalid-record-content', async () => {
  const { artifacts } = await wire()
  const stored = artifacts.store(utf8Bytes('this is not a package record'))
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const result = fetchRecordFromCas(artifacts, stored.manifest.digest)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'invalid-record-content')
  }
})

test('fetchRecordFromCas: non-canonical stored content re-seals to a different digest', async () => {
  const { artifacts } = await wire()
  const record = makeRecord('assets', '@demo/base', '1.0.0')
  // Hand-built JSON with reversed key order and whitespace: parses to the
  // same value but is NOT the canonical serialization.
  const nonCanonical = JSON.stringify(
    { metadata: record.metadata, identity: { version: record.identity.version, id: record.identity.id, kind: record.identity.kind } },
    null,
    2,
  )
  const stored = artifacts.store(utf8Bytes(nonCanonical))
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const result = fetchRecordFromCas(artifacts, stored.manifest.digest)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'digest-mismatch')
  }
})

test('verifyRecordArtifacts: present with declared size and media type passes', async () => {
  const { artifacts } = await wire()
  const record = await recordWithArtifact(artifacts, '@demo/with-artifact')
  const verdict = verifyRecordArtifacts(record, artifacts)
  assert.deepEqual(verdict, { ok: true, problems: [] })
})

test('verifyRecordArtifacts: missing, size-mismatched and mistyped artifacts fail', async () => {
  const { artifacts } = await wire()
  const bytes = utf8Bytes('artifact-bytes')
  const digest = computeBlobDigest(bytes)
  const stored = artifacts.store(bytes, { mediaType: 'model/gltf-binary' })
  assert.equal(stored.ok, true)

  const missing = makeRecord('assets', '@demo/missing', '1.0.0', {
    artifacts: [makeCasArtifact(bytes, computeBlobDigest(utf8Bytes('other bytes')), 'model/gltf-binary')],
  })
  const missingVerdict = verifyRecordArtifacts(missing, artifacts)
  assert.equal(missingVerdict.ok, false)
  assert.equal(missingVerdict.problems[0]?.code, 'artifact-missing')

  const wrongSize = makeRecord('assets', '@demo/wrong-size', '1.0.0', {
    artifacts: [{ storage: 'cas', digest, sizeBytes: bytes.byteLength + 1, mediaType: 'model/gltf-binary' }],
  })
  const sizeVerdict = verifyRecordArtifacts(wrongSize, artifacts)
  assert.equal(sizeVerdict.ok, false)
  assert.equal(sizeVerdict.problems[0]?.code, 'artifact-size-mismatch')

  const wrongType = makeRecord('assets', '@demo/wrong-type', '1.0.0', {
    artifacts: [makeCasArtifact(bytes, digest, 'image/png')],
  })
  const typeVerdict = verifyRecordArtifacts(wrongType, artifacts)
  assert.equal(typeVerdict.ok, false)
  assert.equal(typeVerdict.problems[0]?.code, 'artifact-media-type-mismatch')
})

test('inline artifacts in metadata are ignored by CAS verification (not CAS refs)', async () => {
  const { artifacts } = await wire()
  const inline = makeRecord('assets', '@demo/inline', '1.0.0', {
    artifacts: [{ storage: 'inline', base64: Buffer.from('tiny').toString('base64'), mediaType: 'text/plain' }],
  })
  assert.deepEqual(verifyRecordArtifacts(inline, artifacts), { ok: true, problems: [] })
})

test('verifyLockAgainstStores: a fully published graph passes against BOTH authorities', async () => {
  const { artifacts, registry } = await wire()
  const base = await recordWithArtifact(artifacts, '@demo/base')
  const top = makeRecord('world', '@demo/top', '1.0.0', {
    dependencies: [{ id: '@demo/base', constraint: '^1.0.0', kind: 'assets', optional: false }],
    requiredCapabilities: [requires('sim.deterministic-step', '*')],
  })
  const provider = makeRecord('system', '@demo/provider', '1.0.0', {
    providedCapabilities: [capability('sim.deterministic-step', '1.0.0')],
  })
  for (const record of [base, provider, top]) {
    const result = await publishPackage(record, { registry, artifacts })
    assert.equal(result.ok, true, JSON.stringify(result))
  }
  const lock = makeLock([base, provider, top])
  const verification = verifyLockAgainstStores(lock, { registry, artifacts })
  assert.equal(verification.pass, true)
  assert.equal(verification.pins.length, 3)
  assert.ok(verification.pins.every((pin) => pin.ok))
  assert.equal(verification.resolution.ok, true)
})

test('verifyLockAgainstStores is deterministic across runs (E9)', async () => {
  const { artifacts, registry } = await wire()
  const record = await recordWithArtifact(artifacts, '@demo/base')
  await publishPackage(record, { registry, artifacts })
  const lock = makeLock([record])
  assert.deepEqual(
    verifyLockAgainstStores(lock, { registry, artifacts }),
    verifyLockAgainstStores(lock, { registry, artifacts }),
  )
})

test('unverified lockfile pin: tampered digest fails against the registry', async () => {
  const { artifacts, registry } = await wire()
  const record = await recordWithArtifact(artifacts, '@demo/base')
  await publishPackage(record, { registry, artifacts })
  const tampered = makeLock([record])
  ;(tampered.packages[0] as { contentDigest: string }).contentDigest = computeBlobDigest(
    utf8Bytes('tampered'),
  )
  const verification = verifyLockAgainstStores(tampered, { registry, artifacts })
  assert.equal(verification.pass, false)
  assert.equal(verification.pins[0]?.ok, false)
  assert.equal(verification.pins[0]?.problems[0]?.code, 'digest-mismatch')
})

test('unverified lockfile pin: record content missing from the CAS fails (lock rule 10)', async () => {
  const { artifacts, registry } = await wire()
  const record = makeRecord('assets', '@demo/no-cas', '1.0.0')
  // Published to the registry only — its content bytes were never stored.
  assert.equal((await registry.publish(record)).ok, true)
  const verification = verifyLockAgainstStores(makeLock([record]), { registry, artifacts })
  assert.equal(verification.pass, false)
  assert.equal(verification.pins[0]?.problems[0]?.code, 'record-content-missing')
})

test('unverified lockfile pin: corrupted record content in the CAS fails', async () => {
  const { blobs, artifacts, registry } = await wire()
  const record = makeRecord('assets', '@demo/decay', '1.0.0')
  await publishPackage(record, { registry, artifacts })
  assert.equal(blobs.corruptChunkForTests(record.identity.contentDigest, 0), true)
  const verification = verifyLockAgainstStores(makeLock([record]), { registry, artifacts })
  assert.equal(verification.pass, false)
  assert.equal(verification.pins[0]?.problems[0]?.code, 'record-content-integrity')
})

test('unverified lockfile pin: missing declared artifact fails', async () => {
  const { artifacts, registry } = await wire()
  const bytes = utf8Bytes('artifact-that-was-never-stored')
  const record = makeRecord('assets', '@demo/ghost-artifact', '1.0.0', {
    artifacts: [makeCasArtifact(bytes, computeBlobDigest(bytes))],
  })
  // Opt out of artifact verification to stage the incomplete record.
  const staged = await publishPackage(record, { registry, artifacts }, { verifyArtifacts: false })
  assert.equal(staged.ok, true)
  const verification = verifyLockAgainstStores(makeLock([record]), { registry, artifacts })
  assert.equal(verification.pass, false)
  assert.equal(verification.pins[0]?.problems[0]?.code, 'artifact-missing')
})

test('a pin absent from the registry reports missing-package', async () => {
  const { artifacts, registry } = await wire()
  const absent = makeRecord('assets', '@demo/absent', '1.0.0')
  const verification = verifyLockAgainstStores(makeLock([absent]), { registry, artifacts })
  assert.equal(verification.pass, false)
  assert.equal(verification.pins[0]?.problems[0]?.code, 'missing-package')
})

test('graph failures surface through the resolution arm', async () => {
  const { artifacts, registry } = await wire()
  const a = makeRecord('system', '@demo/a', '1.0.0', {
    dependencies: [{ id: '@demo/b', constraint: '*', kind: null, optional: false }],
  })
  const b = makeRecord('system', '@demo/b', '1.0.0', {
    dependencies: [{ id: '@demo/a', constraint: '*', kind: null, optional: false }],
  })
  for (const record of [a, b]) {
    await publishPackage(record, { registry, artifacts })
  }
  const verification = verifyLockAgainstStores(makeLock([a, b]), { registry, artifacts })
  assert.equal(verification.pass, false)
  assert.ok(verification.pins.every((pin) => pin.ok))
  assert.equal(verification.resolution.ok, false)
  if (!verification.resolution.ok) {
    assert.equal(verification.resolution.code, 'cyclic-dependency')
  }
})

test('publishPackage: fail-closed ordering — nothing is published on missing artifacts', async () => {
  const { artifacts, registry } = await wire()
  const bytes = utf8Bytes('late-uploaded-artifact')
  const record = makeRecord('assets', '@demo/late', '1.0.0', {
    artifacts: [makeCasArtifact(bytes, computeBlobDigest(bytes))],
  })
  const result = await publishPackage(record, { registry, artifacts })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.stage, 'artifact-verification')
    assert.equal(result.problems?.[0]?.code, 'artifact-missing')
  }
  assert.equal(registry.size(), 0)
  assert.equal(artifacts.stat(record.identity.contentDigest), null)
})

test('publishPackage: staged upload opt-out publishes, lock verification still catches it', async () => {
  const { artifacts, registry } = await wire()
  const bytes = utf8Bytes('staged-artifact')
  const record = makeRecord('assets', '@demo/staged', '1.0.0', {
    artifacts: [makeCasArtifact(bytes, computeBlobDigest(bytes))],
  })
  const staged = await publishPackage(record, { registry, artifacts }, { verifyArtifacts: false })
  assert.equal(staged.ok, true)
  assert.equal(registry.size(), 1)
  // Late upload completes the graph.
  const uploaded = artifacts.store(bytes)
  assert.equal(uploaded.ok, true)
  const verification = verifyLockAgainstStores(makeLock([record]), { registry, artifacts })
  assert.equal(verification.pass, true)
})

test('publishPackage: a registry rejection leaves CAS content but no record', async () => {
  const { artifacts } = await wire()
  const blobs = new InMemoryRegistryStore()
  const opened = await openRegistry({ store: blobs })
  assert.equal(opened.ok, true)
  if (!opened.ok) {
    return
  }
  const registry = opened.registry
  const unverified = makeRecord('assets', '@demo/unverified', '1.0.0', {
    license: { spdxExpression: 'MIT', status: 'declared' },
  })
  const result = await publishPackage(unverified, { registry, artifacts })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.stage, 'registry')
    assert.equal(result.message.includes('release gate'), true)
  }
  assert.equal(registry.size(), 0)
  // Record content WAS stored in the CAS (harmless; the registry is the
  // package authority — content without a published record is inert).
  assert.ok(artifacts.stat(unverified.identity.contentDigest) !== null)
})

test('pins are verified in canonical id order regardless of lock order', async () => {
  const { artifacts, registry } = await wire()
  const base = await recordWithArtifact(artifacts, '@demo/base')
  const top = makeRecord('world', '@demo/top', '1.0.0', {
    dependencies: [{ id: '@demo/base', constraint: '*', kind: null, optional: false }],
  })
  await publishPackage(base, { registry, artifacts })
  await publishPackage(top, { registry, artifacts })
  const ordered = verifyLockAgainstStores(makeLock([base, top]), { registry, artifacts })
  const reversed = verifyLockAgainstStores(makeLock([top, base]), { registry, artifacts })
  assert.equal(ordered.pass, true)
  assert.deepEqual(ordered, reversed)
  assert.deepEqual(
    ordered.pins.map((pin) => pin.pin.id),
    ['@demo/base', '@demo/top'],
  )
})

test('makePin/lock fixtures round-trip through publish + verify', async () => {
  const { artifacts, registry } = await wire()
  const record = await recordWithArtifact(artifacts, '@demo/round-trip')
  await publishPackage(record, { registry, artifacts })
  const pin = makePin(record, 'https://registry.example.invalid/@demo/round-trip')
  const lock = { lockVersion: 1 as const, packages: [pin], hostCapabilities: [] }
  const verification = verifyLockAgainstStores(lock, { registry, artifacts })
  assert.equal(verification.pass, true)
})
