# PL-011 Evidence — @playliquid/package-registry

Real gate outputs captured in the work sandbox on branch `work/pl-011`,
base `c9cf856` (pinned; never rebased).

Environment: Node v24.21.0, TypeScript 6.0.2, oxlint 1.60.0 (installed via
the root workspace `node_modules` — untracked, gitignored; the central
pnpm lockfile was NOT touched and was restored before the final commit).

External runtime dependencies: none beyond the workspace —
`@playliquid/package-system` (PL-002) and `@playliquid/artifact-store`
(PL-011 sibling, workspace link). Resolution and validation contracts are
imported from package-system, never re-implemented.

## Gates

### 1. Typecheck — PASS (exit 0, 0 errors)

Command:

```bash
cd packages/package-registry && ../../node_modules/.bin/tsc -p .
```

Output: (no diagnostics, exit 0)

### 2. Tests — PASS: 65 tests, 65 passed / 0 failed / 0 skipped

Command:

```bash
cd packages/package-registry && node --test src/**/*.test.ts
```

Output (tail):

```
ℹ tests 65
ℹ suites 0
ℹ pass 65
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 709.898503
```

Behavior coverage (work-order mandate): publish idempotency (identical
record → `already-published`); republish-with-mutation rejection (E8, lock
rule 8); kind conflict at the same coordinate; structural validation with
violations attached; R19 release gate fail-closed by default + explicit
opt-out; deep-frozen stored records (mutation throws) with caller-input
isolation; stable listing (id, then precedence, then formatted tie-break)
across shuffled insertion orders (E9); exact lookups with significant
build metadata and kind; `bestMatch` determinism; capability
provider/requirement lookups and permission filters; deterministic
resolution reusing package-system (same lock + shuffled index → deep-equal
result, including lock fingerprint); cyclic dependency rejection;
unverified lockfile pin (tampered digest → `digest-mismatch`); optional vs
required missing dependency; credential-shaped provenance URL assembled
from fragments at runtime and rejected; store fake round-trip/idempotency/
defensive copies; facade open-load (clean, empty, invalid store, conflicting
store, failing port); publish transactionality (store-error leaves the
index untouched; retry succeeds); concurrent conflicting publishes
serialize with exactly one winner (E1/E2); CAS binding invariant (record
content bytes hash to the record digest); CAS round-trip deep-equality;
unknown-digest / corrupted-content / non-JSON / non-canonical content
failures; artifact verification (missing / size-mismatch / media-type
mismatch; inline artifacts excluded); lock verification against BOTH
authorities (happy path, tampered pin, missing CAS content, corrupted CAS
content, missing declared artifact, absent package, cyclic graph via the
resolution arm); fail-closed `publishPackage` ordering (nothing published
on missing artifacts); staged-upload opt-out with late completion; registry
rejection leaves inert CAS content; canonical pin order regardless of lock
order.

### 3. Lint — PASS (exit 0, 0 warnings, 0 errors)

Command:

```bash
cd packages/package-registry && ../../node_modules/.bin/oxlint .
```

Output:

```
Found 0 warnings and 0 errors.
Finished in 11ms on 12 files using 2 threads.
```

### 4. Architecture — PASS (repository gate, run from the root)

Command:

```bash
node scripts/architecture/architecture-check.mjs check --changed
```

Output:

```
architecture: OK
violations: 0
baseline: 0
new: 0
```

### 5. Harness — PASS (exit 0)

Command: `node src/harness.ts` → `harness: PASS`

Canonical summary (byte-stable across runs):

```json
{
  "publications": ["ok", "ok", "ok"],
  "registrySize": 3,
  "lockVerifiedAgainstBothStores": "yes",
  "pinsVerified": 3,
  "resolutionOk": "yes",
  "topologicalOrder": [
    "@demo/base-assets",
    "@demo/combat-system",
    "@demo/arena-world"
  ],
  "lockFingerprint": "sha256:9569354a83115693989112cb82a77f11fa66481cb13e7fe422c54753b70740e7",
  "capabilityLookup": 1,
  "permissionLookup": 0,
  "mutationRejected": "yes",
  "tamperedPinRejected": "yes"
}
```

## Environment limitations

- The `RegistryStore` port ships only the in-memory fake; remote/local
  adapters are application wiring outside this work order's surface.
- Node's type stripping is used for `.ts` execution (Node 24); no build
  step is required for tests.
