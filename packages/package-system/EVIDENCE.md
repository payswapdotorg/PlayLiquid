# PL-002 Evidence — @playliquid/package-system

Real gate outputs captured in the work sandbox on branch `work/PL-002`,
base `b88e814755e9bd1efed6cb6f8e26f316bada1247`.

Environment: Node v24.21.0, npm 11.19.0, TypeScript 6.0.2, oxlint 1.57.0
(typescript/@types/node/oxlint installed locally to the sandbox `node_modules`
only — untracked, gitignored; the central pnpm lockfile was NOT touched and
no root pnpm install was run).

## Gates

### 1. Typecheck — PASS (exit 0)

Command:

```bash
cd ~/PlayLiquid/packages/package-system && npx tsc -p .
```

Output: (no diagnostics, exit 0)

### 2. Tests — PASS: 102 tests, 102 passed, 0 failed

Command:

```bash
cd ~/PlayLiquid/packages/package-system && node --test 'src/**/*.test.ts'
```

Output (tail):

```
ℹ tests 102
ℹ suites 0
ℹ pass 102
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1350.203581
```

Note on the `node --test src/` form: on Node v24.21.0, a directory positional
argument is treated as a literal test-file path and fails with
`Error: Cannot find module '.../packages/package-system/src'` (the child
process CJS-loads the directory). The quoted glob form above is the exact
equivalent that discovers and runs all `src/*.test.ts` files and is what the
`test` script in `package.json` uses.

### 3. Lint — PASS: 0 warnings, 0 errors

Command:

```bash
cd ~/PlayLiquid && npx oxlint packages/package-system
```

Output:

```
Found 0 warnings and 0 errors.
Finished in 15ms on 29 files with 94 rules using 2 threads.
```

### 4. Runtime pure-check harness — PASS (exit 0, byte-identical across runs)

Command:

```bash
cd ~/PlayLiquid/packages/package-system && node src/harness.ts
```

Output (full; verified byte-identical across two consecutive runs):

```
=== PlayLiquid package-system pure-check harness (PL-002) ===
{"dependencyGraph":[{"dependsOn":["@demo/base-assets","@demo/combat-system"],"id":"@demo/arena-world"},{"dependsOn":[],"id":"@demo/base-assets"},{"dependsOn":["@demo/base-assets"],"id":"@demo/combat-system"}],"lockFingerprint":"sha256:83e3d4a61deb8713ccfcb9b74cc41698736ebf353c2f8f410bd30831e7dc2e7d","packages":[{"contentDigest":"sha256:0c9e451262fdfc96acae6b8a1479296a73190804a17fbce763018046ac04b633","id":"@demo/arena-world","kind":"world","version":"2.1.0"},{"contentDigest":"sha256:143d3c5da568ba4d3bc3d88c4b8b3f30afee8587f22fe7bd6839254f1f0a21b9","id":"@demo/base-assets","kind":"assets","version":"1.4.2"},{"contentDigest":"sha256:a7408acec1da2f24718d6f80624c4f8f633d5ceaebd8619e5992b9504051eac0","id":"@demo/combat-system","kind":"system","version":"0.3.1"}],"releaseGates":[{"id":"@demo/base-assets","pass":true},{"id":"@demo/combat-system","pass":true},{"id":"@demo/arena-world","pass":true}],"resolved":true,"topologicalOrder":["@demo/base-assets","@demo/combat-system","@demo/arena-world"]}
resolution: ok; release gates: 3/3 pass
```

The synthetic three-package index: `@demo/base-assets` (assets, provides
`asset.mesh-format`), `@demo/combat-system` (system, depends on base-assets
`^1.0.0`, provides `sim.deterministic-step`, requires `asset.mesh-format`),
`@demo/arena-world` (world, depends on both, requires both capabilities).
Resolution is dependencies-first, gates pass 3/3, digests are real SHA-256
over canonical JSON.

### 5. Architecture governance (informational) — OK

Command:

```bash
cd ~/PlayLiquid && node scripts/architecture/architecture-check.mjs check --changed
```

Output:

```
architecture: OK
violations: 0
baseline: 0
new: 0
```

(`pnpm` is not installed in this sandbox; the underlying node script was
invoked directly. The package is not yet registered in
`architecture-policy.yaml` — TL-owned promotion happens in PL-010.)

## Mandatory test-case coverage

- Determinism: same lock+index deep-equal across two `resolve` runs; pin-order
  invariance; index-record-order invariance; harness output byte-identical
  across runs (`src/resolve.test.ts`, `src/harness.ts`).
- Rejection: cyclic dependencies (3-cycle and self-cycle, with cycle path),
  missing package, missing digest (`digest-mismatch`, `tampered-record`),
  semver mismatch (`version-mismatch`), plus unpinned dependency, kind
  mismatches, duplicate pin/record, invalid lock/index
  (`src/resolve.test.ts`).
- Canonicalization stability: key-order invariance at every nesting level,
  array order preservation, no-whitespace output, primitive serialization,
  rejection of non-JSON values (`src/canonical-json.test.ts`,
  `src/digest.test.ts`).
- Lockfile pinning: exact version+digest recorded, fingerprint pin-order
  invariance, duplicate-pin rejection, schema-version rejection
  (`src/lockfile.test.ts`).
- Provenance gate pass/fail paths: complete record passes; missing/unverified
  license, empty transformation history, derivative without origin/source
  commit, AI-generated without disclosed model provenance all fail closed;
  multiple failures collected (`src/release-gate.test.ts`).
- E8 negative tests (tampered digest): pin-vs-record digest mismatch,
  record-content-vs-declared-digest tamper across identity and metadata
  fields (`src/resolve.test.ts`, `src/package-record.test.ts`,
  `src/release-gate.test.ts`).
