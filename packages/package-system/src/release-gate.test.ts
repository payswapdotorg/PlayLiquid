import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkReleaseGate } from './release-gate.ts'
import { sealPackageRecord } from './package-digest.ts'
import { makeMetadata, makeRecord } from './test-fixtures.ts'
import type { PackageRecord } from './package-record.ts'
import { computePackageDigest } from './package-digest.ts'

const gate = (record: PackageRecord) => checkReleaseGate(record)

test('a complete record passes the release gate', () => {
  const record = makeRecord('world', '@demo/world', '1.0.0')
  const result = gate(record)
  assert.deepEqual(result, { pass: true, reasons: [] })
})

test('missing license fails closed (R19)', () => {
  const base = makeRecord('world', '@demo/world', '1.0.0')
  const record = sealPackageRecord({
    identity: { kind: base.identity.kind, id: base.identity.id, version: base.identity.version },
    metadata: { ...base.metadata, license: { spdxExpression: '', status: 'unknown' } },
  })
  const result = gate(record)
  assert.equal(result.pass, false)
  assert.ok(result.reasons.some((reason) => reason.code === 'license-missing'))
})

test('unverified license fails closed (R19)', () => {
  const base = makeRecord('world', '@demo/world', '1.0.0')
  const record = sealPackageRecord({
    identity: { kind: base.identity.kind, id: base.identity.id, version: base.identity.version },
    metadata: {
      ...base.metadata,
      license: { spdxExpression: 'MIT', status: 'declared' },
    },
  })
  const result = gate(record)
  assert.equal(result.pass, false)
  assert.ok(result.reasons.some((reason) => reason.code === 'license-unverified'))
})

test('empty transformation history fails closed (R19)', () => {
  const base = makeRecord('world', '@demo/world', '1.0.0')
  const record = sealPackageRecord({
    identity: { kind: base.identity.kind, id: base.identity.id, version: base.identity.version },
    metadata: {
      ...base.metadata,
      provenance: { ...base.metadata.provenance, transformationHistory: [] },
    },
  })
  const result = gate(record)
  assert.equal(result.pass, false)
  assert.ok(result.reasons.some((reason) => reason.code === 'provenance-incomplete'))
})

test('derivatives must retain origin and source commit (R19)', () => {
  const parent = makeRecord('world', '@demo/parent', '1.0.0')
  const parentCoordinate = {
    kind: parent.identity.kind,
    id: parent.identity.id,
    version: parent.identity.version,
    contentDigest: parent.identity.contentDigest,
  }
  const base = makeRecord('world', '@demo/child', '1.0.0')

  const noCommit = sealPackageRecord({
    identity: { kind: base.identity.kind, id: base.identity.id, version: base.identity.version },
    metadata: {
      ...base.metadata,
      lineage: { origin: parentCoordinate, parent: parentCoordinate },
      provenance: { ...base.metadata.provenance, sourceCommit: null },
    },
  })
  assert.equal(gate(noCommit).pass, false)
  assert.ok(
    gate(noCommit).reasons.some((reason) => reason.code === 'provenance-incomplete'),
  )

  const noOrigin = sealPackageRecord({
    identity: { kind: base.identity.kind, id: base.identity.id, version: base.identity.version },
    metadata: {
      ...base.metadata,
      lineage: { origin: null, parent: parentCoordinate },
    },
  })
  assert.equal(gate(noOrigin).pass, false)
  assert.ok(
    gate(noOrigin).reasons.some((reason) => reason.code === 'provenance-incomplete'),
  )
})

test('a complete derivative passes the gate', () => {
  const parent = makeRecord('world', '@demo/parent', '1.0.0')
  const parentCoordinate = {
    kind: parent.identity.kind,
    id: parent.identity.id,
    version: parent.identity.version,
    contentDigest: parent.identity.contentDigest,
  }
  const derivative = makeRecord('world', '@demo/child', '1.0.0', {
    lineage: { origin: parentCoordinate, parent: parentCoordinate },
    provenance: {
      origin: { type: 'package', coordinate: parentCoordinate },
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      transformationHistory: [
        { kind: 'derive', description: 'derived arena variant', tool: 'playliquid-fork' },
      ],
      modelProvenance: [],
      generatedByAi: false,
    },
  })
  assert.deepEqual(gate(derivative), { pass: true, reasons: [] })
})

test('AI-generated packages must carry disclosed model provenance (R19)', () => {
  const base = makeRecord('assets', '@demo/ai-assets', '1.0.0')

  const noProvenance = sealPackageRecord({
    identity: { kind: base.identity.kind, id: base.identity.id, version: base.identity.version },
    metadata: {
      ...base.metadata,
      provenance: { ...base.metadata.provenance, generatedByAi: true },
    },
  })
  assert.equal(gate(noProvenance).pass, false)
  assert.ok(
    gate(noProvenance).reasons.some((reason) => reason.code === 'model-provenance-missing'),
  )

  const undisclosed = sealPackageRecord({
    identity: { kind: base.identity.kind, id: base.identity.id, version: base.identity.version },
    metadata: {
      ...base.metadata,
      provenance: {
        ...base.metadata.provenance,
        generatedByAi: true,
        modelProvenance: [
          { model: 'demo-model', provider: 'demo-provider', usage: 'generation', disclosed: false },
        ],
      },
    },
  })
  assert.equal(gate(undisclosed).pass, false)
  assert.ok(
    gate(undisclosed).reasons.some((reason) => reason.code === 'model-provenance-missing'),
  )

  const disclosed = sealPackageRecord({
    identity: { kind: base.identity.kind, id: base.identity.id, version: base.identity.version },
    metadata: {
      ...base.metadata,
      provenance: {
        ...base.metadata.provenance,
        generatedByAi: true,
        modelProvenance: [
          { model: 'demo-model', provider: 'demo-provider', usage: 'generation', disclosed: true },
        ],
      },
    },
  })
  assert.deepEqual(gate(disclosed), { pass: true, reasons: [] })
})

test('tampered digest fails the gate (E8)', () => {
  const record = makeRecord('world', '@demo/world', '1.0.0')
  const real = computePackageDigest(record)
  const tampered: PackageRecord = {
    ...record,
    identity: {
      ...record.identity,
      contentDigest: real.slice(0, -1) + (real.endsWith('0') ? '1' : '0'),
    },
  }
  const result = gate(tampered)
  assert.equal(result.pass, false)
  assert.ok(result.reasons.some((reason) => reason.code === 'digest-integrity'))
})

test('multiple failures are all collected', () => {
  const base = makeRecord('world', '@demo/world', '1.0.0')
  const record = sealPackageRecord({
    identity: { kind: base.identity.kind, id: base.identity.id, version: base.identity.version },
    metadata: {
      ...base.metadata,
      license: { spdxExpression: 'MIT', status: 'declared' },
      provenance: {
        ...base.metadata.provenance,
        generatedByAi: true,
        transformationHistory: [],
      },
    },
  })
  const result = gate(record)
  assert.equal(result.pass, false)
  const codes = result.reasons.map((reason) => reason.code)
  assert.ok(codes.includes('license-unverified'))
  assert.ok(codes.includes('provenance-incomplete'))
  assert.ok(codes.includes('model-provenance-missing'))
})

test('metadata defaults are gate-passing', () => {
  const metadata = makeMetadata()
  assert.equal(metadata.license.status, 'verified')
  assert.ok(metadata.provenance.transformationHistory.length > 0)
})
