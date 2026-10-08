# PL-012 Evidence — @playliquid/git-lineage

Real gate outputs captured in the work sandbox on branch `work/pl-012`,
base `c9cf856`.

Environment: Node v24.21.0, pnpm 10.33.2 (via corepack), TypeScript 6.0.2,
oxlint 1.57.0 (typescript/@types/node resolved from the workspace root;
`@playliquid/package-system` and `@playliquid/game-ir` linked as workspace
deps by pnpm — the central lockfile change was reverted before the final
commit; TL links the importer at merge time, the established PL-001..006
flow).

## Gates

### 1. Typecheck — PASS (exit 0)

Command:

```bash
cd packages/git-lineage && ../../node_modules/.bin/tsc -p .
```

Output: (no diagnostics, exit 0)

### 2. Tests — PASS: 54 tests, 54 passed, 0 failed, 0 skipped

Command (exact work-order form):

```bash
cd packages/git-lineage && node --test src/**/*.test.ts
```

Output (tail):

```
ℹ tests 54
ℹ suites 0
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 980.740535
```

### 3. Lint — PASS: 0 warnings, 0 errors

Command:

```bash
cd packages/git-lineage && ../../node_modules/.bin/oxlint .
```

Output:

```
Found 0 warnings and 0 errors.
Finished in 15ms on 16 files using 2 threads.
```

### 4. Architecture governance — OK

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

(The package is not yet registered in `architecture-policy.yaml` — TL-owned
promotion happens in PL-010, per the PL-002 precedent.)

### 5. Runtime pure-check harness — PASS (exit 0, byte-identical across runs)

Command:

```bash
cd packages/git-lineage && node src/harness.ts
```

Output (full; verified byte-identical across two consecutive runs):

```
=== PlayLiquid git-lineage pure-check harness (PL-012) ===
{"edges":3,"forkRecordValid":true,"graphViolations":[],"nodes":4,"overlayApplicable":true,"overlayRecordValid":true,"provenanceVerdicts":[{"id":"@fork/hardened-arena","pass":true,"reasons":["license-divergent"]},{"id":"@fork/hardened-arena","pass":true,"reasons":[]},{"id":"@demo/arena-tuning","pass":true,"reasons":[]}],"semanticDiffId":"sha256:c116aa04f83beed6e4b8945d8171c80bb0ee577f65646b5ea1d992c758e6e48e","semanticDiffValid":true,"storeRoundTrip":true}
lineage graph: valid; store round-trip: ok; contracts: valid; provenance verdicts: 3/3 evidence complete
```

The synthetic lineage: `@demo/arena-world` (world, original) with a
whole-package security fork `@fork/hardened-arena` 1.0.0 (relicensed
Apache-2.0 -> MIT — recorded as `license-divergent`, non-failing), a
rebased derivative `@fork/hardened-arena` 1.1.0 (`rebased-on`), and a
narrow overlay package `@demo/arena-tuning` (`overlay-of`). All digests are
real SHA-256 over canonical JSON via package-system.

## Mandatory test-case coverage

- Lineage vocabulary: frozen edge kinds; content-addressed node ids are
  deterministic, key-order independent, derived from package digests;
  tampered node ids rejected (`src/lineage.test.ts`).
- Fork contracts: whole-package rule (kind match), overlay bases rejected,
  frozen reason vocabulary, base commit shape, bounded notes, edge
  derivation (`src/fork.test.ts`).
- Overlay contracts: frozen surface vocabulary excluding license/provenance/
  lineage/identity/overlay; closed op set per surface; malformed keys/paths/
  digests; conflicting operations; edge derivation
  (`src/overlay.test.ts`).
- Overlay applicability: legal targets pass; add-onto-existing
  (`target-exists`), remove/replace/patch-of-absent (`target-missing`),
  overlay-on-overlay base (`base-kind-forbidden`), coordinate mismatch, and
  tampered base records fail closed through package-system's
  `validatePackageRecord` seam (`src/overlay.test.ts`).
- Semantic diff: frozen ten-kind vocabulary; illegal kinds, kind/subject
  incoherence (policy+package, world+avatar-binding, simulation+world-node),
  malformed subjects/payload digests, duplicates all fail; diff ids are
  content-addressed and value-stable (`src/semantic-diff.test.ts`).
- Lineage validation (E8 negatives): cyclic lineage (2-cycle with exact
  path, 3-cycle), diamond DAG NOT reported as a cycle, unknown-digest edges,
  self-edges, duplicate/tampered nodes, unknown edge kinds, edge-rule
  violations with specific codes; deterministic violation order
  (`src/validate-lineage.test.ts`).
- R19 provenance/license gate shapes: sound chains pass; missing records,
  release-gate failures (with embedded package-system gate result),
  graph/record lineage-parent mismatches, and unverified BASE licenses fail;
  license divergence (relicensing) is recorded as a typed verdict without
  failing — enforcement stays at release-gate time
  (`src/validate-lineage.test.ts`).
- Port: in-memory store idempotency and insertion order; loader round-trip;
  tampered nodes and their edges dropped fail-closed; determinism across
  identical runs (`src/ports.test.ts`).
