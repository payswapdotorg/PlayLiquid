/**
 * Pure-check harness (PL-011 evidence) — package registry + CAS wiring.
 *
 * Builds a three-package graph over the artifact store and the registry
 * (both in-memory fakes), publishes every package through the fail-closed
 * `publishPackage` path, locks the graph, verifies the lock against BOTH
 * authorities, resolves deterministically, then proves the negative paths
 * (mutation rejection, unverified pin). Prints a canonical summary so the
 * output is byte-stable across runs and machines.
 *
 * Run: `node src/harness.ts`
 * Exit code 0 when every check passes, 1 otherwise.
 */

import { createArtifactStore } from '@playliquid/artifact-store'
import { computeBlobDigest, utf8Bytes } from '@playliquid/artifact-store'
import {
  openRegistry,
  publishPackage,
  verifyLockAgainstStores,
} from './index.ts'
import { InMemoryRegistryStore } from './index.ts'
import { capability, makeLock, makeRecord, requires } from './test-fixtures.ts'

const artifacts = createArtifactStore()
const opened = await openRegistry({ store: new InMemoryRegistryStore() })
if (!opened.ok) {
  console.error('harness: FAIL (registry did not open)')
  process.exit(1)
}
const registry = opened.registry

const meshBytes = utf8Bytes('harness-mesh-artifact')
const meshDigest = computeBlobDigest(meshBytes)
artifacts.store(meshBytes, { mediaType: 'model/gltf-binary' })

const base = makeRecord('assets', '@demo/base-assets', '1.4.2', {
  providedCapabilities: [capability('asset.mesh-format', '1.0.0')],
  artifacts: [
    { storage: 'cas', digest: meshDigest, sizeBytes: meshBytes.byteLength, mediaType: 'model/gltf-binary' },
  ],
})
const combat = makeRecord('system', '@demo/combat-system', '0.3.1', {
  dependencies: [
    { id: '@demo/base-assets', constraint: '^1.0.0', kind: 'assets', optional: false },
  ],
  providedCapabilities: [capability('sim.deterministic-step', '1.1.0')],
  requiredCapabilities: [requires('asset.mesh-format', '^1.0.0')],
})
const world = makeRecord('world', '@demo/arena-world', '2.1.0', {
  dependencies: [
    { id: '@demo/base-assets', constraint: '^1.0.0', kind: 'assets', optional: false },
    { id: '@demo/combat-system', constraint: '~0.3.0', kind: 'system', optional: false },
  ],
  requiredCapabilities: [
    requires('sim.deterministic-step', '^1.0.0'),
    requires('asset.mesh-format', '*'),
  ],
})

const publications = []
for (const record of [base, combat, world]) {
  const result = await publishPackage(record, { registry, artifacts })
  publications.push(result.ok ? 'ok' : `fail:${result.ok ? '' : result.stage}`)
}

const lock = makeLock([world, combat, base])
const verification = verifyLockAgainstStores(lock, { registry, artifacts })
const resolution = registry.resolveLock(lock)

const mutationProbe = await registry.publish(
  makeRecord('assets', '@demo/base-assets', '1.4.2', {
    resources: { minMemoryBytes: 4096 },
  }),
)

const tampered = makeLock([base])
;(tampered.packages[0] as { contentDigest: string }).contentDigest = computeBlobDigest(
  utf8Bytes('tampered-pin'),
)
const tamperedVerification = verifyLockAgainstStores(tampered, { registry, artifacts })

const summary = {
  publications,
  registrySize: registry.size(),
  lockVerifiedAgainstBothStores: verification.pass ? 'yes' : 'no',
  pinsVerified: verification.pins.filter((pin) => pin.ok).length,
  resolutionOk: resolution.ok ? 'yes' : 'no',
  topologicalOrder: resolution.ok ? resolution.topologicalOrder : [],
  lockFingerprint: resolution.ok ? resolution.lockFingerprint : 'none',
  capabilityLookup: registry.findProviders(requires('asset.mesh-format', '*')).length,
  permissionLookup: registry.findByPermission('sim.deterministic-step').length,
  mutationRejected: !mutationProbe.ok && mutationProbe.code === 'mutation-rejected' ? 'yes' : 'no',
  tamperedPinRejected:
    !tamperedVerification.pass &&
    tamperedVerification.pins[0]?.problems[0]?.code === 'digest-mismatch'
      ? 'yes'
      : 'no',
}

console.log(JSON.stringify(summary, null, 2))

const pass =
  publications.every((entry) => entry === 'ok') &&
  summary.registrySize === 3 &&
  summary.lockVerifiedAgainstBothStores === 'yes' &&
  summary.pinsVerified === 3 &&
  summary.resolutionOk === 'yes' &&
  summary.topologicalOrder.join(',') === '@demo/base-assets,@demo/combat-system,@demo/arena-world' &&
  summary.capabilityLookup === 1 &&
  summary.permissionLookup === 0 &&
  summary.mutationRejected === 'yes' &&
  summary.tamperedPinRejected === 'yes'

console.log(pass ? 'harness: PASS' : 'harness: FAIL')
process.exit(pass ? 0 : 1)
