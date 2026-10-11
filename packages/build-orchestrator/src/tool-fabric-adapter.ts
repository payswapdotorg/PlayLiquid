/**
 * THE TOOL FABRIC ADAPTER — the production wiring of {@link ToolFabricPort}
 * over the Tool Fabric runtime (PL-019, `@playliquid/tool-fabric-runtime`).
 * Build stage steps execute as provider-neutral tool operations through
 * the runtime's invocation pipeline — never around it (E2: the pipeline
 * owns ordered deterministic checks, capability mediation, the shape
 * guard, the exchange guard and the idempotency ledger).
 *
 * The orchestrator speaks build-contracts' `ToolOperationId` seam
 * vocabulary (provider-neutral operation ids, no engine names — lock
 * rules 20/21); the fabric speaks tool identities + surface versions.
 * The BINDING table (operation → tool identity + the surface version the
 * consumer was built against) is host wiring, validated here only
 * structurally. Availability is OBSERVABLE and truthful (E11): an
 * operation is available exactly when its bound tool is currently
 * registered behind the fabric, so a missing toolchain is a recordable
 * limitation, never a silent failure.
 */

import type { ToolOperationId } from "@playliquid/build-contracts";
import type { SurfaceVersion, ToolIdentity } from "@playliquid/tool-fabric";
import type { ToolFabricRuntime } from "@playliquid/tool-fabric-runtime";
import type { BuildToolResult, ToolFabricPort } from "./ports.ts";
import type { BuildToolCall } from "./ports.ts";

/** One operation → tool binding (host wiring; surface version as consumed). */
export interface FabricToolBinding {
  /** The provider-neutral operation id the build toolchain cites. */
  readonly operation: ToolOperationId;
  /** The registered tool that serves the operation. */
  readonly tool: ToolIdentity;
  /** The surface version the consumer was built against (mediated by the pipeline). */
  readonly surfaceVersion: SurfaceVersion;
}

/** Options of {@link createToolFabricAdapter}. */
export interface ToolFabricAdapterOptions {
  /** The Tool Fabric runtime (PL-019 facade). */
  readonly runtime: ToolFabricRuntime;
  /** The host's operation bindings (first binding per operation wins). */
  readonly bindings: readonly FabricToolBinding[];
}

function sameIdentity(a: ToolIdentity, b: ToolIdentity): boolean {
  return a.namespace === b.namespace && a.name === b.name;
}

function sameSurface(a: SurfaceVersion, b: SurfaceVersion): boolean {
  return a.major === b.major && a.minor === b.minor;
}

/**
 * Wires the Tool Fabric runtime seam. Total and fail-closed: every
 * refusal of the runtime is a typed `failed` result — the adapter never
 * throws and never fabricates an ok.
 */
export function createToolFabricAdapter(options: ToolFabricAdapterOptions): ToolFabricPort {
  const runtime = options.runtime;
  const byOperation = new Map<string, FabricToolBinding>();
  for (const binding of options.bindings) {
    if (!byOperation.has(binding.operation)) {
      byOperation.set(binding.operation, binding);
    }
  }

  function registrationOf(binding: FabricToolBinding) {
    return runtime.listTools().find(
      (registration) =>
        sameIdentity(registration.descriptor.identity, binding.tool) &&
        sameSurface(registration.descriptor.surfaceVersion, binding.surfaceVersion),
    );
  }

  return {
    availableOperations(): readonly ToolOperationId[] {
      const available: ToolOperationId[] = [];
      for (const binding of byOperation.values()) {
        if (registrationOf(binding) !== undefined) {
          available.push(binding.operation);
        }
      }
      return available;
    },

    async invokeBuildTool(call: BuildToolCall): Promise<BuildToolResult> {
      const binding = byOperation.get(call.operation);
      if (binding === undefined) {
        return {
          outcome: "failed",
          code: "operation-not-bound",
          message: `tool operation "${call.operation}" has no binding to a registered fabric tool (host wiring gap, E11)`,
        };
      }
      if (registrationOf(binding) === undefined) {
        return {
          outcome: "failed",
          code: "tool-not-registered",
          message: `tool ${binding.tool.namespace}.${binding.tool.name} (surface ${binding.surfaceVersion.major}.${binding.surfaceVersion.minor}) is not registered behind the Tool Fabric (E11)`,
        };
      }
      let outcome: Awaited<ReturnType<ToolFabricRuntime["invokeToolCall"]>>;
      try {
        outcome = await runtime.invokeToolCall({
          kind: "tool-call-request",
          callId: call.callId,
          tool: binding.tool,
          surfaceVersion: binding.surfaceVersion,
          input: call.input,
          requiredCapabilities: [],
          idempotencyKey: call.idempotencyKey,
        });
      } catch (error) {
        return {
          outcome: "failed",
          code: "fabric-error",
          message: `the Tool Fabric runtime threw invoking "${call.operation}" (${call.callId}): ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      switch (outcome.outcome) {
        case "ok":
          return { outcome: "ok", output: outcome.output };
        case "failure":
          return { outcome: "failed", code: outcome.error.code, message: outcome.error.message };
        case "timeout":
          return {
            outcome: "failed",
            code: "tool-call/timeout",
            message: `tool call ${call.callId} exceeded its deadline of ${outcome.deadline.atEpochMs}`,
          };
        case "cancelled":
          return {
            outcome: "failed",
            code: "tool-call/cancelled",
            message: `tool call ${call.callId} was cancelled (${outcome.cancellation.reason})`,
          };
      }
    },
  };
}
