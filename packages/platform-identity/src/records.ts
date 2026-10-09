/**
 * IDENTITY READ-MODEL RECORDS + THE PURE ADMISSION ORACLE (PL-015).
 *
 * Identity is a GameOS platform service (architecture "Platform
 * services"): the platform owns the player/tenant identity read model.
 * This module holds the record shapes and the pure command oracle; the
 * mutable state owner is the IdentityService instance (service.ts, E1).
 *
 * Scope (work order): identity RECORDS, alias/display naming, tenant
 * scoping (R20) and profile VERSIONING. Authentication protocols
 * (SSO/OAuth) are product integration and deliberately NOT here.
 *
 * Records follow platform-contracts authority discipline: every identity
 * record and history entry carries the `platform-authority` decidedBy
 * marker; nothing client-originated can be structurally admitted (E8).
 * History entries are append-only (E10); profile versions are immutable
 * once recorded — a new display name is a NEW version, never a rewrite.
 *
 * Purity: types + guards + one pure oracle. No IO, no clock, no globals.
 */

import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type {
  PlatformAuthorityMarker,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/** Lifecycle of one identity record. */
export type IdentityStatus = "active" | "retired";

/** One platform identity: one subject within exactly one tenant (R20). */
export interface IdentityRecord {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly status: IdentityStatus;
  readonly registeredAt: TimestampMs;
  readonly decidedBy: PlatformAuthorityMarker;
}

/** One immutable profile version (E10: versions are never rewritten). */
export interface ProfileVersion {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  /** 1-based, gapless, monotonically increasing per (tenant, subject). */
  readonly version: number;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly updatedAt: TimestampMs;
}

/** Kinds of append-only history entries. */
export type IdentityHistoryKind =
  | "registered"
  | "alias-assigned"
  | "alias-retired"
  | "profile-updated"
  | "retired";

/** One append-only history entry (E10: the durable audit trail). */
export interface IdentityHistoryEntry {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly kind: IdentityHistoryKind;
  readonly recordedAt: TimestampMs;
  readonly decidedBy: PlatformAuthorityMarker;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// Naming rules (alias/display), tenant-relative
// ---------------------------------------------------------------------------

/** Alias text: 1..24 chars, lowercase alphanumeric + inner hyphens. */
export const ALIAS_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

/** Aliases the platform reserves; never assignable to a subject. */
export const RESERVED_ALIASES: readonly string[] = Object.freeze([
  "admin",
  "root",
  "system",
  "platform",
  "support",
  "moderator",
]);

/** Hard per-subject alias budget (E8: capacity is enforced, not advisory). */
export const MAX_ALIASES_PER_SUBJECT = 5;

/** Display-name text budget. */
export const DISPLAY_NAME_MAX_LENGTH = 48;

/** Returns true when `text` is syntactically valid alias text. */
export function isValidAliasText(text: string): boolean {
  return ALIAS_PATTERN.test(text);
}

/** Returns true when `text` sits in the reserved alias vocabulary. */
export function isReservedAlias(text: string): boolean {
  return (RESERVED_ALIASES as readonly string[]).includes(text);
}

/** Returns true when `text` is acceptable display-name text. */
export function isValidDisplayName(text: string): boolean {
  return typeof text === "string" && text.length >= 1 && text.length <= DISPLAY_NAME_MAX_LENGTH && text.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Structural guards
// ---------------------------------------------------------------------------

/** Returns true when `value` is a structurally valid {@link IdentityRecord}. */
export function isIdentityRecord(value: unknown): value is IdentityRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tenant === "string" &&
    record.tenant.length > 0 &&
    typeof record.subject === "string" &&
    record.subject.length > 0 &&
    (record.status === "active" || record.status === "retired") &&
    typeof record.registeredAt === "number" &&
    Number.isSafeInteger(record.registeredAt) &&
    record.registeredAt >= 0 &&
    record.decidedBy === "platform-authority"
  );
}

/** Returns true when `value` is a structurally valid {@link ProfileVersion}. */
export function isProfileVersion(value: unknown): value is ProfileVersion {
  if (typeof value !== "object" || value === null) return false;
  const version = value as Record<string, unknown>;
  return (
    typeof version.tenant === "string" &&
    version.tenant.length > 0 &&
    typeof version.subject === "string" &&
    version.subject.length > 0 &&
    typeof version.version === "number" &&
    Number.isSafeInteger(version.version) &&
    version.version >= 1 &&
    typeof version.displayName === "string" &&
    isValidDisplayName(version.displayName) &&
    Array.isArray(version.aliases) &&
    version.aliases.every((alias) => typeof alias === "string" && isValidAliasText(alias as string)) &&
    typeof version.updatedAt === "number" &&
    Number.isSafeInteger(version.updatedAt) &&
    version.updatedAt >= 0
  );
}

// ---------------------------------------------------------------------------
// Commands, facts and the admission oracle
// ---------------------------------------------------------------------------

/** The identity commands the service admits (typed admission, E2). */
export type IdentityCommand =
  | {
      readonly kind: "register";
      readonly tenant: TenantId;
      readonly subject: SubjectId;
      readonly displayName: string;
      readonly alias?: string;
    }
  | {
      readonly kind: "assign-alias";
      readonly tenant: TenantId;
      readonly subject: SubjectId;
      readonly alias: string;
    }
  | {
      readonly kind: "retire-alias";
      readonly tenant: TenantId;
      readonly subject: SubjectId;
      readonly alias: string;
    }
  | {
      readonly kind: "update-profile";
      readonly tenant: TenantId;
      readonly subject: SubjectId;
      readonly displayName: string;
      /** Version the caller prepared the update against (optimistic concurrency). */
      readonly baseVersion: number;
    }
  | {
      readonly kind: "retire";
      readonly tenant: TenantId;
      readonly subject: SubjectId;
    };

/** The tenant-scoped facts the oracle decides over (derived by the owner). */
export interface IdentityFacts {
  /** Whether the subject exists within the COMMAND's tenant scope. */
  readonly subjectExists: boolean;
  readonly subjectStatus: IdentityStatus | undefined;
  /** Current profile version; 0 when the subject is absent. */
  readonly currentVersion: number;
  readonly currentDisplayName: string;
  readonly currentAliases: readonly string[];
  /** Owner of the alias within the COMMAND's tenant, if any. */
  readonly aliasOwner: SubjectId | undefined;
}

/** Typed refusal codes (E8 negative coverage, one per rule). */
export type IdentityRefusalCode =
  | "invalid-tenant"
  | "invalid-subject"
  | "duplicate-subject"
  | "unknown-subject"
  | "identity-retired"
  | "invalid-display-name"
  | "invalid-alias"
  | "reserved-alias"
  | "alias-taken"
  | "alias-not-held"
  | "alias-limit-reached"
  | "duplicate-alias"
  | "stale-version"
  | "no-op-update"
  | "cross-tenant-access";

/** Result of identity command admission. */
export type IdentityAdmission =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly code: IdentityRefusalCode; readonly detail: string };

/**
 * THE pure identity admission oracle. The service derives {@link
 * IdentityFacts} from its own tenant-scoped state (never from the
 * command's claims) and applies this oracle; only `accepted: true`
 * mutations reach the state owner.
 *
 * Ordering of rules is normative: identity validity first, then the
 * command-specific gates. Retry semantics: a retried command that no
 * longer fits the facts receives a typed refusal — the recorded history
 * always stands (E10), never a second mutation.
 */
export function adjudicateIdentityCommand(command: IdentityCommand, facts: IdentityFacts): IdentityAdmission {
  if (asTenantId(String(command.tenant)) === undefined) {
    return { accepted: false, code: "invalid-tenant", detail: "tenant is not valid platform id text" };
  }
  if (asSubjectId(String(command.subject)) === undefined) {
    return { accepted: false, code: "invalid-subject", detail: "subject is not valid platform id text" };
  }
  switch (command.kind) {
    case "register":
      return adjudicateRegister(command, facts);
    case "assign-alias":
      return adjudicateAssignAlias(command, facts);
    case "retire-alias":
      return adjudicateRetireAlias(command, facts);
    case "update-profile":
      return adjudicateUpdateProfile(command, facts);
    case "retire":
      return adjudicateRetire(command, facts);
  }
}

function requireKnownActive(facts: IdentityFacts): IdentityAdmission | undefined {
  if (!facts.subjectExists) {
    return { accepted: false, code: "unknown-subject", detail: "subject is not registered in this tenant" };
  }
  if (facts.subjectStatus === "retired") {
    return { accepted: false, code: "identity-retired", detail: "identity is retired; mutations are refused" };
  }
  return undefined;
}

function adjudicateRegister(
  command: Extract<IdentityCommand, { kind: "register" }>,
  facts: IdentityFacts,
): IdentityAdmission {
  if (facts.subjectExists) {
    return { accepted: false, code: "duplicate-subject", detail: "subject already registered in this tenant" };
  }
  if (!isValidDisplayName(command.displayName)) {
    return { accepted: false, code: "invalid-display-name", detail: `display name is not 1..${DISPLAY_NAME_MAX_LENGTH} non-blank characters` };
  }
  if (command.alias !== undefined) {
    const aliasCheck = checkNewAlias(command.alias, command.subject, facts);
    if (aliasCheck !== undefined) return aliasCheck;
  }
  return { accepted: true };
}

function adjudicateAssignAlias(
  command: Extract<IdentityCommand, { kind: "assign-alias" }>,
  facts: IdentityFacts,
): IdentityAdmission {
  const active = requireKnownActive(facts);
  if (active !== undefined) return active;
  const aliasCheck = checkNewAlias(command.alias, command.subject, facts);
  if (aliasCheck !== undefined) return aliasCheck;
  return { accepted: true };
}

function checkNewAlias(alias: string, subject: SubjectId, facts: IdentityFacts): IdentityAdmission | undefined {
  if (!isValidAliasText(alias)) {
    return { accepted: false, code: "invalid-alias", detail: "alias does not match the alias text pattern" };
  }
  if (isReservedAlias(alias)) {
    return { accepted: false, code: "reserved-alias", detail: "alias is reserved by the platform" };
  }
  if (facts.aliasOwner !== undefined) {
    if (facts.aliasOwner === subject) {
      return { accepted: false, code: "duplicate-alias", detail: "subject already holds this alias" };
    }
    return { accepted: false, code: "alias-taken", detail: "alias is already taken within this tenant" };
  }
  if (facts.currentAliases.length >= MAX_ALIASES_PER_SUBJECT) {
    return { accepted: false, code: "alias-limit-reached", detail: `subject already holds ${MAX_ALIASES_PER_SUBJECT} aliases` };
  }
  return undefined;
}

function adjudicateRetireAlias(
  command: Extract<IdentityCommand, { kind: "retire-alias" }>,
  facts: IdentityFacts,
): IdentityAdmission {
  const active = requireKnownActive(facts);
  if (active !== undefined) return active;
  if (!isValidAliasText(command.alias)) {
    return { accepted: false, code: "invalid-alias", detail: "alias does not match the alias text pattern" };
  }
  if (!facts.currentAliases.includes(command.alias)) {
    return { accepted: false, code: "alias-not-held", detail: "subject does not hold this alias" };
  }
  return { accepted: true };
}

function adjudicateUpdateProfile(
  command: Extract<IdentityCommand, { kind: "update-profile" }>,
  facts: IdentityFacts,
): IdentityAdmission {
  const active = requireKnownActive(facts);
  if (active !== undefined) return active;
  if (!isValidDisplayName(command.displayName)) {
    return { accepted: false, code: "invalid-display-name", detail: `display name is not 1..${DISPLAY_NAME_MAX_LENGTH} non-blank characters` };
  }
  if (command.baseVersion !== facts.currentVersion) {
    return {
      accepted: false,
      code: "stale-version",
      detail: `update prepared against version ${command.baseVersion}, current is ${facts.currentVersion}`,
    };
  }
  if (command.displayName === facts.currentDisplayName) {
    return { accepted: false, code: "no-op-update", detail: "display name is unchanged; nothing to record" };
  }
  return { accepted: true };
}

function adjudicateRetire(
  _command: Extract<IdentityCommand, { kind: "retire" }>,
  facts: IdentityFacts,
): IdentityAdmission {
  if (!facts.subjectExists) {
    return { accepted: false, code: "unknown-subject", detail: "subject is not registered in this tenant" };
  }
  if (facts.subjectStatus === "retired") {
    return { accepted: false, code: "identity-retired", detail: "identity is already retired" };
  }
  return { accepted: true };
}
