import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePackageDigest, sealPackageRecord, verifyPackageDigest } from './package-digest.ts'
import type { PackageRecord } from './package-record.ts'
import { validatePackageRecord } from './validate-record.ts'
import { makeMetadata, makeRecord } from './test-fixtures.ts'

test('sealPackageRecord attaches a digest that verifies', () => {
  const record = makeRecord('world', '@demo/world', '1.2.3')
  assert.equal(verifyPackageDigest(record), true)
  assert.equal(
    record.identity.contentDigest,
    computePackageDigest({
      identity: { kind: record.identity.kind, id: record.identity.id, version: record.identity.version },
      metadata: record.metadata,
    }),
  )
})

test('sealing is key-order invariant (E9 canonicalization stability)', () => {
  const left = makeRecord('world', '@demo/world', '1.0.0')
  // Same content, constructed with different key insertion order.
  const right = sealPackageRecord({
    identity: {
      version: left.identity.version,
      id: left.identity.id,
      kind: left.identity.kind,
    },
    metadata: {
      ...left.metadata,
      license: { status: left.metadata.license.status, spdxExpression: left.metadata.license.spdxExpression },
      lineage: { parent: null, origin: null },
      compatibility: {
        targets: left.metadata.compatibility.targets,
        engines: left.metadata.compatibility.engines,
        runtimes: left.metadata.compatibility.runtimes,
      },
    },
  })
  assert.equal(left.identity.contentDigest, right.identity.contentDigest)
})

test('E8: tampering any sealed field breaks digest verification', () => {
  const record = makeRecord('world', '@demo/world', '1.0.0', {
    dependencies: [{ id: '@demo/other', constraint: '^1.0.0', kind: null, optional: false }],
  })
  const tampered: PackageRecord[] = [
    { ...record, identity: { ...record.identity, id: '@demo/tampered' } },
    { ...record, identity: { ...record.identity, version: { ...record.identity.version, patch: 9 } } },
    { ...record, metadata: { ...record.metadata, resources: { minMemoryBytes: 5 } } },
    {
      ...record,
      metadata: {
        ...record.metadata,
        dependencies: [{ id: '@demo/other', constraint: '^2.0.0', kind: null, optional: false }],
      },
    },
    {
      ...record,
      metadata: {
        ...record.metadata,
        license: { spdxExpression: 'MIT', status: 'verified' },
      },
    },
  ]
  for (const candidate of tampered) {
    assert.equal(verifyPackageDigest(candidate), false, 'tampered record must not verify')
    const violations = validatePackageRecord(candidate)
    assert.ok(
      violations.some((violation) => violation.code === 'digest-integrity'),
      'tampered record must report digest-integrity',
    )
  }
})

test('validatePackageRecord accepts a well-formed record', () => {
  assert.deepEqual(validatePackageRecord(makeRecord('game', '@demo/game', '0.1.0')), [])
})

test('validatePackageRecord rejects malformed identities', () => {
  const badKind = makeRecord('world', '@demo/w', '1.0.0')
  const asBadKind = { ...badKind, identity: { ...badKind.identity, kind: 'engine' } } as unknown as PackageRecord
  assert.ok(validatePackageRecord(asBadKind).some((v) => v.code === 'invalid-kind'))

  const badId = { ...badKind, identity: { ...badKind.identity, id: 'Not Valid' } } as PackageRecord
  assert.ok(validatePackageRecord(badId).some((v) => v.code === 'invalid-id'))

  const badDigest = { ...badKind, identity: { ...badKind.identity, contentDigest: 'bogus' } } as PackageRecord
  const digestViolations = validatePackageRecord(badDigest)
  assert.ok(digestViolations.some((v) => v.code === 'invalid-digest'))
  assert.ok(digestViolations.some((v) => v.code === 'digest-integrity'))
})

test('validatePackageRecord enforces the undeclared-capability rule', () => {
  const record = makeRecord('system', '@demo/system', '1.0.0', {
    permissions: [{ capability: 'net.fetch', access: 'write' }],
  })
  // Repair the digest so only the capability rule fires.
  const resealed = sealPackageRecord({
    identity: { kind: record.identity.kind, id: record.identity.id, version: record.identity.version },
    metadata: record.metadata,
  })
  const violations = validatePackageRecord(resealed)
  assert.ok(violations.some((v) => v.code === 'undeclared-capability'))
  assert.ok(
    violations.every((v) => v.code === 'undeclared-capability'),
    `expected only undeclared-capability, got: ${JSON.stringify(violations)}`,
  )
})

test('validatePackageRecord enforces resource sanity', () => {
  const record = makeRecord('system', '@demo/system', '1.0.0', {
    resources: { minMemoryBytes: -1 },
  })
  const resealed = sealPackageRecord({
    identity: { kind: record.identity.kind, id: record.identity.id, version: record.identity.version },
    metadata: record.metadata,
  })
  assert.ok(validatePackageRecord(resealed).some((v) => v.code === 'invalid-resources'))
})

test('validatePackageRecord enforces E7 artifact placement', () => {
  const record = makeRecord('assets', '@demo/assets', '1.0.0', {
    artifacts: [
      {
        storage: 'inline',
        base64: Buffer.from('A'.repeat(1_048_577)).toString('base64'),
        mediaType: 'application/octet-stream',
      },
    ],
  })
  const resealed = sealPackageRecord({
    identity: { kind: record.identity.kind, id: record.identity.id, version: record.identity.version },
    metadata: record.metadata,
  })
  assert.ok(
    validatePackageRecord(resealed).some((v) => v.code === 'inline-artifact-too-large'),
  )
})

test('validatePackageRecord enforces provenance URL hygiene', () => {
  const record = makeRecord('assets', '@demo/assets', '1.0.0', {
    provenance: {
      origin: { type: 'repository', url: 'https://user:pass@example.invalid/x' },
      sourceCommit: null,
      transformationHistory: [{ kind: 'author', description: 'x' }],
      modelProvenance: [],
      generatedByAi: false,
    },
  })
  const resealed = sealPackageRecord({
    identity: { kind: record.identity.kind, id: record.identity.id, version: record.identity.version },
    metadata: record.metadata,
  })
  assert.ok(validatePackageRecord(resealed).some((v) => v.code === 'invalid-provenance'))
})

test('metadata defaults are gate-clean', () => {
  const metadata = makeMetadata()
  const record = makeRecord('world', '@demo/w', '1.0.0')
  assert.deepEqual(validatePackageRecord(record), [])
  assert.equal(metadata.provenance.generatedByAi, false)
})
