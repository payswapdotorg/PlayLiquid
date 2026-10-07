# @playliquid/artifact-store

Content-addressed artifact (blob) storage for the PlayLiquid Package Graph —
Work Order **PL-011** (depends on PL-002 `@playliquid/package-system`).

Architecture: architecture-lock rules 9 (large binaries use CAS), 10
(lockfiles pin exact digests); requirements **E7** (large binaries do not
live wholesale in ordinary Git history) and **E10** (integrity failures are
hard, never silent).

## Canonical digest algorithm (frozen contract)

> The digest of a blob is **SHA-256 over the exact bytes**, rendered as
> `sha256:<64 lowercase hex>` — the same textual shape as
> `@playliquid/package-system`'s `ContentDigest`, so CAS references, lockfile
> pins and package record coordinates share one digest vocabulary.

Package-system digests the *canonical JSON of a value*; the artifact store
digests *raw bytes*. A package record's content digest is exactly the blob
digest of its canonical-JSON content bytes (see
`packageRecordContentBytes` in `@playliquid/package-registry`).

## API surface

| Operation | Behavior |
| --- | --- |
| `store(bytes, {mediaType?})` | Deterministic digest, chunked write through the sink port, read-back verification, **dedupe by digest** (idempotent). |
| `fetch(digest)` | Single-pass integrity-verified read: every chunk digest **and** the overall digest are recomputed. Corruption → `integrity` failure with expected/actual digests — corrupted bytes are **never** returned, and there is no override flag (E10). |
| `stat(digest)` | Cheap presence probe (manifest fields only; `null` when unknown). Fetch is the verifying path. |
| `readRange(digest, offset, length)` | Byte-range read; validates bounds; verifies only the chunks the range touches (E7: no wholesale pulls). |
| `openWrite()` | Streaming write session: arbitrary `append` pieces cut into fixed-size chunks (default 64 KiB), `finalize` computes the digest and records the manifest. |
| `openRead(digest)` | Streaming read session: chunk-at-a-time reads, each verified against the manifest; the overall digest is verified incrementally. Mid-stream corruption throws `ArtifactIntegrityError` (hard error — partial data has already been consumed). |

## Ports (E7) — the IO boundary

```ts
interface ChunkedBlobSink   { putChunk(digest, chunkIndex, bytes); putManifest(manifest) }
interface ChunkedBlobSource { readChunk(digest, chunkIndex); manifestOf(digest) }
interface ChunkedBlobStore  extends ChunkedBlobSink, ChunkedBlobSource {}
```

`InMemoryBlobStore` is the reference fake (byte-copying both ways, plus a
`corruptChunkForTests` seam for E10 negative evidence). Real adapters (disk,
object storage) are wired by the application. The ports are **synchronous by
design**: they model the local, materialized CAS the domain reads from and
writes to; remote hydration/caching is an application-layer adapter concern
(kept out of the domain so no network authority can leak in).

## Manifest records

Every blob has a content-derived manifest: overall digest, exact byte size,
chunk size, per-chunk SHA-256 digests, and the first-asserted media type.
Manifests are deterministic (E9) and re-verifiable at any time (E10) —
`verifyManifest` recomputes everything from the bytes.

## Fail-closed rules

- Same digest re-stored with a **different non-null media type** →
  `media-type-conflict` (manifest mutation attempt).
- Unknown digest on `fetch`/`readRange`/`openRead` → `unknown-digest`.
- Malformed digest argument → `invalid-digest`.
- Out-of-bounds range → `invalid-range`.
- Missing chunk, chunk digest mismatch, or overall digest mismatch →
  `integrity` (hard failure; includes expected/actual digests).
- Dedupe hits verify existing content — a dedupe can never claim success
  over decayed storage.

## Determinism notes (E9)

Byte-identical payloads always produce the identical digest and manifest;
one differing byte always produces a different digest. Chunking is
deterministic: chunk *i* covers `[i·chunkSize, (i+1)·chunkSize)`. No clock,
no randomness, no environment input anywhere in the domain.

## Session buffering (documented deferral)

Write sessions buffer chunks in memory until `finalize`, because a
content-addressed port key (the final digest) exists only after the whole
stream has been hashed. Adapters that must stream to durable storage before
the digest is known need a session-keyed port shape; that is deliberately
deferred to a future work order (recorded in the PL-011 report).
