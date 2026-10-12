/**
 * THE RIGHTS AUTHORITY (PL-041, R20) — the service composing the whole
 * security/rights adjudication pipeline. THE single mutable-state owner
 * (E1): this instance alone owns the host bindings, session bindings,
 * integrity-derived standings, elevated review rights and the refusal
 * ledger; sibling services are reached ONLY through read ports.
 *
 * Async/stateful discipline (spec/worker-contract.md):
 * - COMMAND ADMISSION: admin doors check the authority's own role seam
 *   first (`rights-admin` / `rights-auditor`, tenant-scoped, default
 *   deny); `decide`/`admitPackage`/`authorizeSettlement` are question
 *   doors — the request itself is the subject of adjudication.
 * - EVENT ORDER: every history (bindings, standings, elevated rights,
 *   ledger) is append-only, ordered by the monotonic revision counter
 *   bumped once per mutation (E10).
 * - IDEMPOTENCY KEY: content-derived record ids (bindings by definition
 *   digest + restriction, standings by verdict, escalation rights by
 *   case, refusals by refusal content). Same key → the recorded record,
 *   no second mutation; different content → a NEW append.
 * - STALE-RESULT RULE: `decide` reads one consistent port snapshot per
 *   call; the lattice never caches (a right is recomputed from current
 *   grants, bindings and standings on every request).
 * - REPLAY/RESUME BOUNDARY: `snapshot()`/`restore()` are whole-document
 *   content-addressed adoptions through the store port; restore
 *   re-validates every record — tampered history never re-enters.
 * - RETRY/CANCELLATION: pure synchronous domain — a crashed door either
 *   mutated nothing or is idempotent on retry.
 *
 * Purity: no IO, no timers, no globals — time, persistence and every
 * sibling read arrive through the injected ports; identifiers are
 * content-derived (E9).
 */

import { definitionDigest } from "@playliquid/avatar-runtime";
import { checkRestriction } from "@playliquid/avatar-runtime";
import { admitPackageRecord } from "./admission.ts";
import type { PackageAdmissionRequest, PackageAdmissionResult } from "./admission.ts";
import { adjudicate } from "./lattice.ts";
import type { AdjudicationResult, LatticeInputs } from "./lattice.ts";
import { authorizeSettlementAction } from "./entitlement.ts";
import type { SettlementActionRequest, SettlementAuthorization } from "./entitlement.ts";
import { foldStanding } from "./integrity-rights.ts";
import { mintEscalationRight } from "./escalation.ts";
import { appendRefusal, refusalRecordOf } from "./ledger.ts";
import { adoptDocument, documentOf, snapshotOf } from "./document.ts";
import type {
  ElevatedReviewRight,
  HostBindingRecord,
  IntegrityRightsEntry,
  RefusalRecord,
  RightsServiceOptions,
  SessionBindingRecord,
} from "./ports.ts";
import type {
  AvatarBindingInput,
  BindingResult,
  EscalationDoorResult,
  LatticeStateResult,
  LedgerReadResult,
  RestoreResult,
  RightsDoorRefusal,
  SessionBindingResult,
  SnapshotResult,
  StandingDoorResult,
} from "./service-types.ts";
import type { RightsDoorRefusalCode, RightsRequest } from "./vocabulary.ts";
import { checkRightsRole } from "./vocabulary.ts";

/** THE security/rights authority. One instance per host composition. */
export class RightsAuthority {
  readonly #options: RightsServiceOptions;
  #bindings: HostBindingRecord[] = [];
  #sessions: SessionBindingRecord[] = [];
  #standings: IntegrityRightsEntry[] = [];
  #rights: ElevatedReviewRight[] = [];
  #ledger: RefusalRecord[] = [];
  #revision = 0;

  constructor(options: RightsServiceOptions) {
    this.#options = options;
  }

  // -------------------------------------------------------------------------
  // The adjudication doors (question doors — refusals are ledgered, E8/E10)
  // -------------------------------------------------------------------------

  /** Adjudicates one rights request through the whole lattice (R20). */
  decide(request: RightsRequest): AdjudicationResult {
    const result = adjudicate(request, this.#latticeInputs());
    if (result.granted) return result;
    const appended = this.#appendRefusal(request.tenant, request.subject, result.code, result.detail, result.evidence);
    return appended.duplicate ? { ...result, recorded: appended.record } : result;
  }

  /** The package admission gate (PL-011 composition; rights-admin gated). */
  admitPackage(actor: string, tenant: string, request: PackageAdmissionRequest): PackageAdmissionResult {
    const role = checkRightsRole(this.#options.admins.grants(), tenant, actor, "rights-admin");
    if (!role.ok) {
      this.#appendRefusal(tenant, actor, role.code, `admission door role refusal: ${role.code}`, [`actor:${actor}`]);
      return { admitted: false, code: "not-authorized", detail: `rights-admin role refused: ${role.code}` };
    }
    const result = admitPackageRecord(request, {
      registry: this.#options.registry,
      artifacts: this.#options.artifacts,
    });
    if (!result.admitted) {
      this.#appendRefusal(tenant, actor, result.code, result.detail, [
        `package:${request.id}@${request.version}`,
        `digest:${request.contentDigest}`,
      ]);
    }
    return result;
  }

  /** The settlement-action authorization gate (R10 composition). */
  authorizeSettlement(
    actor: string,
    tenant: string,
    request: SettlementActionRequest,
  ): SettlementAuthorization {
    const result = authorizeSettlementAction(actor, tenant, request, {
      platformGrants: this.#options.platformGrants.grants(),
      declarations: this.#options.economy.declarationsOf(tenant),
      entitlement:
        request.kind === "entitlement-lifecycle"
          ? this.#options.economy.entitlementIn(tenant, request.entitlement)
          : undefined,
      suspension: this.#currentSuspension(tenant, request.subject),
    });
    if (!result.authorized) {
      this.#appendRefusal(tenant, request.subject, result.code, result.detail, result.evidence);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Admin doors (rights-admin; append-only state, E10)
  // -------------------------------------------------------------------------

  /** Registers one (tenant, host) avatar binding — the R5 restriction carrier. */
  registerAvatarBinding(actor: string, input: AvatarBindingInput): BindingResult {
    const role = checkRightsRole(this.#options.admins.grants(), input.tenant, actor, "rights-admin");
    if (!role.ok) return doorRefusal(role.code, `rights-admin role refused: ${role.code}`);
    if (
      typeof input.host !== "string" ||
      input.host.length === 0 ||
      input.definition === undefined ||
      input.restriction === undefined
    ) {
      return doorRefusal("invalid-request", "binding input is incomplete");
    }
    if (String(definitionDigest(input.definition)) !== String(input.definition.definitionDigest)) {
      return doorRefusal(
        "tampered-definition",
        `avatar definition digest ${String(input.definition.definitionDigest)} does not match its content (forged or corrupted)`,
      );
    }
    const restrictionProblem = checkRestriction(input.restriction);
    if (restrictionProblem !== undefined) {
      return doorRefusal("invalid-restriction", restrictionProblem);
    }
    const duplicate = this.#bindings.find(
      (binding) =>
        binding.tenant === input.tenant &&
        binding.host === input.host &&
        String(binding.definition.definitionDigest) === String(input.definition.definitionDigest) &&
        JSON.stringify(binding.restriction) === JSON.stringify(input.restriction),
    );
    if (duplicate !== undefined) {
      return { ok: true, binding: duplicate, duplicate: true };
    }
    this.#revision += 1;
    const binding: HostBindingRecord = {
      tenant: input.tenant,
      host: input.host,
      definition: input.definition,
      restriction: input.restriction,
      registeredAt: this.#options.clock.now(),
      revision: this.#revision,
    };
    this.#bindings.push(binding);
    return { ok: true, binding, duplicate: false };
  }

  /** Binds one runtime session to a tenant (R20 structural tenancy). */
  bindSession(actor: string, tenant: string, sessionId: string): SessionBindingResult {
    const role = checkRightsRole(this.#options.admins.grants(), tenant, actor, "rights-admin");
    if (!role.ok) return doorRefusal(role.code, `rights-admin role refused: ${role.code}`);
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return doorRefusal("invalid-request", "sessionId is required");
    }
    const current = this.#sessions.find((binding) => binding.sessionId === sessionId);
    if (current !== undefined) {
      if (current.tenant !== tenant) {
        return doorRefusal("session-bound-elsewhere", `session ${sessionId} is already bound to another tenant (R20)`);
      }
      return { ok: true, binding: current, duplicate: true };
    }
    this.#revision += 1;
    const binding: SessionBindingRecord = {
      tenant,
      sessionId,
      boundAt: this.#options.clock.now(),
      revision: this.#revision,
    };
    this.#sessions.push(binding);
    return { ok: true, binding, duplicate: false };
  }

  /** Ingests one subject's integrity standing as lattice evidence (R11). */
  ingestStanding(actor: string, tenant: string, subject: string): StandingDoorResult {
    const role = checkRightsRole(this.#options.admins.grants(), tenant, actor, "rights-admin");
    if (!role.ok) return doorRefusal(role.code, `rights-admin role refused: ${role.code}`);
    const read = this.#options.integrity.standingFor(tenant, subject);
    if (!read.ok) {
      return doorRefusal("no-recorded-verdict", "the integrity service has no recorded standing for this subject");
    }
    const folded = foldStanding(tenant, subject, read.verdict, this.#standings, this.#options.clock.now());
    if (!folded.ok) return doorRefusal("no-recorded-verdict", "standing fold refused");
    if (folded.duplicate) return folded;
    this.#revision += 1;
    const entry = { ...folded.entry, revision: this.#revision };
    this.#standings.push(entry);
    return { ok: true, entry, duplicate: false };
  }

  /** Mints one elevated review right from an ingested arena escalation case. */
  mintEscalationReviewRight(actor: string, tenant: string, subject: string, caseId: string): EscalationDoorResult {
    const role = checkRightsRole(this.#options.admins.grants(), tenant, actor, "rights-admin");
    if (!role.ok) return doorRefusal(role.code, `rights-admin role refused: ${role.code}`);
    const read = this.#options.escalations.caseOf(tenant, caseId);
    const minted = mintEscalationRight(tenant, subject, caseId, read, this.#rights, this.#options.clock.now());
    if (!minted.ok) return minted;
    if (minted.duplicate) return minted;
    this.#revision += 1;
    const right = { ...minted.right, revision: this.#revision };
    this.#rights.push(right);
    return { ok: true, right, duplicate: false };
  }

  // -------------------------------------------------------------------------
  // Auditor doors (rights-auditor, tenant-scoped reads)
  // -------------------------------------------------------------------------

  /** Reads the tenant-scoped refusal ledger (E10 view). */
  ledger(actor: string, tenant: string): LedgerReadResult {
    const role = checkRightsRole(this.#options.admins.grants(), tenant, actor, "rights-auditor");
    if (!role.ok) return doorRefusal(role.code, `rights-auditor role refused: ${role.code}`);
    return { ok: true, records: this.#ledger.filter((record) => record.tenant === tenant) };
  }

  /** Reads the tenant-scoped lattice state (bindings/standings/rights). */
  latticeState(actor: string, tenant: string): LatticeStateResult {
    const role = checkRightsRole(this.#options.admins.grants(), tenant, actor, "rights-auditor");
    if (!role.ok) return doorRefusal(role.code, `rights-auditor role refused: ${role.code}`);
    return {
      ok: true,
      state: {
        bindings: this.#bindings.filter((binding) => binding.tenant === tenant),
        sessions: this.#sessions.filter((binding) => binding.tenant === tenant),
        standings: this.#standings.filter((entry) => entry.tenant === tenant),
        elevated: this.#rights.filter((right) => right.tenant === tenant),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Durability seams (E6): whole-document snapshot / restore
  // -------------------------------------------------------------------------

  /** Snapshots the whole state as one content-addressed document. */
  snapshot(actor: string, tenant: string): SnapshotResult {
    const role = checkRightsRole(this.#options.admins.grants(), tenant, actor, "rights-admin");
    if (!role.ok) return doorRefusal(role.code, `rights-admin role refused: ${role.code}`);
    const document = documentOf({
      revision: this.#revision,
      bindings: [...this.#bindings],
      sessions: [...this.#sessions],
      standings: [...this.#standings],
      elevated: [...this.#rights],
      ledger: [...this.#ledger],
    });
    const stored = snapshotOf(document);
    this.#options.store.save(stored);
    return { ok: true, snapshotId: stored.snapshotId, revision: this.#revision };
  }

  /** Restores the whole state from a snapshot (latest when id omitted). */
  restore(actor: string, tenant: string, snapshotId?: string): RestoreResult {
    const role = checkRightsRole(this.#options.admins.grants(), tenant, actor, "rights-admin");
    if (!role.ok) return doorRefusal(role.code, `rights-admin role refused: ${role.code}`);
    const stored = snapshotId === undefined ? this.#options.store.list().at(-1) : this.#options.store.load(snapshotId);
    if (stored === undefined) {
      return doorRefusal("snapshot-not-found", "no snapshot matched the request");
    }
    const adoption = adoptDocument(stored.document);
    if (!adoption.ok) return doorRefusal(adoption.code, adoption.detail);
    this.#bindings = [...adoption.state.bindings];
    this.#sessions = [...adoption.state.sessions];
    this.#standings = [...adoption.state.standings];
    this.#rights = [...adoption.state.elevated];
    this.#ledger = [...adoption.state.ledger];
    this.#revision = adoption.state.revision;
    return { ok: true, revision: this.#revision };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  #latticeInputs(): LatticeInputs {
    return {
      platformGrants: this.#options.platformGrants.grants(),
      broker: this.#options.broker.snapshot(),
      bindings: this.#bindings,
      sessions: this.#sessions,
      standings: this.#standings,
      elevated: this.#rights,
    };
  }

  #currentSuspension(tenant: string, subject: string): IntegrityRightsEntry | undefined {
    let current: IntegrityRightsEntry | undefined;
    for (const entry of this.#standings) {
      if (entry.tenant === tenant && entry.subject === subject && entry.disposition === "suspended") {
        current = entry;
      }
    }
    return current;
  }

  #appendRefusal(
    tenant: string,
    subject: string,
    code: string,
    detail: string,
    evidence: readonly string[],
  ): { record: RefusalRecord; duplicate: boolean } {
    const record = refusalRecordOf({
      tenant,
      subject,
      code,
      detail,
      evidence,
      at: this.#options.clock.now(),
      revision: this.#revision + 1,
    });
    const appended = appendRefusal(this.#ledger, record);
    if (!appended.duplicate) {
      this.#revision += 1;
      this.#ledger.push(record);
    }
    return appended;
  }
}

/** The shared refusal arm of every admin/auditor door (module-local). */
function doorRefusal(code: RightsDoorRefusalCode, detail: string): RightsDoorRefusal {
  return { ok: false, code, detail };
}
