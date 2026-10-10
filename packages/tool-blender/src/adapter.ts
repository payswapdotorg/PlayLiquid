/**
 * Module role: the Blender tool adapter — a `tool.blender` adapter
 * implementing the NEUTRAL Adapter interface from
 * @playliquid/engine-adapter-contract (PL-005). This is the single place
 * where Blender-specific behavior exists (E4); everything above it is
 * the neutral Tool Fabric seam (PL-019 registration; R13).
 *
 * Dispatch pipeline (order matters, mirroring the contract's
 * fake-adapter.test.ts conventions):
 *   1. neutral shape validation (validateAdapterCommandDispatch) →
 *      typed "adapter/invalid-dispatch" refusal (closed code union);
 *   2. client-claim scan over the dispatch payload → typed
 *      "blender/client-claim" error (client-claimed outcomes are NEVER
 *      trusted; the adapter surfaces its own typed codes through the
 *      contract's adapter-defined FAILED channel, which is exactly the
 *      open error-code channel the neutral exchange provides);
 *   3. lifecycle state check → "adapter/not-ready" | "adapter/degraded" |
 *      "adapter/closed" typed refusals (transitions only through
 *      advanceLifecycle; never direct state writes);
 *   4. capability mediation (mediateAdapterCapability) → typed
 *      "adapter-capability/not-declared" refusal;
 *   5. tenant claim check (R20) → typed "blender-tenancy/*" error;
 *   6. deadline expiry (clock port; E9) → typed "blender/deadline-expired";
 *   7. payload validation (validateBlenderCommandPayload) → typed
 *      "blender/invalid-payload" error;
 *   8. duplicate command id discipline → identical content returns the
 *      recorded result (E10); same id different content → typed
 *      "blender/command-id-conflict" error;
 *   9. bridge invocation through BlenderBridgePort (pure seam) →
 *      ok / failed (typed error codes);
 *  10. authoritative result stamped with AdapterAuthority (adapter id +
 *      clock reading); every dispatch/outcome pair recorded in the
 *      append-only evidence ledger (E10).
 *
 * Implements: PL-025 (whole adapter).
 */

import {
  adapterAuthority,
  advanceLifecycle,
  containsClientClaim,
  failedCommandResult,
  mediateAdapterCapability,
  okCommandResult,
  refusedCommandResult,
  validateAdapterCommandDispatch,
  type Adapter,
  type AdapterAuthority,
  type AdapterCommandDispatch,
  type AdapterCommandResult,
  type AdapterCapabilityId,
  type AdapterId,
  type AdapterLifecycleState,
  type LifecycleTransitionCheck,
} from "@playliquid/engine-adapter-contract";
import type { TenantId } from "@playliquid/platform-contracts";

import {
  BLENDER_ADAPTER_ID,
  BLENDER_ADAPTER_LABEL,
  BLENDER_OFFERED_CAPABILITIES,
  type BlenderCommandPayload,
} from "./payload-model.ts";
import { validateBlenderCommandPayload } from "./payload-validate.ts";
import type { BlenderBridgeInvocation, BlenderBridgePort, BlenderClockPort } from "./bridge-port.ts";
import { blenderCommandKey } from "./command-id.ts";
import {
  createBlenderEvidenceLedger,
  type BlenderEvidenceAppender,
  type BlenderEvidenceLedger,
} from "./evidence.ts";
import { checkBlenderTenancy } from "./tenancy.ts";
import { contentDigestOf } from "./digest.ts";

export interface BlenderAdapterOptions {
  /** The single tenant this adapter instance serves (R20). */
  readonly tenant: TenantId;
  /** The pure bridge seam; the in-memory fake is the test host (E11). */
  readonly bridge: BlenderBridgePort;
  /** Deterministic time source for authority stamps + deadline checks (E9). */
  readonly clock: BlenderClockPort;
  /** Adapter id override (defaults to tool.blender); neutral id grammar. */
  readonly adapterId?: AdapterId;
}

/** The adapter plus Blender-specific read surfaces (evidence, tenancy). */
export interface BlenderAdapter extends Adapter {
  /** Append-only evidence ledger (E10): every dispatch/outcome pair. */
  readonly evidence: BlenderEvidenceLedger;
  /** The tenant this instance serves (R20). */
  readonly tenant: TenantId;
}

interface RecordedOutcome {
  readonly result: AdapterCommandResult;
  readonly commandKey: string;
}

function describeRejections(rejections: readonly { message: string }[]): string {
  return rejections.map((item) => item.message).join("; ");
}

function payloadRootOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Creates the Blender tool adapter (registration state: "registered"). */
export function createBlenderAdapter(options: BlenderAdapterOptions): BlenderAdapter {
  const adapterId: AdapterId = options.adapterId ?? BLENDER_ADAPTER_ID;
  const tenant: TenantId = options.tenant;
  const bridge: BlenderBridgePort = options.bridge;
  const clock: BlenderClockPort = options.clock;
  const offered: readonly AdapterCapabilityId[] = Object.freeze([...BLENDER_OFFERED_CAPABILITIES]);

  let state: AdapterLifecycleState = "registered";
  const evidence: BlenderEvidenceAppender = createBlenderEvidenceLedger();
  const executed = new Map<string, RecordedOutcome>();

  function stamp(): AdapterAuthority {
    return adapterAuthority(adapterId, clock());
  }

  function applyTransition(requested: AdapterLifecycleState): LifecycleTransitionCheck {
    const check = advanceLifecycle(state, requested);
    if (check.outcome === "ok") {
      state = check.next;
    }
    return check;
  }

  /** Records one dispatch/outcome pair in the append-only ledger (E10). */
  function record(
    commandId: string,
    capability: string,
    payloadDigest: string,
    result: AdapterCommandResult,
    commandKey?: string,
  ): void {
    const refusalCode = result.outcome === "refused" ? result.refusal.code : undefined;
    const errorCode = result.outcome === "failed" ? result.error.code : undefined;
    evidence.append({
      kind: "blender-exchange-record",
      commandId,
      capability,
      payloadDigest,
      outcome: result.outcome,
      ...(refusalCode === undefined ? {} : { refusalCode }),
      ...(errorCode === undefined ? {} : { errorCode }),
      authorityDigest: contentDigestOf(result.authority),
    });
    if (commandKey !== undefined && (result.outcome === "ok" || result.outcome === "failed")) {
      executed.set(commandId, { result, commandKey });
    }
  }

  async function dispatch(command: AdapterCommandDispatch): Promise<AdapterCommandResult> {
    const authority = stamp();
    const payloadDigest = contentDigestOf(payloadRootOf(command?.payload));

    // 1. Neutral envelope shape (total; typed refusal, closed code union).
    const shape = validateAdapterCommandDispatch(command);
    if (shape.outcome === "rejected") {
      const result = refusedCommandResult(authority, {
        code: "adapter/invalid-dispatch",
        message: `invalid dispatch: ${describeRejections(shape.rejections)}`,
      });
      record(
        typeof command?.commandId === "string" ? command.commandId : "",
        typeof command?.capability === "string" ? command.capability : "",
        payloadDigest,
        result,
      );
      return result;
    }
    const validated = shape.dispatch;

    // 2. Client-claim gate (total check; client-claimed outcomes never trusted).
    if (containsClientClaim(validated.payload)) {
      const result = failedCommandResult(authority, {
        code: "blender/client-claim",
        message: "client-claimed outcomes are never trusted; only adapter-authored results carrying authority are authoritative",
      });
      record(validated.commandId, validated.capability, payloadDigest, result);
      return result;
    }

    // 3. Lifecycle state discipline (typed refusals; no silent dispatch).
    if (state === "closed") {
      const result = refusedCommandResult(authority, { code: "adapter/closed", message: "adapter is closed" });
      record(validated.commandId, validated.capability, payloadDigest, result);
      return result;
    }
    if (state === "registered") {
      const result = refusedCommandResult(authority, { code: "adapter/not-ready", message: "adapter is not ready yet" });
      record(validated.commandId, validated.capability, payloadDigest, result);
      return result;
    }
    if (state === "degraded") {
      const result = refusedCommandResult(authority, { code: "adapter/degraded", message: "adapter is degraded" });
      record(validated.commandId, validated.capability, payloadDigest, result);
      return result;
    }

    // 4. Capability mediation against the fixed registration list.
    const mediation = mediateAdapterCapability(offered, validated.capability);
    if (mediation.outcome === "refused") {
      const result = refusedCommandResult(authority, {
        code: mediation.refusal.code,
        message: mediation.refusal.message,
        capability: mediation.refusal.requested,
      });
      record(validated.commandId, validated.capability, payloadDigest, result);
      return result;
    }

    // 5. Tenant claim (R20): the dispatch must carry the bound tenant.
    const root = payloadRootOf(validated.payload);
    const tenancy = checkBlenderTenancy(tenant, root === null ? undefined : root["tenant"]);
    if (tenancy.outcome === "rejected") {
      const result = failedCommandResult(authority, {
        code: tenancy.rejection.code,
        message: tenancy.rejection.message,
      });
      record(validated.commandId, validated.capability, payloadDigest, result);
      return result;
    }

    // 6. Deadline expiry (deterministic clock port; E9).
    if (validated.deadline !== undefined && clock() > validated.deadline.atEpochMs) {
      const result = failedCommandResult(authority, {
        code: "blender/deadline-expired",
        message: `deadline at ${validated.deadline.atEpochMs}ms already expired at ${clock()}ms`,
      });
      record(validated.commandId, validated.capability, payloadDigest, result);
      return result;
    }

    // 7. Typed payload validation (total; accumulate every problem).
    const payloadCheck = validateBlenderCommandPayload(validated.capability, validated.payload);
    if (payloadCheck.outcome === "rejected") {
      const result = failedCommandResult(authority, {
        code: "blender/invalid-payload",
        message: `invalid payload for ${validated.capability}: ${describeRejections(payloadCheck.rejections)}`,
      });
      record(validated.commandId, validated.capability, payloadDigest, result);
      return result;
    }
    const payload: BlenderCommandPayload = payloadCheck.payload;

    // 8. Duplicate command id discipline (content-addressed).
    const commandKey = blenderCommandKey(validated.capability, payload, validated.deadline?.atEpochMs);
    const prior = executed.get(validated.commandId);
    if (prior !== undefined) {
      if (prior.commandKey === commandKey) {
        // Identical content: return the recorded result (E10 replay).
        const replayed = prior.result;
        record(validated.commandId, validated.capability, payloadDigest, replayed);
        return replayed;
      }
      const conflict = failedCommandResult(authority, {
        code: "blender/command-id-conflict",
        message: `commandId ${validated.commandId} was already used for different content`,
      });
      record(validated.commandId, validated.capability, payloadDigest, conflict);
      return conflict;
    }

    // 9. Bridge invocation (pure seam; real tool execution is a host concern).
    const invocation: BlenderBridgeInvocation = Object.freeze({
      kind: "blender-bridge-invocation",
      commandKey,
      capability: validated.capability,
      payload,
      ...(validated.deadline === undefined ? {} : { deadlineAtEpochMs: validated.deadline.atEpochMs }),
    });
    let result: AdapterCommandResult;
    try {
      const outcome = await bridge.invoke(invocation);
      if (outcome.outcome === "ok") {
        // Re-scan the bridge value for client-claim markers (defense in
        // depth: a compromised bridge must not launder client claims).
        if (containsClientClaim(outcome.value)) {
          result = failedCommandResult(authority, {
            code: "blender/client-claim",
            message: "bridge returned a client-claimed outcome; refusing to treat it as authoritative",
          });
        } else {
          result = okCommandResult(authority, outcome.value);
        }
      } else {
        result = failedCommandResult(authority, {
          code: outcome.error?.code ?? "bridge/command-failed",
          message: outcome.error?.message ?? "bridge command failed",
        });
      }
    } catch (error) {
      result = failedCommandResult(authority, {
        code: "bridge/threw",
        message: `bridge threw: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // 10. Authoritative record (E10 append-only) + idempotency bookkeeping.
    record(validated.commandId, validated.capability, payloadDigest, result, commandKey);
    return result;
  }

  const adapter: BlenderAdapter = {
    id: adapterId,
    label: BLENDER_ADAPTER_LABEL,
    offeredCapabilities: offered,
    get state(): AdapterLifecycleState {
      return state;
    },
    get evidence(): BlenderEvidenceLedger {
      return evidence;
    },
    get tenant(): TenantId {
      return tenant;
    },
    markReady: () => applyTransition("ready"),
    reportDegraded: () => applyTransition("degraded"),
    close: () => applyTransition("closed"),
    dispatch,
  };
  return Object.freeze(adapter);
}
