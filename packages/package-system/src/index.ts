/**
 * @playliquid/package-system — public API.
 *
 * The package model + resolution contract layer for the PlayLiquid Package
 * Graph (spec/package-contract.md): package identity types, metadata types,
 * the lockfile contract, deterministic pure resolution, content-addressing
 * contracts and the provenance/licensing release gate types (R19).
 *
 * Pure only: no IO, no git client, no network. The registry/CAS IO layer
 * is Work Order PL-011.
 */

export * from './semver.ts'
export * from './package-id.ts'
export * from './canonical-json.ts'
export * from './digest.ts'
export * from './cas.ts'
export * from './capability.ts'
export * from './game-ir-seam.ts'
export * from './provenance.ts'
export * from './license.ts'
export * from './package-record.ts'
export * from './package-digest.ts'
export * from './validate-record.ts'
export * from './lockfile.ts'
export * from './resolve.ts'
export * from './release-gate.ts'
