/**
 * FORGE — the staged build stage (PL-038).
 *
 * The engine build runs through the REAL build-orchestrator (PL-020):
 * tenant-scoped intake over build-contracts' admission oracle (E1), the
 * E10 phase-arc pipeline (resolve → plan → emit → verify → package →
 * succeeded) with the R19 provenance/licensing closure gate, and the
 * append-only build event log. The registry seam is the REAL
 * registry-adapter over the package-registry/package-system authorities;
 * the fabric seam is this example's honest host wiring: each provider-
 * neutral tool operation binds to a registered engine tool and every
 * invocation dispatches through the REAL Tool Fabric runtime pipeline to
 * the REAL engine.unreal adapter (build.cook / editor.script /
 * editor.action — the artifact-ref-free build capabilities; the fake
 * bridges never upload bytes, so build.package's minted reference cannot
 * resolve through the exchange — documented and exercised as the E11
 * seam in the negative battery).
 *
 * The port translates each authoritative engine result into the
 * build-contract vocabulary: receipt bytes into the REAL CAS (E7) and
 * the passing script receipt into evaluation-suite verification evidence.
 * Nothing is fabricated: the receipts ARE the engine's own outputs.
 */

import { computeDigest } from "../../../packages/package-system/src/index.ts";
import type { ContentDigest, PackageLock } from "../../../packages/package-system/src/index.ts";
import { asBuildId, asBuildNonce, asBuildTargetId, asProfileInputId, asRequesterId, asToolchainProfileId, asToolOperationId, buildInputDigests, validateBuildInputs } from "../../../packages/build-contracts/src/index.ts";
import type { BuildId, BuildInputs, BuildRequestCommand, EngineBindingRef, ToolOperationId } from "../../../packages/build-contracts/src/index.ts";
import { BuildOrchestratorService, asTenantId, createMemoryBuildStore, createRegistryBuildSource } from "../../../packages/build-orchestrator/src/index.ts";
import type { BuildEvent, BuildToolCall, BuildToolResult, EnvironmentLimitation, ToolFabricPort } from "../../../packages/build-orchestrator/src/index.ts";
import { toBuildContractsEngineBindingRef, UNREAL_PAYLOAD_VERSION } from "../../../packages/engine-unreal/src/index.ts";
import type { UnrealEngineBinding } from "../../../packages/engine-unreal/src/index.ts";
import type { ArtifactStore } from "../../../packages/artifact-store/src/index.ts";
import type { PackageRegistry } from "../../../packages/package-registry/src/index.ts";
import type { ToolFabricRuntime } from "../../../packages/tool-fabric-runtime/src/index.ts";
import type { ToolCallOutcome } from "../../../packages/tool-fabric/src/index.ts";
import { FORGE_TENANT, RECEIPT_MEDIA_TYPE, TOOLCHAIN_OPERATIONS, TOOL_SURFACE, UNREAL_PROJECT } from "./ids.ts";
import { capabilityTool, type WorkflowClock } from "./rig.ts";

/** The tenant id type the engine adapters bind (platform-contracts brand). */
type EngineTenantId = typeof FORGE_TENANT;

/** A typed build-stage refusal (the orchestrator's own codes, surfaced). */
export interface BuildRefusal {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

/** The canonical staged-build result (E9 digests + the E10 event log). */
export interface BuildOutcome {
  readonly ok: true;
  readonly buildId: BuildId;
  readonly classification: "first" | "duplicate";
  readonly manifestDigest: ContentDigest;
  readonly artifacts: readonly { readonly digest: ContentDigest; readonly sizeBytes: number; readonly mediaType: string }[];
  readonly events: readonly BuildEvent[];
  readonly limitations: readonly EnvironmentLimitation[];
}

/** The pinned inputs of the forge build. */
export interface ForgeBuildPins {
  readonly gameIrDigest: ContentDigest;
  readonly lock: PackageLock;
  readonly lockFingerprint: ContentDigest;
  readonly profileDigest: ContentDigest;
  readonly profileTarget: "windows" | "web";
  readonly binding: UnrealEngineBinding;
}

/** The toolchain profile content digest (derived; E9). */
export function forgeToolchainDigest(): ContentDigest {
  return computeDigest({ toolchain: "forge-unreal", operations: [...TOOLCHAIN_OPERATIONS] });
}

/** Composes and validates the BuildInputs (typed refusal on violations). */
export function composeForgeBuildInputs(pins: ForgeBuildPins): { readonly ok: true; readonly inputs: BuildInputs } | BuildRefusal {
  const engineBinding: EngineBindingRef = toBuildContractsEngineBindingRef(pins.binding);
  const inputs: BuildInputs = {
    gameIr: { digest: pins.gameIrDigest },
    packageLock: { lockFingerprint: pins.lockFingerprint, pinnedPackageCount: pins.lock.packages.length },
    targetProfile: {
      profileId: asProfileInputId(`forge-${pins.profileTarget}`)!,
      profileDigest: pins.profileDigest,
      target: asBuildTargetId(pins.profileTarget),
      vendorGate: { kind: "none" },
    },
    engineBinding,
    toolchain: {
      profileId: asToolchainProfileId("forge-unreal-toolchain")!,
      profileDigest: forgeToolchainDigest(),
      citesToolOperations: TOOLCHAIN_OPERATIONS.map((operation) => asToolOperationId(operation)),
    },
  };
  const validation = validateBuildInputs(inputs);
  if (!validation.ok) {
    return { ok: false, code: "invalid-inputs", message: validation.reasons.map((reason) => `${reason.code}: ${reason.message}`).join("; ") };
  }
  return { ok: true, inputs };
}

/** The content digests the build source must be able to resolve at intake. */
export function forgeKnownContent(inputs: BuildInputs): ReadonlySet<ContentDigest> {
  return new Set(buildInputDigests(inputs).map((entry) => entry.digest));
}

/** The canonical bytes of one authoritative engine result (the receipt). */
function receiptBytes(output: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(output));
}

/** The 64-hex digest of the fixed validation script content (E9: derived). */
export function validationScriptDigest(): string {
  return computeDigest({ script: "forge-validate", checks: ["input-set", "target-profile", "engine-binding"] }).slice("sha256:".length);
}

/** One operation → engine-capability binding (host wiring, E11-labeled). */
interface OperationBinding {
  readonly capability: string;
  readonly payload: (tenant: EngineTenantId, target: string) => Record<string, unknown>;
  readonly translate: (output: unknown, cas: ArtifactStore) => Record<string, unknown>;
}

const OPERATION_BINDINGS: Readonly<Record<string, OperationBinding>> = Object.freeze({
  cook: {
    capability: "build.cook",
    payload: (tenant, target) => ({ version: UNREAL_PAYLOAD_VERSION, tenant: String(tenant), target: UNREAL_PROJECT, targetPlatform: target, configuration: "shipping" }),
    translate: (output, cas) => {
      const stored = cas.store(receiptBytes(output), { mediaType: RECEIPT_MEDIA_TYPE });
      if (!stored.ok) throw new Error(`build port CAS refusal: ${stored.message}`);
      return { artifacts: [{ artifactKind: "engine.cook-receipt", digest: stored.manifest.digest, sizeBytes: stored.manifest.sizeBytes, mediaType: RECEIPT_MEDIA_TYPE }] };
    },
  },
  validate: {
    capability: "editor.script",
    payload: (tenant) => ({ version: UNREAL_PAYLOAD_VERSION, tenant: String(tenant), target: UNREAL_PROJECT, scriptDigest: validationScriptDigest() }),
    translate: (output) => {
      const script = output as { readonly exitCode?: number; readonly scriptDigest?: string };
      if (script.exitCode !== 0) {
        throw new Error(`the engine validation script did not pass (exit ${String(script.exitCode)})`);
      }
      return {
        evidence: [
          {
            kind: "evaluation-suite",
            verdict: "pass",
            suite: { suiteId: "forge-engine-validate-script", suiteDigest: `sha256:${String(script.scriptDigest)}` },
            evidenceDigest: computeDigest(output),
          },
        ],
      };
    },
  },
  package: {
    capability: "editor.action",
    payload: (tenant) => ({ version: UNREAL_PAYLOAD_VERSION, tenant: String(tenant), target: UNREAL_PROJECT, action: "package-project" }),
    translate: (output, cas) => {
      const stored = cas.store(receiptBytes(output), { mediaType: RECEIPT_MEDIA_TYPE });
      if (!stored.ok) throw new Error(`build port CAS refusal: ${stored.message}`);
      return { artifacts: [{ artifactKind: "engine.package-receipt", digest: stored.manifest.digest, sizeBytes: stored.manifest.sizeBytes, mediaType: RECEIPT_MEDIA_TYPE }] };
    },
  },
});

/** Describes a non-ok fabric outcome (typed union, no casts). */
function describeFabricRefusal(outcome: Exclude<ToolCallOutcome, { readonly outcome: "ok" }>): { readonly code: string; readonly message: string } {
  if (outcome.outcome === "failure") {
    return { code: outcome.error.code, message: outcome.error.message };
  }
  if (outcome.outcome === "timeout") {
    return { code: "tool-call/timeout", message: `the deadline ${String(outcome.deadline.atEpochMs)} passed` };
  }
  return { code: "tool-call/cancelled", message: String(outcome.cancellation.reason) };
}

/**
 * The build fabric port: the ToolFabricPort host wiring that binds each
 * cited operation to its registered engine tool and dispatches through
 * the REAL runtime pipeline. Total; every runtime refusal is a typed
 * failure — never a throw, never a fabricated ok.
 */
export function createForgeBuildFabric(runtime: ToolFabricRuntime, cas: ArtifactStore, tenant: EngineTenantId, target: string): ToolFabricPort {
  return {
    availableOperations(): readonly ToolOperationId[] {
      return Object.keys(OPERATION_BINDINGS).map((operation) => asToolOperationId(operation));
    },
    async invokeBuildTool(call: BuildToolCall): Promise<BuildToolResult> {
      const binding = OPERATION_BINDINGS[call.operation];
      if (binding === undefined) {
        return { outcome: "failed", code: "operation-not-bound", message: `tool operation "${call.operation}" has no engine binding (host wiring gap, E11)` };
      }
      const outcome = await runtime.invokeToolCall({
        kind: "tool-call-request",
        callId: call.callId,
        tool: capabilityTool(binding.capability, "engine.unreal"),
        surfaceVersion: { ...TOOL_SURFACE },
        input: binding.payload(tenant, target),
        requiredCapabilities: [],
        idempotencyKey: call.idempotencyKey,
      });
      if (outcome.outcome !== "ok") {
        const refusal = describeFabricRefusal(outcome);
        return { outcome: "failed", code: refusal.code, message: refusal.message };
      }
      try {
        return { outcome: "ok", output: binding.translate(outcome.output, cas) };
      } catch (error) {
        return { outcome: "failed", code: "port-translation-failed", message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/** Options of {@link createForgeBuildOrchestrator}. */
export interface ForgeBuildOrchestratorOptions {
  readonly registry: PackageRegistry;
  readonly cas: ArtifactStore;
  readonly runtime: ToolFabricRuntime;
  readonly inputs: BuildInputs;
  readonly lock: PackageLock;
  readonly lockFingerprint: ContentDigest;
  readonly clock: WorkflowClock;
}

/** The typed build request command of one forge build identity (pure). */
export function forgeBuildCommand(inputs: BuildInputs, identity: { readonly requester: string; readonly nonce: string; readonly requestedAt: number }): BuildRequestCommand {
  return {
    kind: "request-build",
    idempotency: { scope: "build-request", requester: asRequesterId(identity.requester), nonce: asBuildNonce(identity.nonce) },
    inputs,
    parameters: { kind: "record", fields: { workflow: { kind: "string", value: "forge-engine-workflow-1" } } },
    requestedAt: identity.requestedAt,
  };
}

/**
 * Creates the build orchestrator over the REAL authorities: the registry
 * build source (locks + known content), the engine fabric port and the
 * injected clock. The SAME instance answers idempotent duplicate requests
 * with the recorded receipt (E6/E10).
 */
export function createForgeBuildOrchestrator(options: ForgeBuildOrchestratorOptions): BuildOrchestratorService {
  const { registry, cas, runtime, inputs, lock, lockFingerprint, clock } = options;
  return new BuildOrchestratorService({
    sources: createRegistryBuildSource({
      registry,
      locks: new Map([[lockFingerprint, lock]]),
      knownContent: forgeKnownContent(inputs),
    }),
    fabric: createForgeBuildFabric(runtime, cas, FORGE_TENANT, String(inputs.targetProfile.target)),
    clock: { now: () => clock.now() },
    store: createMemoryBuildStore(),
  });
}

/** Runs one staged build over a wired orchestrator: intake → arcs → status. Deterministic (E9). */
export async function runForgeBuild(options: {
  readonly orchestrator: BuildOrchestratorService;
  readonly inputs: BuildInputs;
  readonly identity: { readonly requester: string; readonly nonce: string; readonly requestedAt: number };
}): Promise<BuildOutcome | BuildRefusal> {
  const { orchestrator, inputs, identity } = options;
  const tenant = asTenantId(String(FORGE_TENANT));
  const request = forgeBuildCommand(inputs, identity);
  const intake = orchestrator.requestBuild(tenant, request);
  if (!intake.ok) {
    return { ok: false, code: intake.code, message: intake.message };
  }
  for (let arc = 0; arc < 12; arc += 1) {
    const step = await orchestrator.drive(tenant, intake.buildId);
    if (!step.ok) {
      if (step.code === "build-terminal") break;
      return { ok: false, code: step.code, message: step.message };
    }
    if (step.terminal) break;
  }
  const status = orchestrator.status(tenant, intake.buildId);
  if (!status.ok) {
    return { ok: false, code: status.code, message: status.message };
  }
  if (status.phase !== "succeeded" || status.outputs === undefined || status.manifestDigest === undefined) {
    return {
      ok: false,
      code: status.failure?.code ?? "build-incomplete",
      message: status.failure?.message ?? `the build ended in phase ${status.phase} without outputs`,
    };
  }
  const events = orchestrator.events(tenant, intake.buildId);
  return {
    ok: true,
    buildId: asBuildId(status.buildId),
    classification: intake.classification,
    manifestDigest: status.manifestDigest,
    artifacts: status.outputs.artifacts.map((artifact) => ({
      digest: artifact.bytes.digest,
      sizeBytes: artifact.bytes.sizeBytes,
      mediaType: artifact.bytes.mediaType,
    })),
    events: events.ok ? events.events : [],
    limitations: orchestrator.limitations(tenant),
  };
}
