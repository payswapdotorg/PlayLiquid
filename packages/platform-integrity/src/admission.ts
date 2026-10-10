/**
 * EVALUATION ADMISSION — the fail-closed request gate (PL-018, E8).
 *
 * ONE pure oracle decides whether a behavioral-evidence evaluation
 * request is admissible. Every negative path is a typed refusal — never
 * an exception, never a silent default:
 *
 * - the replay reference must be a canonical contract slug;
 * - the command stream must pass @playliquid/replay's own fail-closed
 *   verifier (byte-form + digest): a FORGED or MUTATED stream artifact
 *   (entries that do not re-encode to the recorded canonical form, or a
 *   digest that does not address it) is refused with the verifier's own
 *   codes, surfaced verbatim;
 * - the trace must meet the policy's minimum sample (an honest refusal
 *   below it: the platform does not emit reports from evidence it
 *   considers too small to say anything) and its issued-at stamps must
 *   be non-decreasing (a recorded log cannot travel back in time);
 * - a declared claim's declaration must be structurally valid, belong to
 *   the SAME tenant and subject, and predate the evidence capture (a
 *   declaration made after the fact cannot back the session's mode);
 * - a re-execution observation must be pinned to the SAME stream digest
 *   it claims to have re-executed (misattributed outcome evidence is
 *   refused) and observed at/after capture;
 * - the enforcement posture, when stated, must be the frozen vocabulary.
 *
 * The declaration is evidence, never a bypass: it shapes evaluation (the
 * mode calibration in signals.ts) and is refused when it contradicts its
 * own record (tenant/subject/timing), but it never suppresses signals.
 *
 * Purity: no IO, no clocks — timestamps are caller-supplied values that
 * are validated, not read.
 */

import type {
  AiPlayMode,
  ContentDigest,
  IntegrityEnforcement,
  ParticipationModeDeclaration,
  ReplayId,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import {
  asReplayId,
  asTimestampMs,
  isAiPlayMode,
  isParticipationModeDeclaration,
  participationModeOf,
} from "@playliquid/platform-contracts";
import type { CommandStreamArtifact, IntegrityVerdict, RecordedCommand } from "@playliquid/replay";
import { verifyCommandStream } from "@playliquid/replay";
import type { IntegrityRiskPolicy } from "./policy.ts";
import type { OutcomeObservations, TimingObservations, TrajectoryObservations } from "./observations.ts";
import { extractOutcomeObservations, extractTimingObservations, extractTrajectoryObservations } from "./observations.ts";

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------

/** The authoritative source one evaluation consumes (read-only, R8). */
export interface ReplaySourceRef {
  /** Canonical contract slug of the sealed replay record. */
  readonly replayId: string;
  /** The sealed, content-addressed command stream artifact (verified). */
  readonly commandStream: CommandStreamArtifact;
}

/**
 * How the session's operating play mode is claimed:
 * - `declared`: backed by a typed participation declaration (tenant,
 *   subject and timing coherence enforced below);
 * - `unbacked`: stated from the platform's session record without a
 *   declaration document (honest: the record exists, the declaration
 *   does not).
 */
export type PlayModeClaim =
  | { readonly claimKind: "declared"; readonly declaration: ParticipationModeDeclaration }
  | { readonly claimKind: "unbacked"; readonly mode: AiPlayMode };

/** One typed replay re-execution comparison, pinned to its stream. */
export interface ReplayReexecutionObservation {
  /** The stream digest the comparison re-executed (must match the source). */
  readonly observedAgainst: string;
  /** The replay verifier's typed verdict (match/divergence/inconclusive). */
  readonly verdict: IntegrityVerdict;
  /** Caller-supplied observation time (must be at/after capture). */
  readonly observedAt: TimestampMs;
}

/** One behavioral-evidence evaluation request (the only write input). */
export interface IntegrityEvaluationRequest {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly source: ReplaySourceRef;
  /** Optional outcome evidence from a replay re-execution comparison. */
  readonly reexecution?: ReplayReexecutionObservation;
  readonly claim: PlayModeClaim;
  /** Enforcement posture mirrored from the game declaration (default report-only). */
  readonly enforcement?: IntegrityEnforcement;
  /** Caller-supplied capture time of the evidence. */
  readonly capturedAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// Admission results
// ---------------------------------------------------------------------------

/** Typed refusal codes (E8 negative coverage; frozen vocabulary). */
export type AdmissionRefusalCode =
  | "malformed-request"
  | "replay-ref-malformed"
  | "trace-empty"
  | "trace-insufficient"
  | "stream-malformed-entries"
  | "stream-form-mismatch"
  | "stream-digest-mismatch"
  | "trace-timing-inconsistent"
  | "declaration-invalid"
  | "declaration-tenant-mismatch"
  | "declaration-subject-mismatch"
  | "declaration-timing-mismatch"
  | "reexecution-observed-against-mismatch"
  | "reexecution-verdict-malformed"
  | "reexecution-timing-invalid"
  | "captured-at-invalid";

/** The result of the admission oracle. */
export type EvaluationAdmission =
  | { readonly ok: true; readonly evaluation: AdmittedEvaluation }
  | { readonly ok: false; readonly code: AdmissionRefusalCode; readonly detail: string };

/** A fully admitted evaluation: verified inputs + extracted observations. */
export interface AdmittedEvaluation {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly replayId: ReplayId;
  /** The verified command entries (admission order, read-only). */
  readonly entries: readonly RecordedCommand[];
  /** The stream digest in package-system form (`sha256:<hex>`). */
  readonly streamDigestRaw: string;
  /** The stream digest as a bare platform-contracts content digest. */
  readonly sourceDigest: ContentDigest;
  readonly timing: TimingObservations;
  readonly trajectory: TrajectoryObservations;
  readonly outcome: OutcomeObservations | undefined;
  readonly playMode: AiPlayMode;
  readonly declaration: ParticipationModeDeclaration | undefined;
  readonly enforcement: IntegrityEnforcement;
  readonly capturedAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------

function isVerdictShaped(verdict: unknown): boolean {
  if (typeof verdict !== "object" || verdict === null) return false;
  const candidate = verdict as Record<string, unknown>;
  if (candidate.kind === "match") {
    return (
      typeof candidate.confidence === "number" &&
      Number.isFinite(candidate.confidence) &&
      candidate.confidence >= 0 &&
      candidate.confidence <= 1 &&
      Array.isArray(candidate.sampledEventSeqs) &&
      typeof candidate.totalEventCount === "number"
    );
  }
  if (candidate.kind === "divergence") {
    return (
      typeof candidate.confidence === "number" &&
      Number.isFinite(candidate.confidence) &&
      candidate.confidence >= 0 &&
      candidate.confidence <= 1 &&
      Array.isArray(candidate.divergences) &&
      candidate.divergences.length > 0 &&
      typeof candidate.totalEventCount === "number"
    );
  }
  if (candidate.kind === "inconclusive") {
    return (
      typeof candidate.confidence === "number" &&
      Number.isFinite(candidate.confidence) &&
      candidate.confidence >= 0 &&
      candidate.confidence <= 1
    );
  }
  return false;
}

/**
 * THE admission oracle (pure). Same request + policy → same decision,
 * forever (E9). Fail closed on every negative path with a typed code.
 */
export function admitEvaluation(
  request: IntegrityEvaluationRequest,
  policy: IntegrityRiskPolicy,
): EvaluationAdmission {
  if (typeof request !== "object" || request === null) {
    return { ok: false, code: "malformed-request", detail: "request must be an object" };
  }
  const source = request.source;
  if (
    typeof source?.replayId !== "string" ||
    typeof source?.commandStream !== "object" ||
    source?.commandStream === null
  ) {
    return { ok: false, code: "malformed-request", detail: "source must carry replayId + commandStream" };
  }
  const replayId = asReplayId(source.replayId);
  if (replayId === undefined) {
    return {
      ok: false,
      code: "replay-ref-malformed",
      detail: "replayId must be a canonical contract slug",
    };
  }
  // Fail-closed stream verification: the artifact must re-encode to its
  // recorded canonical form and its digest must address it (forged or
  // mutated traces are refused with the verifier's own codes).
  const verification = verifyCommandStream(source.commandStream);
  if (!verification.ok) {
    const code: AdmissionRefusalCode =
      verification.code === "malformed-entries"
        ? "stream-malformed-entries"
        : verification.code === "form-mismatch"
          ? "stream-form-mismatch"
          : "stream-digest-mismatch";
    return { ok: false, code, detail: verification.detail };
  }
  const entries = source.commandStream.entries;
  if (entries.length === 0) {
    return { ok: false, code: "trace-empty", detail: "the command stream carries no commands" };
  }
  if (entries.length < policy.minTraceCommands) {
    return {
      ok: false,
      code: "trace-insufficient",
      detail: `trace of ${entries.length} commands is below the policy minimum of ${policy.minTraceCommands}`,
    };
  }
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]!;
    const current = entries[index]!;
    if (current.envelope.issuedAt < previous.envelope.issuedAt) {
      return {
        ok: false,
        code: "trace-timing-inconsistent",
        detail: `issued-at regressed at admission seq ${current.admissionSeq}`,
      };
    }
  }
  // Claim coherence: a declaration must be valid, same-tenant,
  // same-subject, and must predate the evidence it backs.
  let playMode: AiPlayMode;
  let declaration: ParticipationModeDeclaration | undefined;
  const claim = request.claim;
  if (typeof claim !== "object" || claim === null) {
    return { ok: false, code: "malformed-request", detail: "claim must be an object" };
  }
  if (claim.claimKind === "declared") {
    if (!isParticipationModeDeclaration(claim.declaration)) {
      return { ok: false, code: "declaration-invalid", detail: "declaration failed its structural guard" };
    }
    if (claim.declaration.tenant !== request.tenant) {
      return {
        ok: false,
        code: "declaration-tenant-mismatch",
        detail: "declaration belongs to a different tenant than the evaluation",
      };
    }
    if (claim.declaration.subject !== request.subject) {
      return {
        ok: false,
        code: "declaration-subject-mismatch",
        detail: "declaration belongs to a different subject than the evaluation",
      };
    }
    if (claim.declaration.declaredAt > request.capturedAt) {
      return {
        ok: false,
        code: "declaration-timing-mismatch",
        detail: "declaration postdates the evidence it claims to back",
      };
    }
    declaration = claim.declaration;
    playMode = participationModeOf(declaration);
  } else if (claim.claimKind === "unbacked" && isAiPlayMode(claim.mode)) {
    playMode = claim.mode;
  } else {
    return { ok: false, code: "malformed-request", detail: "claim must be declared or a valid unbacked mode" };
  }
  const enforcement: IntegrityEnforcement =
    request.enforcement === undefined ? "report-only" : request.enforcement;
  if (enforcement !== "report-only" && enforcement !== "policy-driven") {
    return { ok: false, code: "malformed-request", detail: "enforcement posture must be the frozen vocabulary" };
  }
  const capturedAt = asTimestampMs(request.capturedAt);
  if (capturedAt === undefined) {
    return { ok: false, code: "captured-at-invalid", detail: "capturedAt must be a safe non-negative integer" };
  }
  // Re-execution coherence: pinned to THIS stream, verdict shaped, and
  // observed at/after capture (outcome evidence cannot precede the
  // evidence it describes).
  let outcome: OutcomeObservations | undefined;
  const reexecution = request.reexecution;
  if (reexecution !== undefined) {
    if (reexecution.observedAgainst !== source.commandStream.streamDigest) {
      return {
        ok: false,
        code: "reexecution-observed-against-mismatch",
        detail: "the re-execution verdict is pinned to a different command stream",
      };
    }
    if (!isVerdictShaped(reexecution.verdict)) {
      return {
        ok: false,
        code: "reexecution-verdict-malformed",
        detail: "the re-execution verdict failed its structural shape",
      };
    }
    const observedAt = asTimestampMs(reexecution.observedAt);
    if (observedAt === undefined || observedAt < capturedAt) {
      return {
        ok: false,
        code: "reexecution-timing-invalid",
        detail: "observedAt must be a safe non-negative integer at/after capture",
      };
    }
    outcome = extractOutcomeObservations(reexecution.verdict);
  }
  return {
    ok: true,
    evaluation: {
      tenant: request.tenant,
      subject: request.subject,
      replayId,
      entries,
      streamDigestRaw: source.commandStream.streamDigest,
      sourceDigest: bareHexOf(source.commandStream.streamDigest),
      timing: extractTimingObservations(entries),
      trajectory: extractTrajectoryObservations(entries),
      outcome,
      playMode,
      declaration,
      enforcement,
      capturedAt,
    },
  };
}

/** Strips the package-system `sha256:` prefix to a bare content digest. */
export function bareHexOf(packageSystemDigest: string): ContentDigest {
  const bare = packageSystemDigest.startsWith("sha256:")
    ? packageSystemDigest.slice("sha256:".length)
    : packageSystemDigest;
  return bare as ContentDigest;
}
