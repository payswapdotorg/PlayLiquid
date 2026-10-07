# @playliquid/package-registry

The package registry of the PlayLiquid Package Graph — Work Order **PL-011**
(depends on PL-002 `@playliquid/package-system` and on
`@playliquid/artifact-store`).

An immutable, in-memory-first index over package records per
`spec/package-contract.md`, with a `RegistryStore` persistence port and the
registry ↔ CAS wiring that makes lockfile pins verifiable against both
authorities (architecture-lock rule 10).

## Layers

| Layer | Module | Discipline |
| --- | --- | --- |
| Pure core | `createRegistryIndex` (`src/registry-index.ts`) | No IO, no clock, no randomness. Deterministic state machine: the same publish sequence always yields the identical index (E9). Single owner of the in-memory index state (E1). |
| Port | `RegistryStore` (`src/registry-store.ts`) | Async persistence edge; the app wires a local or remote adapter. `InMemoryRegistryStore` is the fake. |
| Facade | `openRegistry` (`src/registry.ts`) | Transactional publish: pure pre-flight → `store.putRecord` → index commit; port failures leave the index untouched. Mutations serialize through an internal queue. |
| CAS wiring | `src/cas-binding.ts` | Record content bytes ↔ artifact store; lockfile verification against BOTH authorities. |

## Publish semantics (immutability)

- The identity coordinate is `(kind, id, version)`; records are admitted
  only when structurally valid (`validatePackageRecord` from
  package-system) and — by default — release-gate passing (`checkReleaseGate`,
  R19 fail-closed).
- Republishing the **identical** record is an idempotent
  `already-published` success.
- Republishing the same coordinate with **any** different content is
  `mutation-rejected` — packages are immutable (lock rule 8). The same
  applies to a different `kind` at the same `id@version`.
- The index stores its own **deep-frozen clone** of every record; callers
  cannot mutate the index through retained references, and their input
  object is never frozen.
- `enforceReleaseGate: false` is an explicit, auditable opt-out for local
  analysis indexes; production publication keeps the default.

## Lookups and ordering

- `get({kind, id, version})` — exact coordinate (build metadata is
  significant for pin equality, per the package contract).
- `getByDigest(digest)` — content-addressed record lookup.
- `bestMatch(id, constraint)` — deterministic highest-precedence version
  satisfying a constraint (package-system's semver precedence + a formatted
  string tie-break for precedence-equal versions).
- `findProviders` / `findRequiring` / `findByPermission` — capability and
  permission filters.
- `list()` / `listVersions()` — stable ordering: id ascending, then version
  precedence ascending, then formatted-version tie-break. Insertion order
  never leaks (E9).

## Resolution

`resolveLock(lock)` delegates to package-system's `resolve(lock, index)`
over the registry snapshot — deterministic, total, with package-system's
rejection codes (`cyclic-dependency`, `digest-mismatch`,
`unpinned-dependency`, ...). Resolution is never re-implemented here.

## Registry ↔ artifact-store wiring

The binding invariant: a package record's `contentDigest` (SHA-256 of the
canonical JSON of the record minus the digest field) is exactly the CAS
blob digest of those canonical content bytes. Therefore:

- `publishRecordToCas(artifacts, record)` stores the content bytes; the
  resulting blob digest must equal the declared digest (asserted
  fail-closed);
- `fetchRecordFromCas(artifacts, digest)` resolves a digest back to a
  record (fetch → parse → re-seal → validate);
- `verifyLockAgainstStores(lock, {registry, artifacts})` checks every pin
  against BOTH authorities: registry coordinate+digest, CAS record content
  (integrity-verified fetch), every declared CAS artifact
  (presence/size/media type), plus full graph resolution;
- `publishPackage(record, {registry, artifacts})` is the fail-closed
  publication path: verify artifacts → store record content → publish to
  the registry (opt out of artifact verification only for staged uploads).

## Async/stateful documentation (worker contract)

- Mutable state owner: the facade object (index + admission queue).
- Command admission: serialized, in call order.
- Event order: load-once at open; publish = check → persist → commit.
- Idempotency key: `(kind, id, version, contentDigest)`.
- Stale-result rule: verdicts reflect the committed state at admission.
- Retry: `putRecord` is idempotent, so retried publishes are safe.
- Cancellation: not modeled; publish completes or fails without mutating
  visible state.
