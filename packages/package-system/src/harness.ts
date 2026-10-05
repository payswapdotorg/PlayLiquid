/**
 * Pure-check harness (PL-002 evidence).
 *
 * Builds a synthetic three-package index, pins it in a lock, resolves it
 * and runs the release gate over every record. Prints a canonical-JSON
 * summary so the output is byte-stable across runs and machines.
 *
 * Run: `node src/harness.ts`
 * Exit code 0 when resolution succeeds and all gates pass, 1 otherwise.
 */

import { canonicalJson } from './canonical-json.ts'
import { checkReleaseGate } from './release-gate.ts'
import { resolve } from './resolve.ts'
import type { PackageIndex } from './resolve.ts'
import { formatSemver } from './semver.ts'
import { makeLock, makeRecord } from './test-fixtures.ts'

const baseAssets = makeRecord('assets', '@demo/base-assets', '1.4.2', {
  providedCapabilities: [
    { id: 'asset.mesh-format', version: { major: 1, minor: 0, patch: 0, prerelease: [], build: [] } },
  ],
})

const combatSystem = makeRecord('system', '@demo/combat-system', '0.3.1', {
  dependencies: [
    { id: '@demo/base-assets', constraint: '^1.0.0', kind: 'assets', optional: false },
  ],
  providedCapabilities: [
    {
      id: 'sim.deterministic-step',
      version: { major: 1, minor: 1, patch: 0, prerelease: [], build: [] },
    },
  ],
  requiredCapabilities: [
    { id: 'asset.mesh-format', constraint: '^1.0.0' },
  ],
  permissions: [
    { capability: 'asset.mesh-format', access: 'read', justification: 'mesh import' },
  ],
})

const arenaWorld = makeRecord('world', '@demo/arena-world', '2.1.0', {
  dependencies: [
    { id: '@demo/base-assets', constraint: '^1.0.0', kind: 'assets', optional: false },
    { id: '@demo/combat-system', constraint: '~0.3.0', kind: 'system', optional: false },
  ],
  requiredCapabilities: [
    { id: 'sim.deterministic-step', constraint: '^1.0.0' },
    { id: 'asset.mesh-format', constraint: '*' },
  ],
})

const records = [baseAssets, combatSystem, arenaWorld]
const index: PackageIndex = { records }
const lock = makeLock(records)

const result = resolve(lock, index)

const summary = {
  resolved: result.ok,
  lockFingerprint: result.ok ? result.lockFingerprint : null,
  topologicalOrder: result.ok ? result.topologicalOrder : null,
  packages: result.ok
    ? result.packages.map((entry) => ({
        id: entry.record.identity.id,
        version: formatSemver(entry.record.identity.version),
        kind: entry.record.identity.kind,
        contentDigest: entry.record.identity.contentDigest,
      }))
    : null,
  dependencyGraph: result.ok ? result.dependencyGraph : null,
  releaseGates: records.map((record) => ({
    id: record.identity.id,
    pass: checkReleaseGate(record).pass,
  })),
}

console.log('=== PlayLiquid package-system pure-check harness (PL-002) ===')
console.log(canonicalJson(summary))

if (!result.ok) {
  console.error(`resolution failed: ${result.code}: ${result.message}`)
  process.exitCode = 1
} else if (summary.releaseGates.some((gate) => !gate.pass)) {
  console.error('release gate failed for at least one package')
  process.exitCode = 1
} else {
  console.log('resolution: ok; release gates: 3/3 pass')
}
