/**
 * REPLAY REUSE-LANE CONTRACTS (R8 refinement, PL-009).
 *
 * "Replay is reusable by players, QA, integrity, simulation and Lab."
 *
 * ONE canonical replay record shape — {@link ReplayArtifactDescriptor}
 * in replay.ts, unchanged — and MANY typed lane views over it. No
 * per-lane duplicate authorities: a lane view WRAPS the canonical
 * descriptor and labels what the lane may do with it; it never
 * re-declares replay state.
 *
 * Lane requests carry lane-specific scopes (R8): players request only
 * their own replays; QA requests carry an assertion-harness reference
 * (qa-assertions.ts); integrity requests declare their evidence-
 * extraction scope; simulation requests are determinism-pinned and carry
 * a seed reference; Lab requests carry a study reference and their
 * outputs are labeled estimates (lock 28).
 *
 * {@link authorizeReplayLaneRequest} is the pure lane access oracle:
 * tenant isolation (R20), declared consumer (R8), platform sealing, and
 * the player own-subject scope rule — every refusal typed (E8).
 *
 * Purity: pure types + pure guards + one pure oracle. No IO.
 */

import { REPLAY_CONSUMERS } from "@playliquid/game-contracts";
import type { ReplayConsumer } from "@playliquid/game-contracts";
import type { ContentDigest, SubjectId, TenantId } from "./primitives.ts";
import { isValidContentDigest } from "./primitives.ts";
import type { ReplayId, ReplayArtifactDescriptor } from "./replay.ts";

/**
 * A replay reuse lane — the R8 consumer vocabulary, re-used (aliased)
 * from `@playliquid/game-contracts`. NOT a second vocabulary: the alias
 * exists so lane contracts read lane-native.
 */
export type ReplayLane = ReplayConsumer;

/** All valid {@link ReplayLane} values (the frozen R8 consumer list). */
export const REPLAY_LANES: readonly ReplayLane[] = REPLAY_CONSUMERS;

/** Returns true when `value` is a valid {@link ReplayLane}. */
export function isReplayLane(value: unknown): value is ReplayLane {
  return typeof value === "string" && (REPLAY_LANES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Lane request shapes (disjoint on the `lane` literal)
// ---------------------------------------------------------------------------

/**
 * A player requesting one of their OWN replays. The own-subject scope
 * is enforced by the access oracle, not by trust.
 */
export interface PlayerReplayRequest {
  readonly lane: "player";
  readonly tenant: TenantId;
  readonly requester: SubjectId;
  readonly replayId: ReplayId;
}

/** A QA-lane request: replay plus the assertion-harness scope to apply. */
export interface QaReplayRequest {
  readonly lane: "qa";
  readonly tenant: TenantId;
  readonly replayId: ReplayId;
  /** Digest of the assertion-harness specification (qa-assertions.ts). */
  readonly harnessDigest: ContentDigest;
}

/** An integrity-lane request: replay scoped to evidence extraction. */
export interface IntegrityReplayRequest {
  readonly lane: "integrity";
  readonly tenant: TenantId;
  readonly replayId: ReplayId;
  readonly evidenceScope: "behavioral-evidence";
}

/**
 * A simulation-lane request: deterministic re-execution. The
 * determinism pin is the structural literal `true` — a non-deterministic
 * simulation request is a type error, proven by type-misuse tests.
 */
export interface SimulationReplayRequest {
  readonly lane: "simulation";
  readonly tenant: TenantId;
  readonly replayId: ReplayId;
  readonly determinismRequired: true;
  /** Digest of the pinned seed/initial-state reference. */
  readonly seedRef: ContentDigest;
}

/**
 * A Lab-lane request: replay as study material. Lab outputs are labeled
 * estimates (lock 28) — the granted view carries that label explicitly.
 */
export interface LabReplayRequest {
  readonly lane: "lab";
  readonly tenant: TenantId;
  readonly replayId: ReplayId;
  /** Digest of the study the replay is requested for. */
  readonly studyRef: ContentDigest;
}

/** The union of lane requests, discriminated by `lane`. */
export type ReplayLaneRequest =
  | PlayerReplayRequest
  | QaReplayRequest
  | IntegrityReplayRequest
  | SimulationReplayRequest
  | LabReplayRequest;

/** Returns true when `value` is a structurally valid {@link ReplayLaneRequest}. */
export function isReplayLaneRequest(value: unknown): value is ReplayLaneRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  const digestLike = (candidate: unknown): boolean =>
    typeof candidate === "string" && isValidContentDigest(candidate);
  switch (request.lane) {
    case "player":
      return (
        typeof request.requester === "string" &&
        request.requester.length > 0 &&
        typeof request.replayId === "string" &&
        request.replayId.length > 0
      );
    case "qa":
      return typeof request.replayId === "string" && request.replayId.length > 0 && digestLike(request.harnessDigest);
    case "integrity":
      return (
        typeof request.replayId === "string" &&
        request.replayId.length > 0 &&
        request.evidenceScope === "behavioral-evidence"
      );
    case "simulation":
      return (
        typeof request.replayId === "string" &&
        request.replayId.length > 0 &&
        request.determinismRequired === true &&
        digestLike(request.seedRef)
      );
    case "lab":
      return typeof request.replayId === "string" && request.replayId.length > 0 && digestLike(request.studyRef);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Lane views (typed views over the ONE canonical descriptor)
// ---------------------------------------------------------------------------

/** What the player lane may do: review one's own captured play. */
export interface PlayerReplayView {
  readonly lane: "player";
  readonly artifact: ReplayArtifactDescriptor;
  readonly view: "own-subject";
}

/** What the QA lane may do: run assertion harnesses over the artifact. */
export interface QaReplayView {
  readonly lane: "qa";
  readonly artifact: ReplayArtifactDescriptor;
  readonly view: "assertion-harness";
}

/** What the integrity lane may do: extract behavioral evidence. */
export interface IntegrityReplayView {
  readonly lane: "integrity";
  readonly artifact: ReplayArtifactDescriptor;
  readonly view: "evidence-extraction";
}

/** What the simulation lane may do: deterministic re-execution. */
export interface SimulationReplayView {
  readonly lane: "simulation";
  readonly artifact: ReplayArtifactDescriptor;
  readonly view: "deterministic-replay";
}

/**
 * What the Lab lane may do: study the artifact with outputs labeled as
 * ESTIMATES — never historical fact (lock 28: counterfactuals are
 * explicitly labeled estimates).
 */
export interface LabReplayView {
  readonly lane: "lab";
  readonly artifact: ReplayArtifactDescriptor;
  readonly view: "labeled-estimate-only";
}

/** The union of lane views. Wraps the canonical descriptor; never re-declares it. */
export type ReplayLaneView =
  | PlayerReplayView
  | QaReplayView
  | IntegrityReplayView
  | SimulationReplayView
  | LabReplayView;

// ---------------------------------------------------------------------------
// Lane access oracle
// ---------------------------------------------------------------------------

/** Result of {@link authorizeReplayLaneRequest}. */
export type ReplayLaneDecision =
  | { readonly granted: true; readonly view: ReplayLaneView }
  | {
      readonly granted: false;
      readonly code:
        | "malformed-request"
        | "tenant-mismatch"
        | "lane-not-declared"
        | "artifact-not-sealed"
        | "lane-scope-violation";
      readonly replayId: ReplayId;
    };

/**
 * THE lane access oracle (pure; R8 + R20 + E8). A lane request is
 * granted a typed view only when: the request is structurally sound; the
 * requesting tenant owns the artifact (`tenant-mismatch`); the lane is
 * in the artifact's declared consumer list (`lane-not-declared`); the
 * artifact is sealed by the platform authority
 * (`artifact-not-sealed`); and the lane's own scope rule holds — for the
 * player lane, the artifact's subject IS the requester
 * (`lane-scope-violation`: players may never read another subject's
 * replay through the player lane).
 */
export function authorizeReplayLaneRequest(
  request: unknown,
  artifact: ReplayArtifactDescriptor,
): ReplayLaneDecision {
  if (!isReplayLaneRequest(request)) {
    return { granted: false, code: "malformed-request", replayId: artifact.replayId };
  }
  if (request.tenant !== artifact.tenant) {
    return { granted: false, code: "tenant-mismatch", replayId: artifact.replayId };
  }
  if (!artifact.consumers.includes(request.lane)) {
    return { granted: false, code: "lane-not-declared", replayId: artifact.replayId };
  }
  if (artifact.sealedBy !== "platform-authority") {
    return { granted: false, code: "artifact-not-sealed", replayId: artifact.replayId };
  }
  if (request.lane === "player" && request.requester !== artifact.subject) {
    return { granted: false, code: "lane-scope-violation", replayId: artifact.replayId };
  }
  switch (request.lane) {
    case "player":
      return { granted: true, view: { lane: "player", artifact, view: "own-subject" } };
    case "qa":
      return { granted: true, view: { lane: "qa", artifact, view: "assertion-harness" } };
    case "integrity":
      return { granted: true, view: { lane: "integrity", artifact, view: "evidence-extraction" } };
    case "simulation":
      return { granted: true, view: { lane: "simulation", artifact, view: "deterministic-replay" } };
    case "lab":
      return { granted: true, view: { lane: "lab", artifact, view: "labeled-estimate-only" } };
  }
}
