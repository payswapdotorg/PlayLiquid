# PL-011 Evidence — @playliquid/artifact-store

Real gate outputs captured in the work sandbox on branch `work/pl-011`,
base `c9cf856` (pinned; never rebased).

Environment: Node v24.21.0, TypeScript 6.0.2, oxlint 1.60.0 (installed via
the root workspace `node_modules` — untracked, gitignored; the central
pnpm lockfile was NOT touched and was restored before the final commit).

The package declares zero external runtime dependencies; the only import is
`@playliquid/package-system` (PL-002, workspace link).

## Gates

### 1. Typecheck — PASS (exit 0, 0 errors)

Command:

```bash
cd packages/artifact-store && ../../node_modules/.bin/tsc -p .
```

Output: (no diagnostics, exit 0)

### 2. Tests — PASS: 45 tests, 45 passed / 0 failed / 0 skipped

Command:

```bash
cd packages/artifact-store && node --test src/**/*.test.ts
```

Output (tail):

```
ℹ tests 45
ℹ suites 0
ℹ pass 45
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 644.898994
```

Behavior coverage (work-order mandate): digest determinism across
byte-identical payloads; one-byte-difference digest divergence; empty
payload; 512 KiB multi-chunk payload (E7); dedupe by digest (one stored
blob); media-type record/conflict/invalid; unknown digest (fetch/stat/
range/stream fail closed); malformed digest; corrupted fetch = hard
`integrity` failure with expected/actual digests (E10); missing-chunk
integrity; forged-manifest digest collision mismatch (per-chunk records
honest, top-level digest forged → overall digest check catches it);
dedupe-over-decay refuses success; write-path sabotage fails closed;
range bounds validation; byte-exact ranges across chunk boundaries;
corrupted-chunk-inside-range fails while untouched ranges succeed;
streamed writes in unaligned pieces; empty stream; streamed dedupe; read
stream with end-of-stream overall digest; mid-stream corruption throws
`ArtifactIntegrityError`; stat; store input isolation.

### 3. Lint — PASS (exit 0, 0 warnings, 0 errors)

Command:

```bash
cd packages/artifact-store && ../../node_modules/.bin/oxlint .
```

Output:

```
Found 0 warnings and 0 errors.
Finished in 12ms on 11 files using 2 threads.
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
  "stored": "yes",
  "digestMatchesPayload": "yes",
  "chunkCount": 4,
  "deduplicated": "yes",
  "fetchIntegrityVerified": "yes",
  "rangeBytesMatch": "yes",
  "streamedDigestMatches": "yes",
  "streamedDeduplicated": "yes",
  "streamReassembled": "yes",
  "corruptedFetchCode": "integrity",
  "corruptionExpectedDigestPrefix": "sha256:3be9e0e",
  "blobCount": 1,
  "rangeSecondFetchOk": "yes"
}
```

## Environment limitations

- No real disk/object-storage adapter was implemented in this work order —
  the shipped port (`ChunkedBlobStore`) is exercised through the in-memory
  reference fake, including its documented corruption test seam. Real
  adapters are application wiring (later work orders).
- Node's type stripping is used for `.ts` execution (Node 24); no build
  step is required for tests.
