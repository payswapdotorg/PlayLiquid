/**
 * THE ACHIEVEMENTS SERVICE — the awarding authority (PL-015; matrix
 * row `achievements | Platform | platform-contracts`).
 *
 * The service instance is the single mutable-state owner (E1): the
 * game-declared definitions and bindings (registered, never invented),
 * the per-(tenant, subject, achievement) progression states, and the
 * append-only award log. Progression is PLATFORM-owned: unlocks carry
 * the `platform-authority` marker, decided only through the
 * platform-contracts oracle — games and clients can never award (E8).
 *
 * Async/stateful discipline (spec/worker-contract.md) — every item
 * owned and tested:
 *
 * - MUTABLE STATE OWNER: this instance. Persistence ONLY through the
 *   AchievementsStore port (snapshots), time through ServiceClock,
 *   grants through GrantDirectory.
 * - COMMAND ADMISSION: every door runs actor least privilege first
 *   (`checkLeastPrivilege`: submit/administer/read on "achievements",
 *   R20), then structural validation, then the pure application fold
 *   (`applyEvidence`, binding `evaluateUnlock`).
 * - EVENT ORDER: awards append in admission order; the progression
 *   update and the award are one atomic step; revision advances 1:1.
 * - IDEMPOTENCY KEY: the evidence digest per (tenant, subject,
 *   achievement). A replay returns the recorded outcome (E10) — for an
 *   awarding evidence, the original award record — never a second
 *   mutation.
 * - STALE-RESULT RULE: unlocked progress never retracts; `current` is
 *   monotonic; reads always reflect the newest admitted state.
 * - REPLAY/RESUME BOUNDARY: `snapshot()` persists a content-addressed
 *   checkpoint; `restore()` re-adopts it whole.
 * - RETRY/CANCELLATION: rejected applications are not recorded (a
 *   corrected retry is a fresh encounter); replays return the
 *   recorded outcome. Synchronous domain — nothing to cancel.
 */

import { checkLeastPrivilege } from "@playliquid/platform-contracts";
import type {
  CapabilityPermission,
  ContentDigest,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import type {
  AchievementEventBinding,
  AchievementId,
  AchievementProgress,
  AchievementProgressPage,
  AchievementQueryRequest,
} from "@playliquid/platform-contracts";
import { canonicalJson, digestOf } from "./digest.ts";
import { isAchievementEventEvidence, applicablePredicates, predicateForBinding } from "./conditions.ts";
import type { AchievementEventEvidence, ConditionPredicate, TenantAchievementDefinition } from "./conditions.ts";
import { applyEvidence, awardRecordId } from "./progress.ts";
import type { AchievementAwardRecord, SubjectProgressState } from "./progress.ts";
import { isAchievementsStateDocument } from "./ports.ts";
import type { AchievementsStateDocument, AchievementsStore, GrantDirectory, ServiceClock } from "./ports.ts";

/** Construction options. */
export interface AchievementsServiceOptions {
  readonly store: AchievementsStore;
  readonly clock: ServiceClock;
  readonly grants: GrantDirectory;
}

/** One evidence application outcome for one matched achievement. */
export type AchievementOutcome =
  | {
      readonly achievement: AchievementId;
      readonly applied: true;
      readonly justUnlocked: boolean;
      readonly award?: AchievementAwardRecord;
      readonly progress: SubjectProgressState;
    }
  | {
      readonly achievement: AchievementId;
      readonly applied: false;
      readonly code: "unknown-definition" | "duplicate-evidence" | "invalid-increment";
      readonly detail: string;
      readonly recorded?: AchievementAwardRecord;
    };

/** Result of submitting one evidence to the service. */
export interface EvidenceSubmissionResult {
  readonly accepted: boolean;
  readonly code?: "permission-not-granted" | "capability-not-granted" | "tenant-mismatch" | "malformed-evidence";
  readonly detail?: string;
  readonly outcomes: readonly AchievementOutcome[];
}

/** Generic refusal result. */
export type AchievementsRefusal = { readonly ok: false; readonly code: string; readonly detail: string };

interface AchievementsState {
  revision: number;
  definitions: Map<string, TenantAchievementDefinition>;
  bindings: Map<string, AchievementEventBinding[]>;
  progress: Map<string, SubjectProgressState>;
  awards: AchievementAwardRecord[];
  predicates: Map<string, ConditionPredicate[]>;
}

/** The achievements service. Construct, then register definitions. */
export class AchievementsService {
  private readonly grants: GrantDirectory;
  private readonly store: AchievementsStore;
  private readonly state: AchievementsState = {
    revision: 0,
    definitions: new Map(),
    bindings: new Map(),
    progress: new Map(),
    awards: [],
    predicates: new Map(),
  };
  private lastPrivilegeCode = "capability-not-granted";

  constructor(options: AchievementsServiceOptions) {
    this.store = options.store;
    this.grants = options.grants;
  }

  // -----------------------------------------------------------------------
  // Definitions (administer permission, lock 18 declaration shapes)
  // -----------------------------------------------------------------------

  /** Register one achievement definition plus its event bindings. */
  registerDefinition(
    actor: SubjectId,
    definition: TenantAchievementDefinition,
    bindings: readonly AchievementEventBinding[],
  ): { readonly ok: true } | AchievementsRefusal {
    if (!this.requirePrivilege(actor, definition.tenant, "administer")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const key = defKey(definition.tenant, definition.achievementId);
    if (this.state.definitions.has(key)) {
      return { ok: false, code: "definition-already-registered", detail: "the achievement is already registered in this tenant" };
    }
    const mismatched = bindings.find(
      (binding) => binding.capability !== "achievements" || binding.achievement !== definition.achievementId,
    );
    if (mismatched !== undefined) {
      return { ok: false, code: "binding-achievement-mismatch", detail: `bindings must target the registered achievement (${String(mismatched.achievement)})` };
    }
    this.state.definitions.set(key, definition);
    this.state.bindings.set(key, [...bindings]);
    this.state.predicates.set(key, [...bindings].map(predicateForBinding));
    this.state.revision += 1;
    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // Evidence application (submit permission, award-once, E10)
  // -----------------------------------------------------------------------

  /** Submit one event evidence; it advances every bound achievement. */
  applyEvidence(actor: SubjectId, evidence: AchievementEventEvidence): EvidenceSubmissionResult {
    if (!isAchievementEventEvidence(evidence)) {
      return { accepted: false, code: "malformed-evidence", detail: "evidence is not structurally valid", outcomes: [] };
    }
    if (!this.requirePrivilege(actor, evidence.tenant, "submit")) {
      const code = this.lastPrivilegeCode as EvidenceSubmissionResult["code"];
      return { accepted: false, code, detail: `least-privilege refusal: ${this.lastPrivilegeCode}`, outcomes: [] };
    }
    const outcomes: AchievementOutcome[] = [];
    let anyApplied = false;
    let anyMatched = false;
    for (const [key, predicates] of this.state.predicates) {
      const definition = this.state.definitions.get(key);
      if (definition === undefined || definition.tenant !== evidence.tenant) continue;
      for (const predicate of applicablePredicates(predicates, evidence)) {
        anyMatched = true;
        const progressKey = progressKeyOf(evidence.tenant, evidence.subject, predicate.achievement);
        const current = this.state.progress.get(progressKey);
        const increment = predicate.incrementOf(evidence);
        if (increment === undefined) continue;
        const application = applyEvidence(
          definition,
          { tenant: evidence.tenant, subject: evidence.subject, achievement: predicate.achievement },
          current,
          evidence,
          increment,
        );
        if (!application.applied) {
          if (application.code === "duplicate-evidence") {
            const awardId = awardRecordId(evidence.digest, predicate.achievement);
            const recorded = this.state.awards.find((award) => award.awardId === awardId);
            outcomes.push({
              achievement: predicate.achievement,
              applied: false,
              code: application.code,
              detail: application.detail,
              recorded,
            });
          } else {
            outcomes.push({ achievement: predicate.achievement, applied: false, code: application.code, detail: application.detail });
          }
          continue;
        }
        anyApplied = true;
        this.state.progress.set(progressKey, application.progress);
        if (application.award !== undefined) this.state.awards.push(application.award);
        outcomes.push({
          achievement: predicate.achievement,
          applied: true,
          justUnlocked: application.justUnlocked,
          award: application.award,
          progress: { ...application.progress, evidenceApplied: [...application.progress.evidenceApplied] },
        });
      }
    }
    if (anyApplied) this.state.revision += 1;
    return { accepted: anyMatched, outcomes };
  }

  // -----------------------------------------------------------------------
  // Read models (read permission; platform-contracts page shapes)
  // -----------------------------------------------------------------------

  /** Query one subject's progression page (AchievementQueryRequest). */
  query(actor: SubjectId, request: AchievementQueryRequest): AchievementProgressPage | AchievementsRefusal {
    if (!this.requirePrivilege(actor, request.tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const records: AchievementProgress[] = [];
    for (const state of this.state.progress.values()) {
      if (state.tenant !== request.tenant || state.subject !== request.subject) continue;
      if (request.unlockedOnly && !state.unlocked) continue;
      records.push({
        tenant: state.tenant,
        subject: state.subject,
        achievement: state.achievement,
        current: state.current,
        unlocked: state.unlocked,
        unlockedBy: state.unlockedBy,
      });
    }
    records.sort((a, b) => String(a.achievement).localeCompare(String(b.achievement)));
    return { subject: request.subject, progress: records };
  }

  /** One subject's progression on one achievement, if any. */
  progressOf(actor: SubjectId, tenant: TenantId, subject: SubjectId, achievement: AchievementId): SubjectProgressState | AchievementsRefusal {
    if (!this.requirePrivilege(actor, tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const state = this.state.progress.get(progressKeyOf(tenant, subject, achievement));
    return state === undefined
      ? { ok: false, code: "unknown-progress", detail: "no progression recorded for this subject and achievement" }
      : { ...state, evidenceApplied: [...state.evidenceApplied] };
  }

  /** The append-only award log (E10), tenant/subject-scoped. */
  awardsOf(tenant: TenantId, subject?: SubjectId): readonly AchievementAwardRecord[] {
    return this.state.awards
      .filter((award) => award.tenant === tenant && (subject === undefined || award.subject === subject))
      .map((award) => ({ ...award }));
  }

  /** The definitions registered in one tenant (read model). */
  definitionsOf(tenant: TenantId): readonly TenantAchievementDefinition[] {
    return [...this.state.definitions.values()]
      .filter((definition: TenantAchievementDefinition) => definition.tenant === tenant)
      .map((definition: TenantAchievementDefinition) => ({ ...definition }));
  }

  // -----------------------------------------------------------------------
  // Snapshot / restore
  // -----------------------------------------------------------------------

  /** Persist a byte-stable, content-addressed checkpoint of all state. */
  snapshot(): { readonly ok: true; readonly snapshotId: ContentDigest; readonly revision: number } | AchievementsRefusal {
    if (this.state.definitions.size === 0) return { ok: false, code: "empty-state", detail: "nothing to snapshot" };
    const document = canonicalJson(this.toDocument());
    const snapshotId = digestOf(document);
    this.store.save({ snapshotId, revision: this.state.revision, document });
    return { ok: true, snapshotId, revision: this.state.revision };
  }

  /** Re-adopt a stored snapshot document (whole-document, no partial apply). */
  restore(snapshotId?: ContentDigest): { readonly ok: true; readonly snapshotId: ContentDigest; readonly revision: number } | AchievementsRefusal {
    const stored = snapshotId === undefined ? this.store.list().at(-1) : this.store.load(snapshotId);
    if (stored === undefined) return { ok: false, code: "unknown-snapshot", detail: "no stored snapshot to restore" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored.document);
    } catch {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not valid JSON" };
    }
    if (!isAchievementsStateDocument(parsed)) {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not an achievements state document" };
    }
    this.adoptDocument(parsed);
    return { ok: true, snapshotId: stored.snapshotId, revision: stored.revision };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private requirePrivilege(actor: SubjectId, tenant: TenantId, permission: CapabilityPermission): boolean {
    const decision = checkLeastPrivilege({ tenant, subject: actor, capability: "achievements", permission }, this.grants.grants());
    if (decision.ok) return true;
    this.lastPrivilegeCode = decision.code;
    return false;
  }

  private toDocument(): AchievementsStateDocument {
    const definitions = [...this.state.definitions.values()].map((definition: TenantAchievementDefinition) => ({
      tenant: String(definition.tenant),
      achievement: String(definition.achievementId),
      metric: definition.metric,
      threshold: definition.threshold,
      visibility: definition.visibility,
      progression: definition.progression,
    }));
    const bindings = [...this.state.bindings.entries()].flatMap(([key, list]) =>
      list.map((binding) => ({
        tenant: key.split("|")[0] ?? "",
        eventKind: String(binding.eventKind),
        achievement: String(binding.achievement),
        increment: binding.increment,
      })),
    );
    const progress = [...this.state.progress.values()].map((state) => ({
      tenant: String(state.tenant),
      subject: String(state.subject),
      achievement: String(state.achievement),
      current: state.current,
      unlocked: state.unlocked,
      unlockedAt: state.unlockedAt === undefined ? undefined : Number(state.unlockedAt),
      evidenceApplied: state.evidenceApplied.map((digest) => String(digest)),
    }));
    return { revision: this.state.revision, definitions, bindings, progress, awards: [...this.state.awards] };
  }

  private adoptDocument(document: AchievementsStateDocument): void {
    this.state.definitions.clear();
    this.state.bindings.clear();
    this.state.predicates.clear();
    this.state.progress.clear();
    this.state.awards = [];
    for (const row of document.definitions) {
      const definition: TenantAchievementDefinition = {
        tenant: row.tenant as TenantId,
        achievementId: row.achievement as AchievementId,
        metric: row.metric,
        threshold: row.threshold,
        visibility: row.visibility,
        progression: row.progression,
      };
      this.state.definitions.set(defKey(definition.tenant, definition.achievementId), definition);
    }
    for (const row of document.bindings) {
      const key = defKey(row.tenant as TenantId, row.achievement as AchievementId);
      const binding: AchievementEventBinding = {
        capability: "achievements",
        eventKind: row.eventKind as never,
        achievement: row.achievement as AchievementId,
        increment: row.increment,
      };
      const list = this.state.bindings.get(key) ?? [];
      list.push(binding);
      this.state.bindings.set(key, list);
    }
    for (const [key, list] of this.state.bindings) {
      this.state.predicates.set(key, list.map(predicateForBinding));
    }
    for (const row of document.progress) {
      const state: SubjectProgressState = {
        tenant: row.tenant as TenantId,
        subject: row.subject as SubjectId,
        achievement: row.achievement as AchievementId,
        current: row.current,
        unlocked: row.unlocked,
        unlockedBy: row.unlocked ? "platform-authority" : undefined,
        unlockedAt: row.unlockedAt === undefined ? undefined : (row.unlockedAt as TimestampMs),
        evidenceApplied: row.evidenceApplied.map((digest) => digest as ContentDigest),
      };
      this.state.progress.set(progressKeyOf(state.tenant, state.subject, state.achievement), state);
    }
    for (const award of document.awards as unknown as AchievementAwardRecord[]) {
      this.state.awards.push(award);
    }
    this.state.revision = document.revision;
  }
}

function defKey(tenant: TenantId, achievement: AchievementId): string {
  return `${String(tenant)}|${String(achievement)}`;
}

function progressKeyOf(tenant: TenantId, subject: SubjectId, achievement: AchievementId): string {
  return `${String(tenant)}|${String(subject)}|${String(achievement)}`;
}
