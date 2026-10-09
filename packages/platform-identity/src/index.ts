/**
 * @playliquid/platform-identity — public surface (PL-015).
 *
 * The player/tenant identity READ MODEL service: identity records,
 * alias/display naming, tenant scoping (R20) and append-only profile
 * versioning (E10), implemented over `@playliquid/platform-contracts`
 * primitives and tenancy oracles per spec/module-dependency-matrix.md
 * row `identity | Platform | platform-contracts`.
 *
 * Module map:
 * - digest.ts    pure SHA-256 + byte-stable canonical JSON (E9)
 * - records.ts   record shapes, guards, alias rules, admission oracle
 * - ports.ts     snapshot store + clock ports
 * - service.ts   the identity service (the mutable-state owner)
 * - fakes.ts     deterministic in-memory fakes for tests/harness
 *
 * Purity: the domain has no IO, no timers, no globals; every effect lives
 * behind a port. The service instance is the single mutable-state owner.
 */

// Values
export { canonicalJson, sha256Hex, digestOf } from "./digest.ts";
export {
  ALIAS_PATTERN,
  RESERVED_ALIASES,
  MAX_ALIASES_PER_SUBJECT,
  DISPLAY_NAME_MAX_LENGTH,
  isValidAliasText,
  isReservedAlias,
  isValidDisplayName,
  isIdentityRecord,
  isProfileVersion,
  adjudicateIdentityCommand,
} from "./records.ts";
export { IdentityService } from "./service.ts";
export { createMemoryIdentityStore, createFixedClock } from "./fakes.ts";

// Types — records
export type {
  IdentityStatus,
  IdentityRecord,
  ProfileVersion,
  IdentityHistoryKind,
  IdentityHistoryEntry,
  IdentityCommand,
  IdentityFacts,
  IdentityRefusalCode,
  IdentityAdmission,
} from "./records.ts";
// Types — ports
export type {
  IdentityStateDocument,
  StoredIdentitySnapshot,
  IdentityStore,
  ServiceClock,
} from "./ports.ts";
// Types — service
export type {
  IdentityServiceOptions,
  IdentityLookup,
  AliasLookup,
  SnapshotOutcome,
} from "./service.ts";
