/**
 * Build request/command contracts (E6: long-running work is
 * durable/queued/resumable — builds are admitted durably, never executed
 * synchronously here).
 *
 * Async/stateful documentation (worker contract):
 * - Mutable state owner: the BUILD SERVICE (PL-020 build orchestrator)
 *   owns the idempotency table (key → first build) and build phase.
 * - Command admission: {@link admitBuildRequest} is the single pure
 *   admission oracle; it never executes anything.
 * - Idempotency key: { scope, requester, nonce }. Retries re-submit the
 *   SAME key; a repeated key with a DIFFERENT payload fingerprint is a
 *   collision and is refused, never silently executed (E8 anti-gaming).
 * - Stale results/replay boundaries: owned by the orchestrator; this
 *   module only mints the fingerprints those rules compare.
 *
 * Request parameters use the GameIR value language (the engine-independent
 * data language of the semantic kernel) constrained to record values, and
 * are fingerprinted through game-ir's canonical value form — one
 * canonicalization authority for structured values.
 */

import { canonicalValueForm, isGameIRValue } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { BuildId, BuildNonce, BuildTargetId, RequesterId } from "./primitives.ts";
import { isNonEmptyIdText } from "./primitives.ts";
import type { BuildInputs } from "./inputs.ts";
import { computeBuildInputsDigest, validateBuildInputs } from "./inputs.ts";
import type { BuildPhase } from "./stages.ts";
import { isTerminalBuildPhase } from "./stages.ts";

/** A GameIR record value — the request parameter shape (kernel value language). */
export type BuildParameters = Extract<GameIRValue, { readonly kind: "record" }>;

/** Idempotency scopes of the build command path. */
export const BUILD_IDEMPOTENCY_SCOPES = Object.freeze(["build-request", "build-cancel"] as const);

/** An idempotency scope. */
export type BuildIdempotencyScope = (typeof BUILD_IDEMPOTENCY_SCOPES)[number];

/** Typed idempotency key of a build command (E6). */
export interface BuildIdempotencyKey {
  readonly scope: BuildIdempotencyScope;
  readonly requester: RequesterId;
  readonly nonce: BuildNonce;
}

/** Structural equality of two idempotency keys. */
export function buildIdempotencyKeyEquals(a: BuildIdempotencyKey, b: BuildIdempotencyKey): boolean {
  return a.scope === b.scope && a.requester === b.requester && a.nonce === b.nonce;
}

function isBuildIdempotencyKey(value: unknown): value is BuildIdempotencyKey {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<BuildIdempotencyKey>;
  return (
    (BUILD_IDEMPOTENCY_SCOPES as readonly string[]).includes(candidate.scope ?? "") &&
    isNonEmptyIdText(candidate.requester) &&
    isNonEmptyIdText(candidate.nonce)
  );
}

/** The frozen build command vocabulary. */
export const BUILD_COMMAND_KINDS = Object.freeze(["request-build", "cancel-build"] as const);

/** A build command kind. */
export type BuildCommandKind = (typeof BUILD_COMMAND_KINDS)[number];

/** Request a build: the full typed input set plus record-shaped parameters. */
export interface BuildRequestCommand {
  readonly kind: "request-build";
  readonly idempotency: BuildIdempotencyKey;
  readonly inputs: BuildInputs;
  /** Engine-independent request parameters (GameIR record value). */
  readonly parameters: BuildParameters;
  /** Caller-supplied epoch milliseconds; this package never reads a clock. */
  readonly requestedAt: number;
}

/** Cancel a previously admitted build (cooperative, at stage boundaries). */
export interface CancelBuildCommand {
  readonly kind: "cancel-build";
  readonly idempotency: BuildIdempotencyKey;
  readonly buildId: BuildId;
  readonly requestedAt: number;
}

/** Any build command. */
export type BuildCommand = BuildRequestCommand | CancelBuildCommand;

/** An admitted build request paired with the build id the service minted. */
export interface AdmittedBuildRequest {
  readonly request: BuildRequestCommand;
  readonly buildId: BuildId;
}

/** The orchestrator-owned build read model admission reasons over. */
export interface BuildStateRecord {
  readonly buildId: BuildId;
  readonly phase: BuildPhase;
  readonly admittedAt: number;
}

/** The first-encounter record of an idempotency key (read model). */
export interface BuildRequestEncounter {
  readonly key: BuildIdempotencyKey;
  readonly fingerprint: ContentDigest;
  readonly buildId: BuildId;
}

/** Admission context: the pure read models admission reasons over. */
export interface BuildAdmissionContext {
  /** Content digests the build service can currently resolve. */
  readonly resolvableDigests: ReadonlySet<ContentDigest>;
  /** Recorded first encounter of the presented key, when one exists. */
  readonly firstEncounter: BuildRequestEncounter | null;
}

/** Stable admission rejection codes. */
export type BuildAdmissionErrorCode =
  | "invalid-command"
  | "idempotency-collision"
  | "unresolvable-input"
  | "target-engine-incompatible";

/** A refused admission. */
export interface BuildAdmissionRejection {
  readonly ok: false;
  readonly code: BuildAdmissionErrorCode;
  readonly message: string;
  /** The unresolvable input, when the code is `unresolvable-input`. */
  readonly input?: "gameIr" | "packageLock" | "targetProfile" | "engineBinding" | "toolchain";
}

/** An accepted admission: either the first execution or a duplicate. */
export type BuildRequestAdmission =
  | { readonly ok: true; readonly classification: "first"; readonly fingerprint: ContentDigest }
  | {
      readonly ok: true;
      readonly classification: "duplicate";
      readonly fingerprint: ContentDigest;
      readonly buildId: BuildId;
    }
  | BuildAdmissionRejection;

/**
 * The deterministic payload fingerprint of a build request (E9). Inputs
 * enter through their canonical input-set digest; parameters through
 * game-ir's canonical value form (record field order insignificant).
 */
export function computeBuildRequestFingerprint(request: BuildRequestCommand): ContentDigest {
  return computeDigest({
    kind: request.kind,
    inputsDigest: computeBuildInputsDigest(request.inputs),
    parameters: canonicalValueForm(request.parameters),
  });
}

/** Validates the shape of a build request command. Pure, first failure wins. */
function validateBuildRequestCommand(request: BuildRequestCommand): string | null {
  if (request.kind !== "request-build") {
    return "command kind is not request-build";
  }
  if (!isBuildIdempotencyKey(request.idempotency) || request.idempotency.scope !== "build-request") {
    return "idempotency key is structurally invalid for a build request";
  }
  const inputs = validateBuildInputs(request.inputs);
  if (!inputs.ok) {
    return `build inputs are invalid: ${inputs.reasons.map((reason) => reason.code).join(", ")}`;
  }
  if (!isGameIRValue(request.parameters) || request.parameters.kind !== "record") {
    return "request parameters must be a GameIR record value";
  }
  if (typeof request.requestedAt !== "number" || !Number.isFinite(request.requestedAt) || request.requestedAt < 0) {
    return "requestedAt must be a finite, non-negative caller-supplied timestamp";
  }
  return null;
}

/**
 * THE build request admission oracle (pure). Check order is fixed and
 * fail-closed: structural validity → idempotency encounter (duplicate /
 * collision) → input digest resolvability → target/engine compatibility.
 * First failure wins.
 */
export function admitBuildRequest(
  request: BuildRequestCommand,
  context: BuildAdmissionContext,
): BuildRequestAdmission {
  const structural = validateBuildRequestCommand(request);
  if (structural !== null) {
    return { ok: false, code: "invalid-command", message: structural };
  }

  const fingerprint = computeBuildRequestFingerprint(request);
  const recorded = context.firstEncounter;
  if (recorded !== null && buildIdempotencyKeyEquals(recorded.key, request.idempotency)) {
    if (recorded.fingerprint !== fingerprint) {
      return {
        ok: false,
        code: "idempotency-collision",
        message:
          "idempotency key was already used with a different payload; refusing (never silently executed twice)",
      };
    }
    return { ok: true, classification: "duplicate", fingerprint, buildId: recorded.buildId };
  }

  const resolvable = context.resolvableDigests;
  const unresolvable = findUnresolvableInput(request.inputs, resolvable);
  if (unresolvable !== null) {
    return {
      ok: false,
      code: "unresolvable-input",
      input: unresolvable.name,
      message: `build input "${unresolvable.name}" digest is not resolvable`,
    };
  }

  if (!request.inputs.engineBinding.supportedTargets.includes(request.inputs.targetProfile.target)) {
    return {
      ok: false,
      code: "target-engine-incompatible",
      message: `engine binding "${request.inputs.engineBinding.engineId}" declares no support for target "${request.inputs.targetProfile.target}"`,
    };
  }

  return { ok: true, classification: "first", fingerprint };
}

/** The digests admission checks for resolvability, in canonical input order. */
export function buildInputDigests(
  inputs: BuildInputs,
): ReadonlyArray<{ readonly name: BuildInputName; readonly digest: ContentDigest }> {
  return [
    { name: "gameIr", digest: inputs.gameIr.digest },
    { name: "packageLock", digest: inputs.packageLock.lockFingerprint },
    { name: "targetProfile", digest: inputs.targetProfile.profileDigest },
    { name: "engineBinding", digest: inputs.engineBinding.bindingDigest },
    { name: "toolchain", digest: inputs.toolchain.profileDigest },
  ];
}

type BuildInputName = "gameIr" | "packageLock" | "targetProfile" | "engineBinding" | "toolchain";

function findUnresolvableInput(
  inputs: BuildInputs,
  resolvable: ReadonlySet<ContentDigest>,
): { readonly name: BuildInputName } | null {
  for (const entry of buildInputDigests(inputs)) {
    if (!resolvable.has(entry.digest)) {
      return { name: entry.name };
    }
  }
  return null;
}

/** Result of {@link admitCancelBuild}. */
export type CancelAdmissionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "invalid-command" | "build-not-cancellable"; readonly message: string };

/** Pure admission of a cancel command against the build's current phase. */
export function admitCancelBuild(command: CancelBuildCommand, build: BuildStateRecord): CancelAdmissionResult {
  if (command.kind !== "cancel-build") {
    return { ok: false, code: "invalid-command", message: "command kind is not cancel-build" };
  }
  if (!isBuildIdempotencyKey(command.idempotency) || command.idempotency.scope !== "build-cancel") {
    return { ok: false, code: "invalid-command", message: "idempotency key is structurally invalid for a cancel" };
  }
  if (!isNonEmptyIdText(command.buildId) || command.buildId !== build.buildId) {
    return { ok: false, code: "invalid-command", message: "cancel command does not name this build" };
  }
  if (isTerminalBuildPhase(build.phase)) {
    return {
      ok: false,
      code: "build-not-cancellable",
      message: `build is in terminal phase "${build.phase}" and cannot be cancelled`,
    };
  }
  return { ok: true };
}

/** Convenience: the target a request builds for (admission checks compatibility against it). */
export function requestTarget(request: BuildRequestCommand): BuildTargetId {
  return request.inputs.targetProfile.target;
}
