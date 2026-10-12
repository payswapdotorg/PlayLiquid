/**
 * THE ESCALATION INTAKE ORACLE (PL-031, R18) — TOTAL, PURE, NEVER THROWS.
 *
 * Two admissions:
 *
 * 1. {@link registerEscalationSource} — the host registers the Lab's gap
 *    state this runtime may be asked to escalate: lab-organization gap
 *    findings (WITH the walked lab-contracts gap record that proves which
 *    rung the ladder reached — a finding alone is pre-ladder), lab-contracts
 *    gap records, lab-learning rung-classified summaries. Structural
 *    validation per kind consumes each authority's own oracles
 *    (validateGapRecord, gapFindingDigestOf); duplicates are idempotent
 *    receipts (E10).
 *
 * 2. {@link openArenaEscalationCase} — the host submits a DECIDED escalation
 *    command. The oracle, in order: validates the command's structure
 *    (`invalid-command`); re-derives the decision's content digest — a
 *    missing/incoherent decision is `undecided-escalation`, a mismatched one
 *    is `tampered-decision-digest` (the runtime NEVER auto-escalates);
 *    resolves the cited source (`unknown-source` — the unknown-gap-finding
 *    refusal; `tampered-source` — E8); runs the RUNG GATE (`rung-mismatch`:
 *    Arena is never a first resort — the source's trail must have reached
 *    the user/community rung or the Arena rung itself, and must be neither
 *    resolved nor blocked); resolves the arena-integration request envelope
 *    and runs its own coherence oracle (`invalid-envelope`, reasons
 *    attached); then opens the content-addressed case — a re-run of the same
 *    decided content returns the SAME case as a typed duplicate receipt
 *    (E6/E10).
 *
 * Purity: no IO, no clock (decidedAt/openedAt are caller-supplied), no
 * randomness.
 */

import { arenaAuthorizationScopeKey, initialArenaLifecycle } from "@playliquid/arena-integration";
import { isArenaRequestEnvelope, isArenaRequestKind, checkArenaRequestEnvelopeCoherence } from "@playliquid/arena-integration";
import { isArenaAuthorizationScope, isArenaEndpointRef, asArenaTimestampMs } from "@playliquid/arena-integration";
import type { ArenaRequestRejectionReason } from "@playliquid/arena-integration";
import { asContentDigest, asTimestampMs, isCapabilityGapRecord, isGapLadderRung, isValidContentDigest, validateGapRecord } from "@playliquid/lab-contracts";
import type { ContentDigest } from "@playliquid/lab-contracts";
import type { CapabilityGapFinding } from "@playliquid/lab-organization";
import { gapFindingDigestOf } from "@playliquid/lab-organization";
import { asSubjectId } from "@playliquid/platform-contracts";
import type { TenantId } from "@playliquid/platform-contracts";
import { arenaCaseDigestOf, arenaCaseIdOf, arenaCaseKeyDigestOf, arenaDecisionDigestOf, arenaSourceDigestOf, arenaSourceKeyOf } from "./digest.ts";
import { arenaRequestEnvelopeOf, bridgeArenaEscalationRequest, checkArenaEscalationRequestCoherence } from "./escalation-request.ts";
import { asArenaSourceKey } from "./primitives.ts";
import type {
  ArenaEscalationCase,
  ArenaEscalationCommand,
  ArenaIntakeResult,
  EscalationSourceSubmission,
  GapSummarySource,
  RegisteredEscalationSource,
  SourceRegistrationResult,
} from "./records.ts";
import { ARENA_ESCALATION_CASE_KIND } from "./records.ts";

/** The registry/intake view the service hands the pure oracle. */
export interface ArenaIntakeKnownState {
  /** Sources registered for the CALLER's tenant (service scopes before calling). */
  readonly sources: readonly RegisteredEscalationSource[];
  /** Cases opened for the CALLER's tenant. */
  readonly cases: readonly ArenaEscalationCase[];
}

/** Extracts the submission form of a registered source (identity fields stripped). */
function submissionOfSource(source: RegisteredEscalationSource): EscalationSourceSubmission {
  if (source.kind === "gap-finding") {
    return { kind: "gap-finding", finding: source.finding, record: source.record };
  }
  if (source.kind === "gap-record") {
    return { kind: "gap-record", record: source.record };
  }
  return { kind: "gap-summary", summary: source.summary };
}

/** Structural validation of a lab-organization capability-gap finding. */
function validGapFinding(finding: CapabilityGapFinding): boolean {
  return (
    typeof finding.missingCapability === "string" &&
    finding.missingCapability.length > 0 &&
    finding.missingCapability.length <= 128 &&
    typeof finding.currentOrganization === "string" &&
    finding.currentOrganization.length > 0 &&
    typeof finding.candidateOrganization === "string" &&
    finding.candidateOrganization.length > 0 &&
    typeof finding.candidateDigest === "string" &&
    isValidContentDigest(finding.candidateDigest)
  );
}

/** Structural validation of a lab-learning rung-classified gap summary. */
function validGapSummary(summary: GapSummarySource): boolean {
  if (typeof summary.missingCapability !== "string" || summary.missingCapability.length === 0) return false;
  if (!isGapLadderRung(summary.currentRung)) return false;
  if (!Array.isArray(summary.reachedRungs) || summary.reachedRungs.length === 0) return false;
  if (!summary.reachedRungs.every((rung) => isGapLadderRung(rung))) return false;
  if (new Set(summary.reachedRungs).size !== summary.reachedRungs.length) return false;
  if (!summary.reachedRungs.includes(summary.currentRung)) return false;
  if (typeof summary.recurrenceCount !== "number" || !Number.isSafeInteger(summary.recurrenceCount) || summary.recurrenceCount < 1) {
    return false;
  }
  if (summary.recurring !== summary.recurrenceCount > 1) return false;
  if (typeof summary.resolved !== "boolean" || typeof summary.blocked !== "boolean") return false;
  if (!Array.isArray(summary.gapIds) || summary.gapIds.length === 0) return false;
  if (!Array.isArray(summary.cycleIds) || summary.cycleIds.length === 0) return false;
  return Array.isArray(summary.rungAttemptCounts);
}

/** Registers one escalation source (pure fold over the known registry). */
export function registerEscalationSource(
  tenant: TenantId,
  submission: EscalationSourceSubmission,
  known: readonly RegisteredEscalationSource[],
): SourceRegistrationResult {
  if (submission.kind === "gap-finding" && !validGapFinding(submission.finding)) {
    return { ok: false, code: "invalid-source", detail: "capability-gap finding failed structural validation" };
  }
  if (submission.kind === "gap-finding" && submission.record.missingCapability !== submission.finding.missingCapability) {
    return { ok: false, code: "invalid-source", detail: "the walked gap record and the finding must state the same missing capability" };
  }
  if (submission.kind === "gap-finding" || submission.kind === "gap-record") {
    if (!isCapabilityGapRecord(submission.record)) {
      return { ok: false, code: "invalid-source", detail: "the gap record is not structurally a CapabilityGapRecord" };
    }
    const validation = validateGapRecord(submission.record);
    if (!validation.ok) {
      return {
        ok: false,
        code: "invalid-source",
        detail: `gap record failed lab-contracts ladder validation: ${validation.violations[0]?.code ?? "violations"}`,
      };
    }
  }
  if (submission.kind === "gap-summary" && !validGapSummary(submission.summary)) {
    return { ok: false, code: "invalid-source", detail: "the rung-classified gap summary failed structural validation" };
  }
  const sourceDigest = arenaSourceDigestOf({ tenant: String(tenant), submission });
  const existing = known.find((registered) => registered.tenant === tenant && registered.sourceDigest === sourceDigest);
  if (existing !== undefined) {
    return { ok: true, source: existing, duplicate: true };
  }
  const source: RegisteredEscalationSource = Object.freeze({
    tenant,
    sourceKind: submission.kind,
    sourceDigest,
    sourceKey: arenaSourceKeyOf(sourceDigest),
    ...submission,
  });
  return { ok: true, source, duplicate: false };
}

// ---------------------------------------------------------------------------
// The rung gate (R18: Arena is never a first resort)
// ---------------------------------------------------------------------------

/** The rungs from which an Arena escalation is legal (community or Arena itself). */
const ARENA_ELIGIBLE_RUNGS: ReadonlySet<string> = new Set(["user-community-contribution", "arena-escalation"]);

/** The rung gate: the source's ladder position must make Arena the next (or current) rung. */
export function arenaRungGateOfSource(source: RegisteredEscalationSource): { readonly ok: true } | { readonly ok: false; readonly detail: string } {
  if (source.kind === "gap-summary") {
    if (source.summary.resolved) return { ok: false, detail: "a resolved gap takes no further rungs (lab-contracts)" };
    if (source.summary.blocked) return { ok: false, detail: "blocked is terminal — nothing follows it (lab-contracts)" };
    if (!ARENA_ELIGIBLE_RUNGS.has(source.summary.currentRung)) {
      return { ok: false, detail: `the gap summary's ladder rung is ${source.summary.currentRung}; Arena is only reachable after the user/community rung (R18)` };
    }
    return { ok: true };
  }
  const record = source.record;
  if (record.attempts.some((attempt) => attempt.rung !== "blocked" && attempt.outcome === "resolved")) {
    return { ok: false, detail: "a resolved gap takes no further rungs (lab-contracts)" };
  }
  const last = record.attempts[record.attempts.length - 1];
  if (last === undefined) return { ok: false, detail: "the gap record's ladder trail is empty — Arena is never a first resort (R18)" };
  if (last.rung === "blocked") return { ok: false, detail: "blocked is terminal — nothing follows it (lab-contracts)" };
  if (!ARENA_ELIGIBLE_RUNGS.has(last.rung)) {
    return { ok: false, detail: `the gap record's ladder trail ended at ${last.rung}; Arena is only reachable after the user/community rung (R18)` };
  }
  return { ok: true };
}

/**
 * The content-addressed capability-gap summary digest of a source — WHY the
 * Lab escalated, in the envelope's cycle context. Findings use
 * lab-organization's own finding-digest oracle (the detection identity);
 * records and summaries use their canonical content digest.
 */
export function gapSummaryDigestOfSource(source: RegisteredEscalationSource): ContentDigest {
  if (source.kind === "gap-finding") {
    return gapFindingDigestOf({
      tenant: String(source.tenant),
      missingCapability: source.finding.missingCapability,
      candidateDigest: source.finding.candidateDigest,
    });
  }
  if (source.kind === "gap-record") {
    return arenaSourceDigestOf({ record: source.record });
  }
  return arenaSourceDigestOf({ summary: source.summary });
}

// ---------------------------------------------------------------------------
// Case opening (the decided-escalation admission)
// ---------------------------------------------------------------------------

/** Opens (or resumes) the content-addressed escalation case of a DECIDED escalation. */
export function openArenaEscalationCase(
  tenant: TenantId,
  command: ArenaEscalationCommand,
  state: ArenaIntakeKnownState,
): ArenaIntakeResult {
  // 0. Totality guard: a non-object command can never read its fields.
  if (typeof command !== "object" || command === null) {
    return { ok: false, code: "invalid-command", detail: "the escalation command is not a record" };
  }

  // 1. Structural command validation.
  if (
    asSubjectId(String(command.decidedBy)) === undefined ||
    asTimestampMs(command.decidedAt) === undefined ||
    asArenaSourceKey(String(command.sourceKey)) === undefined ||
    !isArenaRequestKind(command.requestKind) ||
    !isValidContentDigest(String(command.requestPayload)) ||
    !isArenaEndpointRef(command.endpoint) ||
    !isArenaAuthorizationScope(command.authorization)
  ) {
    return { ok: false, code: "invalid-command", detail: "the escalation command failed structural validation" };
  }
  if (command.expiresAt !== undefined) {
    const expires = asTimestampMs(command.expiresAt);
    if (expires === undefined || expires <= command.decidedAt) {
      return { ok: false, code: "invalid-command", detail: "expiresAt must be a valid timestamp after decidedAt" };
    }
  }

  // 2. The host decision verifies (R18: the runtime never auto-escalates).
  const expectedDecision = arenaDecisionDigestOf({
    tenant: String(tenant),
    decidedBy: String(command.decidedBy),
    decidedAt: command.decidedAt,
    sourceKey: String(command.sourceKey),
    requestKind: command.requestKind,
    requestPayload: String(command.requestPayload),
    endpointDigest: String(command.endpoint.endpointDigest),
    authorizationKey: arenaAuthorizationScopeKey(command.authorization),
  });
  const declaredDecision = asContentDigest(String(command.decisionDigest));
  if (declaredDecision === undefined) {
    return { ok: false, code: "undecided-escalation", detail: "no coherent host decision record — the runtime never auto-escalates (R18)" };
  }
  if (declaredDecision !== expectedDecision) {
    return { ok: false, code: "tampered-decision-digest", detail: "the declared decision digest does not match the decision content (E8)" };
  }

  // 3. The cited source resolves and verifies.
  const source = state.sources.find((registered) => registered.sourceKey === command.sourceKey);
  if (source === undefined) {
    return { ok: false, code: "unknown-source", detail: `no escalation source ${String(command.sourceKey)} was ever registered for this tenant` };
  }
  if (source.tenant !== tenant || arenaSourceDigestOf({ tenant: String(tenant), submission: submissionOfSource(source) }) !== source.sourceDigest) {
    return { ok: false, code: "tampered-source", detail: "the registered source no longer matches its content-addressed digest (E8)" };
  }

  // 4. The rung gate.
  const gate = arenaRungGateOfSource(source);
  if (!gate.ok) {
    return { ok: false, code: "rung-mismatch", detail: gate.detail };
  }

  // 5. The content-addressed case identity (decision bookkeeping excluded — E6).
  const caseKey = arenaCaseKeyDigestOf({
    tenant: String(tenant),
    sourceKey: String(command.sourceKey),
    requestKind: command.requestKind,
    requestPayload: String(command.requestPayload),
    endpointDigest: String(command.endpoint.endpointDigest),
    authorizationKey: arenaAuthorizationScopeKey(command.authorization),
  });
  const caseId = arenaCaseIdOf(caseKey);
  const existing = state.cases.find((opened) => opened.caseId === caseId);
  if (existing !== undefined) {
    return { ok: true, case: existing, duplicate: true };
  }

  // 6. The wire envelope and its coherence oracle.
  const envelope = arenaRequestEnvelopeOf({
    requestPayload: command.requestPayload,
    gapSummary: gapSummaryDigestOfSource(source),
    requestKind: command.requestKind,
    authorization: command.authorization,
    endpoint: command.endpoint,
  });
  const envelopeCoherence = checkArenaRequestEnvelopeCoherence(envelope);
  if (!envelopeCoherence.coherent) {
    return {
      ok: false,
      code: "invalid-envelope",
      detail: `the resolved request envelope failed coherence: ${envelopeCoherence.reasons.join(", ")}`,
      envelopeReasons: [...envelopeCoherence.reasons] as readonly ArenaRequestRejectionReason[],
    };
  }
  const request = bridgeArenaEscalationRequest(envelope, command.requestPayload, caseKey);
  const bridged = checkArenaEscalationRequestCoherence(request);
  if (!bridged.coherent || !isArenaRequestEnvelope(request)) {
    return { ok: false, code: "invalid-envelope", detail: `the bridged escalation request failed coherence: ${bridged.coherent ? "" : bridged.reasons.join(", ")}` };
  }

  // 7. Open the case.
  const openedAt = command.decidedAt;
  const record: ArenaEscalationCase = Object.freeze({
    caseKind: ARENA_ESCALATION_CASE_KIND,
    caseId,
    tenant,
    decidedBy: command.decidedBy,
    sourceKey: command.sourceKey,
    sourceKind: source.sourceKind,
    request,
    lifecycle: initialArenaLifecycle(command.expiresAt === undefined ? undefined : asArenaTimestampMs(command.expiresAt)),
    openedAt,
    caseDigest: arenaCaseDigestOf({
      caseId: String(caseId),
      tenant: String(tenant),
      sourceKey: String(command.sourceKey),
      sourceKind: source.sourceKind,
      request,
      openedAt,
    }),
  });
  return { ok: true, case: record, duplicate: false };
}
