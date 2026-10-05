# PlayLiquid Package Contract

Version: 1.0

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
