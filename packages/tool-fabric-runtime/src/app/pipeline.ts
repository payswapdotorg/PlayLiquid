/**
 * Module role: the invocation pipeline — the canonical synchronous execution
 * path of a tool call through the fabric contracts, in deterministic order:
 * request envelope validation → idempotency ledger (replay / in-flight
 * single-flight) → registry resolution → surface compatibility → capability
 * mediation (descriptor + request union against the granted set) → input
 * shape validation → exchange guard (no inline bytes; referenced artifacts
 * must resolve) → effective deadline (request or descriptor default) →
 * pre-dispatch cancellation/deadline checks → executor dispatch → stale
 * result + output exchange/shape/client-claim guards → typed outcome.
 * Every step is a typed failure; nothing throws; no wall-clock (ClockPort).
 *
 * Implements: PL-019 invocation pipeline over the PL-005 tool-fabric call
 * protocol (idempotency semantics binding per call-protocol.ts); E2 (one
 * canonical command path per call — the pipeline IS the fabric's path).
 */

import type {
  CallProvenance,
  CapabilityId,
  Deadline,
  InputIssue,
  ToolCallError,
  ToolCallOutcome,
  ToolCallRequest,
  ToolIdentity,
} from "@playliquid/tool-fabric";
import {
  buildCallProvenance,
  cancelledOutcome,
  capabilityRefusalOutcome,
  deadlineFromTimeoutMs,
  failureOutcome,
  idempotencyScope,
  inputFingerprint,
  mediateCapabilities,
  checkSurfaceCompatibility,
  okOutcome,
  surfaceMismatchOutcome,
  timeoutOutcome,
  validateToolCallRequest,
} from "@playliquid/tool-fabric";
import { containsClientClaim } from "@playliquid/engine-adapter-contract";
import { collectArtifactRefs, findExchangeViolation } from "../domain/exchange.ts";
import type { ToolRegistration } from "../domain/registry.ts";
import type {
  ArtifactExchangePort,
  ClockPort,
  ExecutorDispatch,
  ShapeCatalogPort,
  ToolExecutorPort,
} from "../domain/ports.ts";

/** One recorded idempotency-key completion. */
export interface LedgerEntry {
  readonly scope: string;
  readonly fingerprint: string | null;
  readonly outcome: ToolCallOutcome;
}

export interface InvocationPipeline {
  /**
   * Executes a tool call. `grantedCapabilities` defaults to the pipeline's
   * configured grant set; mediation refuses any missing capability.
   */
  invoke(request: unknown, grantedCapabilities?: readonly CapabilityId[]): Promise<ToolCallOutcome>;
  /** Snapshot of the completed idempotency ledger (deterministic order). */
  ledgerSnapshot(): readonly LedgerEntry[];
  /** Exact lookup of a completed ledger entry by scope. */
  ledgerLookup(scope: string): LedgerEntry | null;
  /**
   * Durability path (E6): re-records a completed entry after a host
   * restore. Only well-formed outcomes are recorded; the scope/fingerprint
   * come from the host's stored job record. Rehydrating an existing scope
   * is a no-op (first completed outcome stays authoritative).
   */
  ledgerRehydrate(scope: string, fingerprint: string | null, outcome: ToolCallOutcome): void;
}

export interface PipelineDeps {
  readonly registry: ToolRegistrationRegistryLike;
  readonly clock: ClockPort;
  readonly executor: ToolExecutorPort;
  readonly shapeCatalog: ShapeCatalogPort;
  readonly artifactExchange: ArtifactExchangePort;
  readonly grantedCapabilities?: readonly CapabilityId[];
}

/** Registry surface the pipeline needs (structural, for testability). */
export interface ToolRegistrationRegistryLike {
  resolve(identity: ToolIdentity, surfaceMajor: number): ToolResolutionLike;
}

export type ToolResolutionLike =
  | { readonly outcome: "ok"; readonly registration: ToolRegistration }
  | { readonly outcome: "rejected"; readonly code: string; readonly message: string; readonly registeredMajors?: readonly number[] };

const UNVALIDATED_CALL_ID = "(unvalidated)";
const FABRIC_GUARD_PROVENANCE = buildCallProvenance(
  { namespace: "playliquid.fabric", name: "request-guard" },
  { major: 0, minor: 0 },
);

/** Creates the synchronous invocation pipeline. The instance owns the ledger (E1). */
export function createInvocationPipeline(deps: PipelineDeps): InvocationPipeline {
  const defaultGranted: readonly CapabilityId[] = Object.freeze([...(deps.grantedCapabilities ?? [])]);
  const completed = new Map<string, LedgerEntry>();
  const inFlight = new Map<string, Promise<ToolCallOutcome>>();

  function ledgerSnapshot(): readonly LedgerEntry[] {
    return Object.freeze([...completed.values()]);
  }

  function ledgerLookup(scope: string): LedgerEntry | null {
    return completed.get(scope) ?? null;
  }

  function ledgerRehydrate(scope: string, fingerprint: string | null, outcome: ToolCallOutcome): void {
    if (scope.length === 0 || completed.has(scope)) {
      return;
    }
    completed.set(scope, Object.freeze({ scope, fingerprint, outcome }));
  }

  async function invoke(request: unknown, grantedCapabilities?: readonly CapabilityId[]): Promise<ToolCallOutcome> {
    const granted = grantedCapabilities ?? defaultGranted;

    const requestCheck = validateToolCallRequest(request);
    if (requestCheck.outcome === "rejected") {
      return failureOutcome(
        rawCallId(request),
        FABRIC_GUARD_PROVENANCE,
        invalidRequestError(requestCheck.rejections.map((item) => `${item.code}: ${item.message}`).join("; ")),
      );
    }
    const call: ToolCallRequest = requestCheck.request;

    const scope = idempotencyScope(call);
    if (scope === null) {
      return await runCall(call, granted, null);
    }
    const existing = completed.get(scope);
    if (existing !== undefined) {
      return replayOutcome(call, existing);
    }
    const pending = inFlight.get(scope);
    if (pending !== undefined) {
      // Single-flight: await the in-progress execution, then replay its
      // recorded outcome (a pre-dispatch cancellation records nothing, so
      // the awaiter falls through and executes freshly).
      await pending;
      const recorded = completed.get(scope);
      if (recorded !== undefined) {
        return replayOutcome(call, recorded);
      }
    }
    // Register the flight BEFORE the first await inside runCall so a
    // concurrent same-scope call can never start a second execution.
    let settle!: (outcome: ToolCallOutcome) => void;
    const flight = new Promise<ToolCallOutcome>((resolve) => {
      settle = resolve;
    });
    inFlight.set(scope, flight);
    try {
      const outcome = await runCall(call, granted, scope);
      settle(outcome);
      return outcome;
    } catch (error) {
      // The pipeline is total by contract; this is defense-in-depth so an
      // awaiter can never hang on the flight promise.
      const thrown = failureOutcome(
        call.callId,
        FABRIC_GUARD_PROVENANCE,
        executionFailedError(`pipeline threw: ${describeError(error)}`),
      );
      settle(thrown);
      return thrown;
    } finally {
      inFlight.delete(scope);
    }
  }

  async function runCall(call: ToolCallRequest, granted: readonly CapabilityId[], scope: string | null): Promise<ToolCallOutcome> {
    const resolution: ToolResolutionLike = deps.registry.resolve(call.tool, call.surfaceVersion.major);
    if (resolution.outcome === "rejected") {
      return failureOutcome(call.callId, FABRIC_GUARD_PROVENANCE, unavailableError(resolution.message));
    }
    const registration: ToolRegistration = resolution.registration;
    const descriptor = registration.descriptor;
    const provenance: CallProvenance = buildCallProvenance(descriptor.identity, descriptor.surfaceVersion);

    const surface = checkSurfaceCompatibility(call.surfaceVersion, descriptor.surfaceVersion);
    if (!surface.compatible) {
      return surfaceMismatchOutcome(call.callId, provenance, call.surfaceVersion, descriptor.surfaceVersion);
    }

    const mediation = mediateCapabilities([...descriptor.capabilities, ...call.requiredCapabilities], granted);
    if (mediation.outcome === "refused") {
      return capabilityRefusalOutcome(call.callId, provenance, mediation.refusal.missing);
    }

    const inputShape = deps.shapeCatalog.validate(descriptor.inputShape, call.input);
    if (inputShape.outcome === "rejected") {
      return failureOutcome(call.callId, provenance, invalidInputError(inputShape.issues, "input"));
    }

    const inputViolation = findExchangeViolation(call.input);
    if (inputViolation !== null) {
      return failureOutcome(call.callId, provenance, invalidInputError(
        [{ path: inputViolation.path, message: inputViolation.message }],
        "input",
      ));
    }

    const missingInputArtifact = await verifyArtifactRefs(deps.artifactExchange, call.input);
    if (missingInputArtifact !== null) {
      return failureOutcome(call.callId, provenance, invalidInputError([missingInputArtifact], "input"));
    }

    const deadline = effectiveDeadline(call, descriptor.defaultTimeoutMs, deps.clock);

    if (call.cancellation !== undefined && call.cancellation.requested) {
      // Pre-dispatch cancellation: the work never ran, so nothing is
      // recorded in the idempotency ledger — a later replay of the same
      // key executes freshly (documented cancellation semantics).
      return cancelledOutcome(call.callId, provenance, call.cancellation.reason ?? "caller-requested");
    }
    if (deadline !== undefined && deps.clock.now() >= deadline.atEpochMs) {
      const stale = timeoutOutcome(call.callId, provenance, deadline);
      recordCompletion(scope, call, stale);
      return stale;
    }

    return await execute(call, registration, deadline, provenance, scope);
  }

  async function execute(
    call: ToolCallRequest,
    registration: ToolRegistration,
    deadline: Deadline | undefined,
    provenance: CallProvenance,
    scope: string | null,
  ): Promise<ToolCallOutcome> {
    const dispatch: ExecutorDispatch = {
      kind: "executor-dispatch",
      callId: call.callId,
      registration,
      input: call.input,
      ...(deadline === undefined ? {} : { deadline }),
      ...(call.cancellation === undefined ? {} : { cancellation: call.cancellation }),
    };

    let result;
    try {
      result = await deps.executor.execute(dispatch);
    } catch (error) {
      const thrown = failureOutcome(call.callId, provenance, executionFailedError(`executor threw: ${describeError(error)}`));
      recordCompletion(scope, call, thrown);
      return thrown;
    }

    let outcome: ToolCallOutcome;
    if (result.outcome === "refused") {
      const unavailable =
        result.adapterCode === "adapter/not-ready" ||
        result.adapterCode === "adapter/closed" ||
        result.adapterCode === "adapter/degraded";
      outcome = unavailable
        ? failureOutcome(call.callId, provenance, unavailableError(result.message))
        : failureOutcome(call.callId, provenance, executionFailedError(result.message));
    } else if (result.outcome === "timeout") {
      outcome = timeoutOutcome(call.callId, provenance, result.deadline);
    } else if (result.outcome === "cancelled") {
      outcome = cancelledOutcome(call.callId, provenance, result.reason);
    } else if (deadline !== undefined && result.finishedAt > deadline.atEpochMs) {
      // Stale-result rule: a result stamped after the deadline never wins.
      outcome = timeoutOutcome(call.callId, provenance, deadline);
    } else {
      outcome = await guardOutput(call, registration, result.output, provenance);
    }
    recordCompletion(scope, call, outcome);
    return outcome;
  }

  async function guardOutput(
    call: ToolCallRequest,
    registration: ToolRegistration,
    output: unknown,
    provenance: CallProvenance,
  ): Promise<ToolCallOutcome> {
    if (containsClientClaim(output)) {
      return failureOutcome(
        call.callId,
        provenance,
        executionFailedError("client-claimed outcomes are never trusted; the output tree contained a client claim"),
      );
    }
    const outputViolation = findExchangeViolation(output);
    if (outputViolation !== null) {
      return failureOutcome(call.callId, provenance, executionFailedError(outputViolation.message));
    }
    const missingOutputArtifact = await verifyArtifactRefs(deps.artifactExchange, output);
    if (missingOutputArtifact !== null) {
      return failureOutcome(
        call.callId,
        provenance,
        executionFailedError(`referenced output artifact: ${missingOutputArtifact.message}`),
      );
    }
    const outputShape = deps.shapeCatalog.validate(registration.descriptor.outputShape, output);
    if (outputShape.outcome === "rejected") {
      return failureOutcome(call.callId, provenance, invalidOutputError(outputShape.issues));
    }
    return okOutcome(call.callId, provenance, output);
  }

  function recordCompletion(scope: string | null, call: ToolCallRequest, outcome: ToolCallOutcome): void {
    if (scope === null) {
      return;
    }
    if (!completed.has(scope)) {
      completed.set(scope, Object.freeze({ scope, fingerprint: inputFingerprint(call.input), outcome }));
    }
  }

  function replayOutcome(call: ToolCallRequest, entry: LedgerEntry): ToolCallOutcome {
    const fingerprint = inputFingerprint(call.input);
    if (entry.fingerprint !== null && fingerprint !== null && fingerprint !== entry.fingerprint) {
      return failureOutcome(
        call.callId,
        entry.outcome.provenance,
        mismatchError("the idempotency key was first completed with a different input (inputFingerprint mismatch)"),
      );
    }
    return entry.outcome;
  }

  return Object.freeze({ invoke, ledgerSnapshot, ledgerLookup, ledgerRehydrate });
}

async function verifyArtifactRefs(exchange: ArtifactExchangePort, value: unknown): Promise<InputIssue | null> {
  const refs = collectArtifactRefs(value);
  for (const located of refs) {
    const resolution = await exchange.resolve(located.ref);
    if (resolution.outcome === "missing" || resolution.outcome === "corrupt") {
      const detail = resolution.outcome === "missing" ? "not found in the exchange" : `corrupt: ${resolution.reason}`;
      return { path: located.path, message: `artifact ${located.ref.digest} ${detail}` };
    }
  }
  return null;
}

function effectiveDeadline(
  call: ToolCallRequest,
  defaultTimeoutMs: number | undefined,
  clock: ClockPort,
): Deadline | undefined {
  if (call.deadline !== undefined) {
    return call.deadline;
  }
  if (defaultTimeoutMs !== undefined) {
    return deadlineFromTimeoutMs(defaultTimeoutMs, clock.now());
  }
  return undefined;
}

function rawCallId(request: unknown): string {
  if (typeof request === "object" && request !== null) {
    const callId = (request as Record<string, unknown>)["callId"];
    if (typeof callId === "string" && callId.length > 0 && callId.length <= 128) {
      return callId;
    }
  }
  return UNVALIDATED_CALL_ID;
}
function invalidRequestError(message: string): ToolCallError {
  return Object.freeze({ code: "tool/invalid-request", message });
}
function unavailableError(message: string): ToolCallError {
  return Object.freeze({ code: "tool/unavailable", message });
}
function invalidInputError(issues: readonly InputIssue[], path: string): ToolCallError {
  return Object.freeze({ code: "tool/invalid-input", message: `${path} failed fabric validation`, issues: Object.freeze([...issues]) });
}
function invalidOutputError(issues: readonly InputIssue[]): ToolCallError {
  return Object.freeze({ code: "tool/execution-failed", message: "output failed manifest validation", issues: Object.freeze([...issues]) });
}
function executionFailedError(message: string): ToolCallError {
  return Object.freeze({ code: "tool/execution-failed", message });
}
function mismatchError(message: string): ToolCallError {
  return Object.freeze({ code: "tool/idempotency-input-mismatch", message });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
