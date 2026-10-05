# PlayLiquid Package Contract

Version: 1.0 (+ additive refinements from PL-002; see "Refinements" below)

A package is an immutable, versioned, addressable composition unit.

Required identity:
- package kind;
- package id;
- semantic version;
- content digest.

Required metadata:
- dependencies;
- capabilities provided/required;
- permissions;
- provenance;
- license/rights state;
- supported runtimes/engines/targets;
- resource requirements;
- evaluation suites;
- parent/lineage references.

## Resolution

A package lock records exact package versions and content digests.

Resolution must be deterministic for a pinned lock.

## Composition

Packages may expose typed extension points.

Package overlays may override declared semantic values without copying unrelated content.

## Security

A package cannot obtain undeclared capabilities.

Untrusted execution must be isolated.

## Provenance

A package derivative retains:
origin, parent, source commit, transformation history, rights state and model provenance where relevant.

## Publication

Publication/build must fail closed when required license/provenance evidence is missing.

## Refinements (PL-002 — additive; every v1.0 requirement above is unchanged)

This section records the normative schema details implemented by
`packages/package-system` (Work Order PL-002). It is strictly additive:
nothing in v1.0 is deleted or weakened; the details below only pin down
formats and algorithms so that independent implementations interoperate.

### Identity schema

- `kind` is one of: `game`, `world`, `assets`, `avatar`, `system`,
  `overlay`, `evaluation-suite`.
- `id` is a lowercase name, optionally scoped: `(@scope/)name`; each segment
  matches `[a-z0-9][a-z0-9._-]*`; total length at most 214.
- `version` is a SemVer 2.0.0 value; precedence follows semver.org §11;
  build metadata is significant for exact pin equality and ignored for
  precedence comparisons.
- `contentDigest` is `sha256:` followed by 64 lowercase hex characters:
  the SHA-256 over the UTF-8 encoding of the canonical JSON serialization
  (below) of the package record with the `contentDigest` field removed.

### Canonical JSON

- Objects: keys sorted ascending by UTF-16 code unit order; no whitespace
  between tokens.
- Arrays: element order preserved; arrays must be dense.
- Strings: ECMAScript `JSON.stringify` escaping.
- Numbers: ECMAScript `JSON.stringify` shortest round-trip form; `NaN`,
  `Infinity` and `-0` are rejected.
- Permitted values: `null`, booleans, numbers, strings, dense arrays and
  plain objects. `undefined`, functions, symbols, bigints, non-plain
  objects and cyclic structures are rejected.
- Consequence: the serialization is a pure function of the value, not of
  key insertion order.

### Dependencies and constraints

- A dependency declares: package id, constraint, optional flag, and
  optionally the expected package kind.
- Constraint grammar (v1): `*`; exact `x.y.z`; caret `^x.y.z`; tilde
  `~x.y.z` — full versions required. A prerelease version satisfies a
  caret/tilde range only when its `[major, minor, patch]` equals the range
  base's tuple. Unparseable constraints satisfy nothing (fail closed).

### Lockfile

- `lockVersion` is `1`.
- Each pin records kind, id, exact version, exact content digest and an
  optional `resolvedFrom` locator (audit information only; resolution never
  fetches).
- A lock pins at most one version per package id.
- `hostCapabilities` lists capability declarations (id + exact version)
  provided by the host environment.
- The lock fingerprint is computed over the canonical JSON of the lock with
  pins sorted by id and host capabilities sorted by id; pin order in the
  file is not semantically significant.

### Resolution

- `resolve(lock, packageIndex)` is pure, total and deterministic (E9); the
  index is an in-memory list of package records (the registry/CAS IO layer
  is PL-011).
- Fixed check order, first failure wins: lock structure; per-pin record
  lookup, kind/digest/record-integrity verification (in canonical id
  order); dependency closure (every non-optional dependency pinned,
  version within the declared constraint, kind as expected); cycle
  detection; capability closure; overlay targets.
- The result is invariant to pin order, index record order and JSON key
  order. Successful output is ordered: packages sorted by id; a
  dependencies-first topological order; adjacency lists sorted by id.
- Rejection codes: `invalid-lock`, `invalid-index`, `duplicate-pin`,
  `missing-package`, `duplicate-record`, `kind-mismatch`,
  `digest-mismatch`, `tampered-record`, `invalid-record`,
  `unpinned-dependency`, `version-mismatch`, `dependency-kind-mismatch`,
  `cyclic-dependency`, `unsatisfied-capability`, `missing-overlay-target`,
  `overlay-target-mismatch`.

### Capabilities, permissions, security

- A permission may only reference a capability the package itself declares
  as provided or required (a package cannot obtain undeclared
  capabilities).
- Resolution fails closed when a required capability is provided by no
  resolved package and no host declaration.
- Untrusted-execution isolation itself is enforced by the runtime
  (Capability Broker), not by this contract layer.

### Content-addressed artifacts (E7)

- Artifacts are CAS references: content digest, exact byte size and media
  type.
- Inline artifacts are permitted only up to 1 MiB (2^20 bytes) of decoded
  payload; anything larger must be a CAS reference.
- Provenance origin URLs must be `http:`/`https:` without embedded
  credentials.

### Overlays and extension points

- An overlay package declares its target as an exact package coordinate
  (kind, id, version, content digest) and its overrides as
  (GameIR semantic path, content digest) pairs; resolution requires the
  exact target coordinate to be pinned.
- Extension points are typed by id, version and a content-addressed value
  schema digest.

### Provenance and release gate (R19)

- A provenance record carries: origin (`original`, repository URL, or
  package coordinate), source commit (40/64-hex Git SHA), transformation
  history, model provenance entries and the generated-by-AI flag.
- Derivatives (non-null parent) must additionally retain lineage origin and
  a source commit.
- `checkReleaseGate(record)` returns `{ pass, reasons[] }` and fails closed:
  record validity and digest integrity, verified license/rights state,
  non-empty transformation history, complete derivative provenance, and
  disclosed model provenance for AI-generated packages are all required.

### GameIR binding seam

- `EvaluationSuiteRef`, `TargetProfileRef` and `SemanticPath` are
  structural references into GameIR content. Until `packages/game-ir`
  (PL-001) is grafted, `packages/package-system` defines minimal local
  structural types in `src/game-ir-seam.ts`, to be replaced by imports
  from `@playliquid/game-ir` at graft time.
