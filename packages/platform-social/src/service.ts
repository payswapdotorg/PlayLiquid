/**
 * THE SOCIAL SERVICE — the social graph authority (PL-015; matrix row
 * `social | Platform | platform-contracts, game-ir`).
 *
 * The service instance is the single mutable-state owner (E1): it owns
 * the follow/block edge tables, the append-only change history and the
 * evidence registry. Clients receive read models and typed admissions
 * only; relation changes are ONLY ever recorded here, stamped with the
 * platform authority marker (lock 18: the frozen
 * `platform.social.relationship.changed` lifecycle this service owns).
 *
 * Async/stateful discipline (spec/worker-contract.md) — every item
 * owned and tested:
 *
 * - MUTABLE STATE OWNER: this instance. Edge tables, change records,
 *   evidence registry, revision. Persistence flows ONLY through the
 *   SocialStore port (snapshots), time through ServiceClock, subject
 *   facts through SubjectDirectory, grants through GrantDirectory.
 * - COMMAND ADMISSION: `submit` is the single door: actor least
 *   privilege (`checkLeastPrivilege`, "social"/"submit", R20) ->
 *   evidence digest derivation (game-ir hashEvent) -> idempotency
 *   encounter (evidence registry; E10 returns the recorded receipt) ->
 *   facts derivation from OWNED state -> the pure oracle
 *   (`adjudicateSocialGraphCommand`, which binds the platform
 *   contracts oracle `adjudicateSocialAction`).
 * - EVENT ORDER: change records append in admission order; the
 *   follow-severing side record of an admitted block appends
 *   immediately after the block record; revision advances 1:1.
 * - IDEMPOTENCY KEY: the evidence digest (game-ir hashEvent). Same
 *   digest -> the recorded receipt, never a second mutation (E10).
 * - STALE-RESULT RULE: reads always reflect the current edges; change
 *   records never change after recording.
 * - REPLAY/RESUME BOUNDARY: `snapshot()` persists a content-addressed
 *   checkpoint; `restore()` re-adopts a stored document whole.
 * - RETRY/CANCELLATION: a rejected submission is not recorded, so a
 *   corrected retry is a fresh encounter; a replayed admitted evidence
 *   returns its receipt. Synchronous domain — nothing to cancel.
 */

import { checkLeastPrivilege } from "@playliquid/platform-contracts";
import type {
  ContentDigest,
  SocialServicePolicy,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import { canonicalJson, digestOf } from "./digest.ts";
import { adjudicateSocialGraphCommand } from "./admission.ts";
import type { SocialGraphCommand, SocialGraphFactsInput, SocialRefusalCode } from "./admission.ts";
import { changeRecordId, evidenceDigestOf } from "./history.ts";
import type { SocialRelationChangeRecord, SocialRelationKind } from "./history.ts";
import type {
  GrantDirectory,
  ServiceClock,
  SocialStateDocument,
  SocialStore,
  SubjectDirectory,
} from "./ports.ts";
import { isSocialStateDocument } from "./ports.ts";
import { deriveGraphView, edgeKey } from "./relations.ts";
import type { SocialEdge, SocialGraphView } from "./relations.ts";

/** Construction options. */
export interface SocialServiceOptions {
  readonly store: SocialStore;
  readonly clock: ServiceClock;
  readonly directory: SubjectDirectory;
  readonly grants: GrantDirectory;
  readonly policy: SocialServicePolicy;
  /** Graph kinds the game declared (lock 18). */
  readonly declaredGraphs: readonly string[];
}

/** Admission result enriched with the recorded receipt (E10). */
export type SocialSubmitResult =
  | { readonly accepted: true; readonly recorded: readonly SocialRelationChangeRecord[] }
  | {
      readonly accepted: false;
      readonly code: SocialRefusalCode | "tenant-mismatch" | "capability-not-granted" | "permission-not-granted";
      readonly detail: string;
      readonly recorded?: SocialRelationChangeRecord;
    };

/** Result of a snapshot or restore operation. */
export type SocialSnapshotOutcome =
  | { readonly ok: true; readonly snapshotId: ContentDigest; readonly revision: number }
  | { readonly ok: false; readonly code: "empty-state" | "unknown-snapshot" | "malformed-snapshot"; readonly detail: string };

interface SocialState {
  revision: number;
  edges: Map<string, SocialEdge>;
  changes: SocialRelationChangeRecord[];
  evidence: Map<string, string>;
}

/** The social graph service. Construct, then submit commands. */
export class SocialService {
  private readonly clock: ServiceClock;
  private readonly options: SocialServiceOptions;
  private readonly state: SocialState = {
    revision: 0,
    edges: new Map(),
    changes: [],
    evidence: new Map(),
  };

  constructor(options: SocialServiceOptions) {
    this.options = options;
    this.clock = options.clock;
  }

  // -----------------------------------------------------------------------
  // Commands (typed admission, least privilege, E10 idempotency)
  // -----------------------------------------------------------------------

  /** Submit one relation command through the full admission pipeline. */
  submit(command: SocialGraphCommand): SocialSubmitResult {
    const privilege = checkLeastPrivilege(
      { tenant: command.tenant, subject: command.actor, capability: "social", permission: "submit" },
      this.options.grants.grants(),
    );
    if (!privilege.ok) {
      return { accepted: false, code: privilege.code, detail: `least-privilege refusal: ${privilege.code}` };
    }
    const digest = evidenceDigestOf(command.evidence);
    if (digest !== undefined) {
      const recordedId = this.state.evidence.get(String(digest));
      if (recordedId !== undefined) {
        const recorded = this.state.changes.find((change) => change.recordId === recordedId);
        return {
          accepted: false,
          code: "duplicate-evidence",
          detail: "evidence digest was already recorded (E10: the first receipt stands)",
          recorded,
        };
      }
    }
    const admission = adjudicateSocialGraphCommand(command, this.options.policy, this.factsOf(command, digest));
    if (!admission.accepted) return admission;
    const evidence = digest!;
    const now = this.clock.now();
    const recorded: SocialRelationChangeRecord[] = [];
    if (command.kind === "follow") {
      this.setEdge(command.tenant, "follow", command.actor, command.target);
      recorded.push(this.recordChange(command.tenant, command.actor, command.target, "follow", "added", evidence, now));
    } else if (command.kind === "unfollow") {
      this.dropEdge(command.tenant, "follow", command.actor, command.target);
      recorded.push(this.recordChange(command.tenant, command.actor, command.target, "follow", "removed", evidence, now));
    } else if (command.kind === "block") {
      // BLOCK BEATS FOLLOW: an existing follow is severed by the block.
      if (this.state.edges.has(edgeKey(command.tenant, "follow", command.actor, command.target))) {
        this.dropEdge(command.tenant, "follow", command.actor, command.target);
        recorded.push(
          this.recordChange(command.tenant, command.actor, command.target, "follow", "removed", evidence, now),
        );
      }
      this.setEdge(command.tenant, "block", command.actor, command.target);
      recorded.push(this.recordChange(command.tenant, command.actor, command.target, "block", "added", evidence, now));
    } else {
      this.dropEdge(command.tenant, "block", command.actor, command.target);
      recorded.push(this.recordChange(command.tenant, command.actor, command.target, "block", "removed", evidence, now));
    }
    this.state.evidence.set(String(evidence), recorded[0]!.recordId);
    return { accepted: true, recorded };
  }

  // -----------------------------------------------------------------------
  // Read models (tenant-scoped, least-privilege "read", copies only)
  // -----------------------------------------------------------------------

  /** One subject's graph view within one tenant (read permission, R20). */
  graphView(tenant: TenantId, subject: SubjectId, actor: SubjectId): SocialGraphView | { readonly code: string; readonly detail: string } {
    const privilege = checkLeastPrivilege(
      { tenant, subject: actor, capability: "social", permission: "read" },
      this.options.grants.grants(),
    );
    if (!privilege.ok) return { code: privilege.code, detail: `least-privilege refusal: ${privilege.code}` };
    return deriveGraphView(tenant, subject, [...this.state.edges.values()]);
  }

  /** The append-only change history, tenant-scoped (E10). */
  history(tenant: TenantId, subject?: SubjectId): readonly SocialRelationChangeRecord[] {
    return this.state.changes
      .filter((change) => change.tenant === tenant && (subject === undefined || change.actor === subject))
      .map((change) => ({ ...change }));
  }

  /** The recorded receipt of one evidence digest, if any (E10). */
  evidenceReceipt(digest: ContentDigest): SocialRelationChangeRecord | undefined {
    const recordId = this.state.evidence.get(String(digest));
    if (recordId === undefined) return undefined;
    const found = this.state.changes.find((change) => change.recordId === recordId);
    return found === undefined ? undefined : { ...found };
  }

  // -----------------------------------------------------------------------
  // Snapshot / restore
  // -----------------------------------------------------------------------

  /** Persist a byte-stable, content-addressed checkpoint of all state. */
  snapshot(): SocialSnapshotOutcome {
    if (this.state.edges.size === 0) {
      return { ok: false, code: "empty-state", detail: "nothing to snapshot" };
    }
    const document = canonicalJson(this.toDocument());
    const snapshotId = digestOf(document);
    this.options.store.save({ snapshotId, revision: this.state.revision, document });
    return { ok: true, snapshotId, revision: this.state.revision };
  }

  /** Re-adopt a stored snapshot document (whole-document, no partial apply). */
  restore(snapshotId?: ContentDigest): SocialSnapshotOutcome {
    const stored = snapshotId === undefined ? this.options.store.list().at(-1) : this.options.store.load(snapshotId);
    if (stored === undefined) {
      return { ok: false, code: "unknown-snapshot", detail: "no stored snapshot to restore" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored.document);
    } catch {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not valid JSON" };
    }
    if (!isSocialStateDocument(parsed)) {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not a social state document" };
    }
    this.adoptDocument(parsed);
    return { ok: true, snapshotId: stored.snapshotId, revision: stored.revision };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private factsOf(command: SocialGraphCommand, digest: ContentDigest | undefined): SocialGraphFactsInput {
    return {
      declaredGraphs: this.options.declaredGraphs,
      targetExists: this.options.directory.exists(command.tenant, command.target),
      targetTenant: this.options.directory.tenantOf(command.target),
      evidenceDigest: digest,
      evidenceSeen: false,
      actorFollowsTarget: this.state.edges.has(edgeKey(command.tenant, "follow", command.actor, command.target)),
      actorBlocksTarget: this.state.edges.has(edgeKey(command.tenant, "block", command.actor, command.target)),
      targetBlocksActor: this.state.edges.has(edgeKey(command.tenant, "block", command.target, command.actor)),
      actorFollowingCount: this.followingCountOf(command.tenant, command.actor),
    };
  }

  private followingCountOf(tenant: TenantId, actor: SubjectId): number {
    let count = 0;
    for (const edge of this.state.edges.values()) {
      if (edge.relation === "follow" && edge.tenant === tenant && edge.actor === actor) count += 1;
    }
    return count;
  }

  private setEdge(tenant: TenantId, relation: SocialRelationKind, actor: SubjectId, target: SubjectId): void {
    this.state.edges.set(edgeKey(tenant, relation, actor, target), { tenant, actor, target, relation });
    this.state.revision += 1;
  }

  private dropEdge(tenant: TenantId, relation: SocialRelationKind, actor: SubjectId, target: SubjectId): void {
    this.state.edges.delete(edgeKey(tenant, relation, actor, target));
    this.state.revision += 1;
  }

  private recordChange(
    tenant: TenantId,
    actor: SubjectId,
    target: SubjectId,
    relation: SocialRelationKind,
    change: "added" | "removed",
    digest: ContentDigest,
    now: TimestampMs,
  ): SocialRelationChangeRecord {
    const record: SocialRelationChangeRecord = {
      recordId: changeRecordId(digest, relation, change),
      tenant,
      actor,
      target,
      relation,
      change,
      evidenceDigest: digest,
      recordedAt: now,
      decidedBy: "platform-authority",
    };
    this.state.changes.push(record);
    this.state.revision += 1;
    return record;
  }

  private toDocument(): SocialStateDocument {
    return {
      revision: this.state.revision,
      edges: [...this.state.edges.values()].map((edge) => ({
        tenant: String(edge.tenant),
        actor: String(edge.actor),
        target: String(edge.target),
        relation: edge.relation,
        since: 0 as TimestampMs,
        evidence: "",
      })),
      changes: [...this.state.changes],
      evidenceRegistry: [...this.state.evidence.entries()].map(([digest, recordId]) => ({ digest, recordId })),
    };
  }

  private adoptDocument(document: SocialStateDocument): void {
    const edges = new Map<string, SocialEdge>();
    for (const row of document.edges) {
      const edge: SocialEdge = {
        tenant: row.tenant as TenantId,
        actor: row.actor as SubjectId,
        target: row.target as SubjectId,
        relation: row.relation,
      };
      edges.set(edgeKey(edge.tenant, edge.relation, edge.actor, edge.target), edge);
    }
    this.state.edges = edges;
    this.state.changes = document.changes as readonly SocialRelationChangeRecord[] as SocialRelationChangeRecord[];
    this.state.evidence = new Map(document.evidenceRegistry.map((row) => [row.digest, row.recordId]));
    this.state.revision = document.revision;
  }
}

