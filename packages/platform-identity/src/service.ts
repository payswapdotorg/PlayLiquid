/**
 * THE IDENTITY SERVICE — the player/tenant identity read model (PL-015;
 * architecture "Platform services": identity).
 *
 * The service instance is the single mutable-state owner (E1): it owns
 * the identity records, the append-only history, the alias index and the
 * per-subject profile version chains. Clients receive read models and
 * typed admissions only. No authentication protocols (SSO/OAuth) —
 * product integration, deliberately out of scope.
 *
 * Async/stateful discipline (spec/worker-contract.md) — every item owned
 * and tested:
 *
 * - MUTABLE STATE OWNER: this instance. All maps below; nothing else
 *   mutates them. Persistence flows ONLY through the IdentityStore port
 *   (snapshots), time ONLY through ServiceClock.
 * - COMMAND ADMISSION: one door per command kind; each derives
 *   tenant-scoped facts from OWNED state, runs the cross-tenant guard
 *   (`checkTenantIsolation`, R20) and then the pure oracle
 *   (`adjudicateIdentityCommand`). Rejected commands mutate nothing.
 * - EVENT ORDER: history entries append in admission order, strictly
 *   after the state mutation they describe; revision advances 1:1.
 * - IDEMPOTENCY: registration retries receive `duplicate-subject` (the
 *   first record stands); profile updates are version-fenced
 *   (`stale-version`) and content-fenced (`no-op-update`); alias
 *   re-assignment is refused (`duplicate-alias`). Recorded history is
 *   never rewritten or re-appended (E10).
 * - STALE-RESULT RULE: profile reads always return the CURRENT version;
 *   older versions remain readable (immutable, E10) and never resurrect.
 * - REPLAY/RESUME BOUNDARY: `snapshot()` persists a content-addressed
 *   checkpoint; `restore()` re-adopts a stored document. There is no
 *   partial-apply: adoption is whole-document.
 * - RETRY/CANCELLATION SEMANTICS: retries are fresh encounters against
 *   current facts (typed refusal if the facts moved on); the domain is
 *   synchronous — there is no in-flight work to cancel.
 */

import { checkTenantIsolation } from "@playliquid/platform-contracts";
import type { ContentDigest, SubjectId, TenantId, TimestampMs } from "@playliquid/platform-contracts";
import { canonicalJson, digestOf } from "./digest.ts";
import { isIdentityStateDocument } from "./ports.ts";
import type { IdentityStore, ServiceClock } from "./ports.ts";
import { adjudicateIdentityCommand } from "./records.ts";
import type {
  IdentityAdmission,
  IdentityCommand,
  IdentityFacts,
  IdentityHistoryEntry,
  IdentityRecord,
  ProfileVersion,
} from "./records.ts";
import type { IdentityStateDocument } from "./ports.ts";

/** Construction options. */
export interface IdentityServiceOptions {
  readonly store: IdentityStore;
  readonly clock: ServiceClock;
}

/** Result of a tenant-scoped identity read. */
export type IdentityLookup =
  | { readonly found: true; readonly identity: IdentityRecord; readonly profile: ProfileVersion }
  | { readonly found: false; readonly code: "unknown-subject" | "cross-tenant-access"; readonly detail: string };

/** Result of a tenant-scoped alias resolution. */
export type AliasLookup =
  | { readonly found: true; readonly subject: SubjectId }
  | { readonly found: false; readonly code: "unknown-alias"; readonly detail: string };

/** Result of a snapshot or restore operation. */
export type SnapshotOutcome =
  | { readonly ok: true; readonly snapshotId: ContentDigest; readonly revision: number }
  | { readonly ok: false; readonly code: "empty-state" | "unknown-snapshot" | "malformed-snapshot"; readonly detail: string };

interface IdentityState {
  revision: number;
  identities: Map<string, IdentityRecord>;
  profiles: Map<string, ProfileVersion[]>;
  history: IdentityHistoryEntry[];
  aliases: Map<string, SubjectId>;
  subjectTenants: Map<string, TenantId>;
}

const keyOf = (tenant: TenantId, subject: SubjectId): string => `${String(tenant)}|${String(subject)}`;
const aliasKey = (tenant: TenantId, alias: string): string => `${String(tenant)}|${alias}`;

/** The identity read model. Construct, then admit commands. */
export class IdentityService {
  private readonly store: IdentityStore;
  private readonly clock: ServiceClock;
  private readonly state: IdentityState = {
    revision: 0,
    identities: new Map(),
    profiles: new Map(),
    history: [],
    aliases: new Map(),
    subjectTenants: new Map(),
  };

  constructor(options: IdentityServiceOptions) {
    this.store = options.store;
    this.clock = options.clock;
  }

  // -----------------------------------------------------------------------
  // Commands (typed admission)
  // -----------------------------------------------------------------------

  /** Admit one identity command through the full pipeline. */
  admit(command: IdentityCommand): IdentityAdmission {
    const now = this.clock.now();
    const crossTenant = this.crossTenantRefusal(command.tenant, command.subject);
    if (crossTenant !== undefined) return crossTenant;
    const facts = this.factsOf(command);
    const admission = adjudicateIdentityCommand(command, facts);
    if (!admission.accepted) return admission;
    switch (command.kind) {
      case "register":
        this.applyRegister(command, now);
        return admission;
      case "assign-alias":
        this.applyAssignAlias(command, now);
        return admission;
      case "retire-alias":
        this.applyRetireAlias(command, now);
        return admission;
      case "update-profile":
        this.applyUpdateProfile(command, now);
        return admission;
      case "retire":
        this.applyRetire(command, now);
        return admission;
    }
  }

  // -----------------------------------------------------------------------
  // Read models (tenant-scoped; copies, never live references)
  // -----------------------------------------------------------------------

  /** Look up one identity by subject, scoped to `tenant` (R20). */
  identityOf(tenant: TenantId, subject: SubjectId): IdentityLookup {
    const record = this.state.identities.get(keyOf(tenant, subject));
    if (record !== undefined) {
      const profile = this.currentProfileOf(tenant, subject);
      if (profile !== undefined) {
        return { found: true, identity: { ...record }, profile };
      }
    }
    const crossTenant = this.crossTenantRefusal(tenant, subject);
    if (crossTenant !== undefined && !crossTenant.accepted) {
      return { found: false, code: "cross-tenant-access", detail: crossTenant.detail };
    }
    return { found: false, code: "unknown-subject", detail: "subject is not registered in this tenant" };
  }

  /** Resolve an alias to a subject, scoped to `tenant` (R20). */
  resolveAlias(tenant: TenantId, alias: string): AliasLookup {
    const subject = this.state.aliases.get(aliasKey(tenant, alias));
    if (subject === undefined) {
      return { found: false, code: "unknown-alias", detail: "alias is not registered in this tenant" };
    }
    return { found: true, subject };
  }

  /** The immutable profile version chain (E10), oldest first. */
  profileHistory(tenant: TenantId, subject: SubjectId): readonly ProfileVersion[] {
    return [...(this.state.profiles.get(keyOf(tenant, subject)) ?? [])].map((version) => ({
      ...version,
      aliases: [...version.aliases],
    }));
  }

  /** The append-only history entries of one subject (E10). */
  historyOf(tenant: TenantId, subject: SubjectId): readonly IdentityHistoryEntry[] {
    return this.state.history
      .filter((entry) => entry.tenant === tenant && entry.subject === subject)
      .map((entry) => ({ ...entry }));
  }

  /** All subjects registered in one tenant (read model). */
  subjectsOfTenant(tenant: TenantId): readonly SubjectId[] {
    return [...this.state.identities.values()]
      .filter((record) => record.tenant === tenant)
      .map((record) => record.subject);
  }

  // -----------------------------------------------------------------------
  // Snapshot / restore (replay-resume boundary)
  // -----------------------------------------------------------------------

  /** Persist a byte-stable, content-addressed checkpoint of all state. */
  snapshot(): SnapshotOutcome {
    if (this.state.identities.size === 0) {
      return { ok: false, code: "empty-state", detail: "nothing to snapshot" };
    }
    const document = canonicalJson(this.toDocument());
    const snapshotId = digestOf(document);
    this.store.save({ snapshotId, revision: this.state.revision, document });
    return { ok: true, snapshotId, revision: this.state.revision };
  }

  /** Re-adopt a stored snapshot document (whole-document, no partial apply). */
  restore(snapshotId?: ContentDigest): SnapshotOutcome {
    const stored = snapshotId === undefined ? this.store.list().at(-1) : this.store.load(snapshotId);
    if (stored === undefined) {
      return { ok: false, code: "unknown-snapshot", detail: "no stored snapshot to restore" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored.document);
    } catch {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not valid JSON" };
    }
    if (!isIdentityStateDocument(parsed)) {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not an identity state document" };
    }
    this.adoptDocument(parsed);
    return { ok: true, snapshotId: stored.snapshotId, revision: stored.revision };
  }

  // -----------------------------------------------------------------------
  // Internals: facts, cross-tenant guard, mutations
  // -----------------------------------------------------------------------

  /** R20: a subject that exists under ANOTHER tenant is a typed violation. */
  private crossTenantRefusal(tenant: TenantId, subject: SubjectId): IdentityAdmission | undefined {
    const owner = this.state.subjectTenants.get(String(subject));
    if (owner === undefined || owner === tenant) return undefined;
    const isolation = checkTenantIsolation({ tenant }, { tenant: owner });
    const requestTenant = isolation.ok ? tenant : isolation.requestTenant;
    return {
      accepted: false,
      code: "cross-tenant-access",
      detail: `cross-tenant-access: request tenant ${String(requestTenant)} cannot touch subject owned by tenant ${String(owner)}`,
    };
  }

  private factsOf(command: IdentityCommand): IdentityFacts {
    const record = this.state.identities.get(keyOf(command.tenant, command.subject));
    const profile = this.currentProfileOf(command.tenant, command.subject);
    const alias = "alias" in command ? command.alias : undefined;
    return {
      subjectExists: record !== undefined,
      subjectStatus: record?.status,
      currentVersion: profile?.version ?? 0,
      currentDisplayName: profile?.displayName ?? "",
      currentAliases: profile?.aliases ?? [],
      aliasOwner: alias === undefined ? undefined : this.state.aliases.get(aliasKey(command.tenant, alias)),
    };
  }

  private currentProfileOf(tenant: TenantId, subject: SubjectId): ProfileVersion | undefined {
    const versions = this.state.profiles.get(keyOf(tenant, subject));
    if (versions === undefined || versions.length === 0) return undefined;
    return { ...versions[versions.length - 1]!, aliases: [...versions[versions.length - 1]!.aliases] };
  }

  private append(entryKind: IdentityHistoryEntry["kind"], tenant: TenantId, subject: SubjectId, detail: string, now: TimestampMs): void {
    const entry: IdentityHistoryEntry = {
      tenant,
      subject,
      kind: entryKind,
      recordedAt: now,
      decidedBy: "platform-authority",
      detail,
    };
    this.state.history.push(entry);
    this.state.revision += 1;
  }

  private applyRegister(command: Extract<IdentityCommand, { kind: "register" }>, now: TimestampMs): void {
    const key = keyOf(command.tenant, command.subject);
    const record: IdentityRecord = {
      tenant: command.tenant,
      subject: command.subject,
      status: "active",
      registeredAt: now,
      decidedBy: "platform-authority",
    };
    this.state.identities.set(key, record);
    this.state.subjectTenants.set(String(command.subject), command.tenant);
    const aliases = command.alias === undefined ? [] : [command.alias];
    if (command.alias !== undefined) {
      this.state.aliases.set(aliasKey(command.tenant, command.alias), command.subject);
    }
    const first: ProfileVersion = {
      tenant: command.tenant,
      subject: command.subject,
      version: 1,
      displayName: command.displayName,
      aliases,
      updatedAt: now,
    };
    this.state.profiles.set(key, [first]);
    this.append("registered", command.tenant, command.subject, `registered with display name "${command.displayName}"`, now);
  }

  private applyAssignAlias(command: Extract<IdentityCommand, { kind: "assign-alias" }>, now: TimestampMs): void {
    const key = keyOf(command.tenant, command.subject);
    this.state.aliases.set(aliasKey(command.tenant, command.alias), command.subject);
    const versions = this.state.profiles.get(key)!;
    const current = versions[versions.length - 1]!;
    versions.push({
      ...current,
      version: current.version + 1,
      aliases: [...current.aliases, command.alias],
      updatedAt: now,
    });
    this.append("alias-assigned", command.tenant, command.subject, `alias "${command.alias}" assigned`, now);
  }

  private applyRetireAlias(command: Extract<IdentityCommand, { kind: "retire-alias" }>, now: TimestampMs): void {
    const key = keyOf(command.tenant, command.subject);
    this.state.aliases.delete(aliasKey(command.tenant, command.alias));
    const versions = this.state.profiles.get(key)!;
    const current = versions[versions.length - 1]!;
    versions.push({
      ...current,
      version: current.version + 1,
      aliases: current.aliases.filter((alias) => alias !== command.alias),
      updatedAt: now,
    });
    this.append("alias-retired", command.tenant, command.subject, `alias "${command.alias}" retired`, now);
  }

  private applyUpdateProfile(command: Extract<IdentityCommand, { kind: "update-profile" }>, now: TimestampMs): void {
    const versions = this.state.profiles.get(keyOf(command.tenant, command.subject))!;
    const current = versions[versions.length - 1]!;
    versions.push({ ...current, version: current.version + 1, displayName: command.displayName, updatedAt: now });
    this.append(
      "profile-updated",
      command.tenant,
      command.subject,
      `display name "${current.displayName}" -> "${command.displayName}" (v${current.version} -> v${current.version + 1})`,
      now,
    );
  }

  private applyRetire(command: Extract<IdentityCommand, { kind: "retire" }>, now: TimestampMs): void {
    const key = keyOf(command.tenant, command.subject);
    const record = this.state.identities.get(key)!;
    this.state.identities.set(key, { ...record, status: "retired" });
    this.append("retired", command.tenant, command.subject, "identity retired", now);
  }

  // -----------------------------------------------------------------------
  // Snapshot document (de)serialization
  // -----------------------------------------------------------------------

  private toDocument(): IdentityStateDocument {
    return {
      revision: this.state.revision,
      identities: [...this.state.identities.values()],
      profiles: [...this.state.profiles.values()].flat(),
      history: [...this.state.history],
      aliases: [...this.state.aliases.entries()].map(([key, subject]) => {
        const [tenant, alias] = key.split("|");
        return { tenant: tenant ?? "", alias: alias ?? "", subject: String(subject) };
      }),
      subjectTenants: [...this.state.subjectTenants.entries()].map(([subject, tenant]) => ({
        subject,
        tenant: String(tenant),
      })),
    };
  }

  private adoptDocument(document: IdentityStateDocument): void {
    this.state.identities = new Map(document.identities.map((record) => [keyOf(record.tenant, record.subject), record]));
    const profiles = new Map<string, ProfileVersion[]>();
    for (const version of document.profiles) {
      const key = keyOf(version.tenant, version.subject);
      const chain = profiles.get(key) ?? [];
      chain.push(version);
      profiles.set(key, chain);
    }
    this.state.profiles = profiles;
    this.state.history = [...document.history];
    this.state.aliases = new Map(
      document.aliases.map((row) => [`${row.tenant}|${row.alias}`, row.subject as SubjectId]),
    );
    this.state.subjectTenants = new Map(
      document.subjectTenants.map((row) => [row.subject, row.tenant as TenantId]),
    );
    this.state.revision = document.revision;
  }
}
