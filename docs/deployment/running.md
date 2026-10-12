# How to run everything (PL-044)

All commands run from the repo root unless stated. Node v24+ (TS
type-stripping — no vitest, no jest, no bundler); `corepack pnpm` if a
package manager is needed.

## The operations service (services/ops)

```bash
cd services/ops
npx tsc -p .                                   # type-check: exit 0
node --test "src/**/*.test.ts"                 # 48 tests: worker (9), worker-doors (7),
                                               # worker-restore (6), health (13), web-host (13)
npx oxlint src/                                # 0 warnings, 0 errors
```

## The deployment tree (deployment/)

```bash
cd deployment
npx tsc -p .                                   # type-check: exit 0
node --test "src/**/*.test.ts"                 # 31 tests: verifier (6), negative (12),
                                               # journal (6), manifest (4)
npx oxlint src/                                # 0 warnings, 0 errors
```

The manifest test reads and re-verifies
`deployment/manifests/deployment-plan.json` against a freshly built
corpus, and asserts regeneration reproduces the committed file
byte-for-byte. To regenerate the manifest after changing the corpus
(the committed seal changes when the topology does):

```bash
node -e "const { writeFileSync } = require('node:fs'); \
  import('./deployment/src/manifest.ts').then((m) => \
    writeFileSync('deployment/manifests/deployment-plan.json', m.generateDeploymentManifestJson()));"
```

## The repo gates (from the root)

```bash
npx oxlint services deployment                 # 0 warnings, 0 errors
node scripts/architecture/architecture-check.mjs check --changed   # OK, 4 baseline, 0 new
git status                                    # no pnpm-lock.yaml change
```

## Determinism check (E9)

Run BOTH suites TWICE — pass counts, digests and seals must be
identical across runs (the committed manifest makes this literal: the
second run re-derives the same seal bytes). The full program's
convention: run twice before committing.

## What "running" means here (E11)

Everything above runs in-process: the services are constructed with
injected ports (in-memory stores, counting executors, fixed/stepping
clocks), the verifier runs against the in-memory registry/CAS/profile
doors, and the tests are the harness. There is no server to start, no
URL to open and no infrastructure to provision — see the honest
limits in the [README](./README.md).
