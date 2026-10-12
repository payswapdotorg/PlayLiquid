/**
 * THE LAB ORGANIZATION SERVICE (PL-029) — the single mutable-state owner
 * (E1) of the organization-search stage of the Lab loop.
 *
 * The service owns the tenant-scoped tables (search sessions, compiled
 * organizations, recorded evidence, capability gaps); EVERYTHING else is
 * a host-injected port (ports.ts). Discipline (spec/worker-contract.md):
 *
 * - command admission: the pure oracles — compile.ts (total compiler),
 *   sessions.ts (search admission + cursor paging), search.ts (seeded
 *   traversal), evaluation.ts (content-keyed evaluation) and gaps.ts
 *   (frozen ladder) — run over caller-supplied time + this service's
 *   owned state;
 * - idempotency: searches are content-addressed (same request content →
 *   same search id → duplicate open returns the session receipt);
 *   compilations are keyed by content digest; evaluations by content key
 *   (re-evaluation replays the recorded outcome, E10); gaps by finding
 *   digest;
 * - event order: append-only, admission order; recorded evidence is
 *   immutable — there is no rewrite path anywhere in this class;
 * - tenant isolation (R20): every read/advance checks
 *   `checkTenantIsolation` (platform-contracts authority — consumed, never
 *   re-implemented); cross-tenant access is a typed refusal (E8);
 * - persistence: every mutation snapshots the whole document
 *   content-addressed through {@link LabOrganizationStore} (E6 — the
 *   durable store is the host's to wire).
 *
 * Pure domain: no IO, no timers, no globals; synchronous refusals mutate
 * nothing.
 */

import type {
  CapabilityGapRecord,
  CapabilityId,
  OrganizationDescriptor,
  OrganizationSearchContext,
} from "@playliquid/lab-contracts";
import { asTimestampMs, isOrganizationDescriptor, sealRecord } from "@playliquid/lab-contracts";
import type { EvaluationSeed, LabCycleId, LabEvaluationSuiteRef } from "@playliquid/lab-contracts";
import type { HostRestriction } from "@playliquid/game-contracts";
import { checkTenantIsolation } from "@playliquid/platform-contracts";
import type { EvidenceBundleRef } from "@playliquid/lab-simulation";
import type {
  LabOrganizationCaller,
  LabOrganizationDocument,
  LabOrganizationPorts,
  StoredCandidateEvidence,
  StoredCapabilityGap,
  StoredCompilation,
  StoredSearch,
} from "./ports.ts";
import type {
  CompiledOrganization,
  OrganizationSearchRequest,
  SearchCursor,
} from "./records.ts";
import type {
  CompileDoorResult,
  EvaluateCandidateDoorInput,
  EvaluateDoorResult,
  EvaluateOrganizationDoorInput,
  GapAdvanceDoorInput,
  GapAdvanceDoorResult,
  GapReadResult,
  CompilationReadResult,
  SearchOpenResult,
  SearchPageResult,
} from "./service-types.ts";
import { compileOrganization } from "./compile.ts";
import type { CompileResult } from "./compile.ts";
import { candidateAtPosition, traversalOf } from "./search.ts";
import { cursorOf, openSearchSession, pageSearchSession } from "./sessions.ts";
import { evalRefuse, openedView, pageRefuse } from "./views.ts";
import { evaluateThroughPort } from "./evaluation.ts";
import type { EvaluateThroughPortResult } from "./evaluation.ts";
import { advanceGapResolution, asGapRecordId, detectCapabilityGaps, openGapFromFinding } from "./gaps.ts";
import type { CapabilityGapFinding } from "./gaps.ts";
import { organizationDocumentOf, restoreOrganizationTables } from "./document.ts";
import type { OrganizationTableSinks } from "./document.ts";

/** Construction options. */
export interface LabOrganizationServiceOptions {
  readonly ports: LabOrganizationPorts;
}

/** The service. Construct with injected ports; drive through the doors. */
export class LabOrganizationService {
  private readonly ports: LabOrganizationPorts;
  private readonly searches = new Map<string, StoredSearch>();
  private readonly compilations = new Map<string, StoredCompilation>();
  private readonly evidence = new Map<string, StoredCandidateEvidence>();
  private readonly gaps = new Map<string, StoredCapabilityGap>();

  constructor(options: LabOrganizationServiceOptions) {
    this.ports = options.ports;
  }

  /** E1 compile door: total compiler + tenant-scoped content-keyed record. */
  compileOrganization(input: {
    readonly descriptor: unknown;
    readonly as: LabOrganizationCaller;
    readonly capabilities?: readonly CapabilityId[];
    readonly restriction?: HostRestriction;
  }): CompileDoorResult {
    const result = this.runCompiler(input.descriptor, input.capabilities, input.restriction);
    if (!result.ok) return result;
    const key = String(result.compiled.contentDigest);
    const existing = this.compilations.get(key);
    if (existing !== undefined && existing.tenant === input.as.tenant) {
      return { ok: true, compiled: existing.compiled, duplicate: true };
    }
    this.compilations.set(key, {
      tenant: input.as.tenant,
      compiled: result.compiled,
      compiledAt: asTimestampMs(this.ports.clock.now())!,
    });
    this.persist();
    return { ok: true, compiled: result.compiled, duplicate: false };
  }

  /** Tenant-scoped read of one recorded compilation (R20). */
  getCompilation(contentDigest: string, as: LabOrganizationCaller): CompilationReadResult {
    const stored = this.compilations.get(contentDigest);
    if (stored === undefined) {
      return { ok: false, code: "compilation-unknown", detail: `compilation ${contentDigest} was never recorded` };
    }
    const isolation = checkTenantIsolation(as, stored);
    if (!isolation.ok) {
      return {
        ok: false,
        code: "cross-tenant",
        detail: `subject ${String(as.subject)} cannot read this compilation of tenant ${String(stored.tenant)} (R20)`,
      };
    }
    return { ok: true, compiled: stored.compiled };
  }

  /** Opens (or resumes) one search session — the stream admission door. */
  openSearch(request: OrganizationSearchRequest): SearchOpenResult {
    const admitted = openSearchSession(request, this.ports.bodies, this.ports.clock.now());
    if (!admitted.ok) return { ok: false, code: admitted.code, detail: admitted.detail };
    const stored = admitted.stored;
    const existing = this.searches.get(stored.searchId);
    if (existing !== undefined) {
      return openedView(existing, true);
    }
    this.searches.set(stored.searchId, stored);
    this.persist();
    return openedView(stored, false);
  }

  /** Pages the candidate stream (single-use monotonic cursors, E8). */
  nextCandidates(input: {
    readonly searchId: string;
    readonly cursor: SearchCursor;
    readonly limit?: number;
    readonly as: LabOrganizationCaller;
  }): SearchPageResult {
    const stored = this.searches.get(input.searchId);
    if (stored === undefined) {
      return pageRefuse("search-unknown", `search ${input.searchId} was never opened`);
    }
    const isolation = checkTenantIsolation(input.as, stored);
    if (!isolation.ok) {
      return pageRefuse("cross-tenant", `subject ${String(input.as.subject)} cannot read search ${input.searchId} of tenant ${String(stored.tenant)} (R20)`);
    }
    const page = pageSearchSession(stored, input);
    if (!page.ok) return page;
    stored.position = page.nextPosition;
    this.persist();
    return {
      ok: true,
      candidates: page.candidates,
      nextCursor: page.done ? undefined : cursorOf(stored),
      done: page.done,
    };
  }

  /** Evaluates one search candidate: compile → lab-simulation → evidence. */
  evaluateCandidate(input: EvaluateCandidateDoorInput): EvaluateDoorResult {
    const stored = this.searches.get(input.searchId);
    if (stored === undefined) {
      return evalRefuse("search-unknown", `search ${input.searchId} was never opened`);
    }
    const isolation = checkTenantIsolation(input.as, stored);
    if (!isolation.ok) {
      return evalRefuse("cross-tenant", `subject ${String(input.as.subject)} cannot evaluate in search ${input.searchId} of tenant ${String(stored.tenant)} (R20)`);
    }
    if (!Number.isInteger(input.position) || input.position < 0 || input.position >= stored.space.size) {
      return evalRefuse("candidate-out-of-range", `position must be an integer in [0, ${stored.space.size - 1}]`);
    }
    const candidate = candidateAtPosition(stored.space, traversalOf(stored.space, stored.request.seed), input.position);
    if (candidate === undefined) {
      return evalRefuse("candidate-out-of-range", "candidate position did not resolve");
    }
    const compiled = this.runCompiler(
      candidate.organization,
      stored.space.bounds.capabilityVocabulary,
      stored.request.restriction,
    );
    if (!compiled.ok) {
      return evalRefuse(compiled.code, "search candidate failed compilation", compiled.rejections);
    }
    return this.recordEvaluation({
      compiled: compiled.compiled,
      caller: input.as,
      cycleId: stored.request.cycleId,
      context: stored.request.context,
      suite: input.suite,
      evidence: input.evidence,
      parameters: input.parameters,
      searchId: input.searchId,
      position: input.position,
      currentOrganization: stored.request.currentOrganization,
    });
  }

  /** Evaluates an arbitrary (compiled here) organization descriptor. */
  evaluateOrganization(input: EvaluateOrganizationDoorInput): EvaluateDoorResult {
    const compiled = this.runCompiler(input.descriptor, input.capabilities, input.restriction);
    if (!compiled.ok) {
      return evalRefuse(compiled.code, "organization failed compilation", compiled.rejections);
    }
    return this.recordEvaluation({
      compiled: compiled.compiled,
      caller: input.as,
      cycleId: input.cycleId,
      context: input.context,
      suite: input.suite,
      evidence: input.evidence,
      parameters: input.parameters,
      currentOrganization: undefined,
    });
  }

  /** Advances one capability gap along the frozen ladder (one rung). */
  advanceCapabilityGap(input: GapAdvanceDoorInput): GapAdvanceDoorResult {
    const stored = this.gaps.get(input.gapId);
    if (stored === undefined || asGapRecordId(input.gapId) === undefined) {
      return { ok: false, code: "gap-unknown", detail: `gap ${input.gapId} was never recorded` };
    }
    const isolation = checkTenantIsolation(input.as, stored);
    if (!isolation.ok) {
      return { ok: false, code: "cross-tenant", detail: `subject ${String(input.as.subject)} cannot advance gap ${input.gapId} of tenant ${String(stored.tenant)} (R20)` };
    }
    const advanced = advanceGapResolution(stored.gap, input.attempt);
    if (!advanced.ok) return advanced;
    this.gaps.set(input.gapId, { tenant: stored.tenant, gap: advanced.gap });
    this.persist();
    return { ok: true, gap: advanced.gap };
  }

  /** Tenant-scoped read of one capability gap (R20). */
  getCapabilityGap(gapId: string, as: LabOrganizationCaller): GapReadResult {
    const stored = this.gaps.get(gapId);
    if (stored === undefined) {
      return { ok: false, code: "gap-unknown", detail: `gap ${gapId} was never recorded` };
    }
    const isolation = checkTenantIsolation(as, stored);
    if (!isolation.ok) {
      return { ok: false, code: "cross-tenant", detail: `subject ${String(as.subject)} cannot read gap ${gapId} of tenant ${String(stored.tenant)} (R20)` };
    }
    return { ok: true, gap: stored.gap };
  }

  /** Tenant-scoped listing of recorded capability gaps (R20). */
  listCapabilityGaps(as: LabOrganizationCaller): readonly CapabilityGapRecord[] {
    return [...this.gaps.values()].filter((stored) => checkTenantIsolation(as, stored).ok).map((stored) => stored.gap);
  }

  /** Tenant-scoped listing of recorded evidence (search results carry these). */
  listEvidence(as: LabOrganizationCaller): readonly StoredCandidateEvidence[] {
    return [...this.evidence.values()].filter((stored) => checkTenantIsolation(as, stored).ok);
  }

  /** The current content-addressed service document (persistence view). */
  document(): LabOrganizationDocument {
    return organizationDocumentOf({
      searches: [...this.searches.values()],
      compilations: [...this.compilations.values()],
      evidence: [...this.evidence.values()],
      gaps: [...this.gaps.values()],
    });
  }

  /** Restores the whole document from the store (E6 snapshot restore). */
  restore(): { readonly ok: true; readonly counts: { readonly searches: number; readonly compilations: number; readonly evidence: number; readonly gaps: number } } | { readonly ok: false; readonly detail: string } {
    const loaded = this.ports.store.load();
    if (loaded === undefined) {
      return { ok: false, detail: "no persisted document to restore" };
    }
    return { ok: true, counts: restoreOrganizationTables(this.tableSinks(), loaded) };
  }

  /** The private tables as restore sinks (document.ts stays class-agnostic). */
  private tableSinks(): OrganizationTableSinks {
    return { searches: this.searches, compilations: this.compilations, evidence: this.evidence, gaps: this.gaps };
  }

  /** Runs the pure compiler (shared by every compile path). */
  private runCompiler(
    descriptor: unknown,
    capabilities: readonly CapabilityId[] | undefined,
    restriction: HostRestriction | undefined,
  ): CompileDoorResult {
    const result: CompileResult = compileOrganization(descriptor, {
      ports: { bodies: this.ports.bodies, tools: this.ports.tools },
      capabilities,
      restriction,
    });
    if (result.ok) return { ok: true, compiled: result.compiled, duplicate: false };
    return { ok: false, code: result.rejections[0]?.code ?? "not-an-organization", rejections: result.rejections };
  }

  /** Records one evaluation outcome + gap findings (the shared tail). */
  private recordEvaluation(input: {
    readonly compiled: CompiledOrganization;
    readonly caller: LabOrganizationCaller;
    readonly cycleId: LabCycleId;
    readonly context: OrganizationSearchContext;
    readonly suite: LabEvaluationSuiteRef;
    readonly evidence: EvidenceBundleRef;
    readonly parameters: { readonly seed: EvaluationSeed; readonly tickBudget: number };
    readonly searchId?: string;
    readonly position?: number;
    readonly currentOrganization?: unknown;
  }): EvaluateDoorResult {
    const outcome: EvaluateThroughPortResult = evaluateThroughPort({
      compiled: input.compiled,
      caller: input.caller,
      cycleId: input.cycleId,
      context: input.context,
      suite: input.suite,
      evidence: input.evidence,
      parameters: input.parameters,
      searchId: input.searchId,
      position: input.position,
      port: this.ports.evaluation,
      known: [...this.evidence.values()],
      now: this.ports.clock.now(),
    });
    if (!outcome.ok) {
      return evalRefuse(outcome.code, outcome.detail, undefined, outcome.portCode);
    }
    if (!outcome.replayed) {
      this.evidence.set(String(outcome.evidence.contentKey), outcome.evidence);
    }
    const findings = this.recordGapFindings(input.caller, input.cycleId, input.currentOrganization, input.compiled.descriptor);
    this.persist();
    return { ok: true, replayed: outcome.replayed, evidence: outcome.evidence, gapFindings: findings };
  }

  /** Records typed gap findings of one evaluation (never silently skipped). */
  private recordGapFindings(
    caller: LabOrganizationCaller,
    cycleId: LabCycleId,
    currentOrganization: unknown,
    candidate: OrganizationDescriptor,
  ): readonly CapabilityGapRecord[] {
    if (currentOrganization === undefined || !isOrganizationDescriptor(currentOrganization)) return [];
    const detected: readonly CapabilityGapFinding[] = detectCapabilityGaps({ current: currentOrganization, candidate });
    const known = [...this.gaps.values()]
      .filter((stored) => checkTenantIsolation(caller, stored).ok)
      .map((stored) => stored.gap);
    const recorded: CapabilityGapRecord[] = [];
    for (const finding of detected) {
      const opened = openGapFromFinding(
        { finding, tenant: String(caller.tenant), cycleId, openedAt: asTimestampMs(this.ports.clock.now())! },
        known,
      );
      if (opened.ok) {
        this.gaps.set(String(opened.gap.gapId), sealRecord({ tenant: caller.tenant, gap: opened.gap }));
        recorded.push(opened.gap);
      }
    }
    return recorded;
  }

  /** Snapshots the whole document into the store (content-addressed, E6). */
  private persist(): void {
    this.ports.store.save(this.document());
  }
}
