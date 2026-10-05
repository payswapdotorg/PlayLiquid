import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  capabilityProvided,
  undeclaredCapabilities,
} from './capability.ts'
import type {
  CapabilityDeclaration,
  CapabilityReference,
  PermissionRequest,
} from './capability.ts'
import { semver } from './test-fixtures.ts'

const meshV1: CapabilityDeclaration = {
  id: 'asset.mesh-format',
  version: semver('1.0.0'),
}

const meshV2: CapabilityDeclaration = {
  id: 'asset.mesh-format',
  version: semver('2.0.0'),
}

test('capabilityProvided matches id and version constraint', () => {
  const requirement: CapabilityReference = { id: 'asset.mesh-format', constraint: '^1.0.0' }
  assert.equal(capabilityProvided([meshV1], requirement)?.version, meshV1.version)
  assert.equal(capabilityProvided([meshV2], requirement), null)
  assert.equal(
    capabilityProvided([meshV2], { id: 'asset.mesh-format', constraint: '*' })?.version,
    meshV2.version,
  )
  assert.equal(capabilityProvided([], requirement), null)
  assert.equal(
    capabilityProvided([meshV1], { id: 'other.capability', constraint: '*' }),
    null,
  )
})

test('undeclaredCapabilities finds permissions beyond the declared set', () => {
  const required: CapabilityReference[] = [{ id: 'asset.mesh-format', constraint: '^1.0.0' }]
  const provided: CapabilityDeclaration[] = [meshV2]
  const permissions: PermissionRequest[] = [
    { capability: 'asset.mesh-format', access: 'read' },
    { capability: 'net.fetch', access: 'write' },
    { capability: 'fs.write', access: 'write' },
  ]
  const undeclared = undeclaredCapabilities(required, provided, permissions)
  // mesh-format counts as declared via the requirement even though the
  // provided version does not satisfy it; net.fetch and fs.write do not.
  assert.deepEqual(
    undeclared.map((permission) => permission.capability),
    ['net.fetch', 'fs.write'],
  )
})

test('permissions on self-provided capabilities are declared', () => {
  const permissions: PermissionRequest[] = [
    { capability: 'asset.mesh-format', access: 'read' },
  ]
  assert.deepEqual(undeclaredCapabilities([], [meshV1], permissions), [])
})

test('empty permission sets never over-declare', () => {
  assert.deepEqual(undeclaredCapabilities([], [], []), [])
})
