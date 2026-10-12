/**
 * LATTICE — the chunk-level build seam (PL-039; §Build, §Scalability).
 *
 * "Chunks can be independently ... built when the contract permits"
 * (§World). Each independently-buildable chunk composes its OWN staged
 * build over the REAL build-orchestrator pipeline (intake → resolve →
 * plan → emit → verify → package → succeeded): the build inputs pin the
 * chunk's static content digest (the CAS blob), the world package lock
 * (the full graph resolves), a dedicated-server target profile (headless
 * chunk data) and the GameIR-direct "native" engine binding. Chunks in
 * the core zone are refused with a typed `chunk-not-independently-built`
 * — they cook as one zone unit, never per chunk (E8).
 *
 * Determinism (E9): the same chunk + identity always produce the same
 * build id, manifest digest and event count (content-derived, never
 * random).
 *
 * Environment limitation (stated plainly): the orchestrator runs over
 * its in-memory fakes (build source, tool fabric, store, clock) — the
 * fabric emits deterministic synthetic artifacts, NOT real cooked chunk
 * bundles; no toolchain binaries are downloaded or executed.
 */

import { computeDigest, computeLockFingerprint } from "../../../packages/package-system/src/index.ts";
import type { ContentDigest, PackageLock } from "../../../packages/package-system/src/index.ts";
import { asBuildTargetId, asProfileInputId, asRequesterId, asBuildNonce, asBuildId, asToolOperationId, asToolchainProfileId, buildInputDigests, validateBuildInputs } from "../../../packages/build-contracts/src/index.ts";
import type { BuildId, BuildInputs, BuildRequestCommand, EngineBindingRef, ToolchainProfileRef } from "../../../packages/build-contracts/src/index.ts";
import { BuildOrchestratorService, asTenantId, createFakeBuildSource, createFakeToolFabric, createManualClock, createMemoryBuildStore } from "../../../packages/build-orchestrator/src/index.ts";
import type { TenantId } from "../../../packages/build-orchestrator/src/index.ts";
import type { LatticeComposition } from "./composition.ts";
import { chunkPackageId } from "./world-model.ts";
import type { LatticeWorldModel } from "./world-model.ts";
import { OTHER_TENANT_NAME, TENANT_NAME } from "./ids.ts";

/** The tenant the lattice builds under (R20: the orchestrator's own doors enforce scoping). */
export const LATTICE_TENANT: TenantId = asTenantId(TENANT_NAME)!;
/** A second tenant used ONLY by the negative tenancy test (R20). */
export const OTHER_TENANT: TenantId = asTenantId(OTHER_TENANT_NAME)!;

/** The tool operations a chunk cook cites (provider-neutral ids only). */
const CHUNK_OPERATIONS = ["cook", "validate", "package"] as const;

/** The typed refusal codes of the chunk build seam. */
export type ChunkBuildRefusalCode =
  | "chunk-unknown"
  | "chunk-not-independently-built"
  | "invalid-inputs"
  | "intake-refused"
  | "drive-refused"
  | "build-failed"
  | "unexpected-state";

/** A typed chunk-build refusal. */
export interface ChunkBuildRefusal {
  readonly ok: false;
  readonly code: ChunkBuildRefusalCode;
  readonly message: string;
  readonly source?: string;
}

/** The typed chunk build result (E9 digests, E10 evidence trail). */
export interface ChunkBuildResult {
  readonly ok: true;
  readonly chunkId: string;
  readonly buildId: BuildId;
  readonly classification: "first" | "duplicate";
  readonly phase: string;
  readonly buildManifestDigest: ContentDigest;
  readonly eventCount: number;
  readonly artifactCount: number;
}

/** One chunk build: either a result or a typed refusal. */
export type ChunkBuildOutcome = ChunkBuildResult | ChunkBuildRefusal;

/** The identity of one chunk build request (idempotency key material). */
export interface ChunkBuildIdentity {
  readonly requester: string;
  readonly nonce: string;
  readonly requestedAt: number;
}

/** Composes the BuildInputs of one chunk cook (typed refusal on contract violations). */
export function composeChunkBuildInputs(
  model: LatticeWorldModel,
  lock: PackageLock,
  chunkContentDigest: string,
  chunkId: string,
): { readonly ok: true; readonly inputs: BuildInputs } | ChunkBuildRefusal {
  const chunk = model.byChunkId.get(chunkId);
  if (chunk === undefined) {
    return { ok: false, code: "chunk-unknown", message: `chunk ${chunkId} is not part of the world model` };
  }
  if (!chunk.policy.independentlyBuilt) {
    return {
      ok: false,
      code: "chunk-not-independently-built",
      message: `chunk ${chunkId} declares independentlyBuilt:false (core-zone chunks cook as one zone unit, never per chunk)`,
    };
  }
  const engineBinding: EngineBindingRef = {
    engineId: "native" as never,
    bindingDigest: computeDigest({ engine: "native", surface: "gameir-direct" }),
    supportedTargets: [asBuildTargetId("web"), asBuildTargetId("dedicated-server")],
  };
  const toolchain: ToolchainProfileRef = {
    profileId: asToolchainProfileId("lattice-chunk-toolchain")!,
    profileDigest: computeDigest({ toolchain: "lattice-chunk", operations: [...CHUNK_OPERATIONS] }),
    citesToolOperations: CHUNK_OPERATIONS.map((operation) => asToolOperationId(operation)),
  };
  const inputs: BuildInputs = {
    gameIr: { digest: `sha256:${chunkContentDigest}` as ContentDigest },
    packageLock: { lockFingerprint: computeLockFingerprint(lock), pinnedPackageCount: lock.packages.length },
    targetProfile: {
      profileId: asProfileInputId("lattice-chunk-cook")!,
      profileDigest: computeDigest({ profile: "lattice-chunk-cook", target: "dedicated-server" }),
      target: asBuildTargetId("dedicated-server"),
      vendorGate: { kind: "none" },
    },
    engineBinding,
    toolchain,
  };
  const validation = validateBuildInputs(inputs);
  if (!validation.ok) {
    return { ok: false, code: "invalid-inputs", message: validation.reasons.map((reason) => `${reason.code}: ${reason.message}`).join("; ") };
  }
  return { ok: true, inputs };
}

/** The chunk kitchen: one orchestrator instance + typed drive doors (R20-scoped). */
export interface ChunkKitchen {
  readonly tenant: TenantId;
  /** Drives one chunk build end to end (typed result or refusal). */
  cook(chunkId: string, identity: ChunkBuildIdentity): Promise<ChunkBuildOutcome>;
  /**
   * The orchestrator's raw, tenant-scoped status door — exposed for the
   * R20 negative tests (cross-tenant reads are the orchestrator's own
   * typed refusal, never duplicated here).
   */
  statusAs(tenant: TenantId, buildId: string): { ok: boolean; phase?: string; code?: string; message?: string };
}

/** Creates a chunk kitchen over the composition's published graph (in-memory fakes, E11). */
export function createChunkKitchen(composition: LatticeComposition): ChunkKitchen {
  const graph = composition.graph;
  const lockFingerprint = computeLockFingerprint(graph.lock);

  // Pre-resolve every chunk's build-input digests (deterministic; the
  // source must be able to resolve them at intake time).
  const resolvable = new Set<string>();
  resolvable.add(lockFingerprint);
  for (const chunk of composition.model.chunks) {
    const digest = graph.chunkContentDigests.get(chunk.id);
    if (digest === undefined) continue;
    const composed = composeChunkBuildInputs(composition.model, graph.lock, digest, chunk.id);
    if (!composed.ok) continue;
    for (const entry of buildInputDigests(composed.inputs)) {
      resolvable.add(entry.digest);
    }
  }

  const orchestrator = new BuildOrchestratorService({
    sources: createFakeBuildSource({
      records: graph.records,
      locks: new Map([[lockFingerprint, graph.lock]]),
      resolvableContent: resolvable,
    }),
    fabric: createFakeToolFabric({ operations: CHUNK_OPERATIONS.map((operation) => asToolOperationId(operation)) }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });

  return {
    tenant: LATTICE_TENANT,
    async cook(chunkId, identity) {
      const digest = graph.chunkContentDigests.get(chunkId);
      if (digest === undefined) {
        return { ok: false, code: "chunk-unknown", message: `chunk ${chunkId} is not part of the world graph` };
      }
      const composed = composeChunkBuildInputs(composition.model, graph.lock, digest, chunkId);
      if (!composed.ok) return composed;
      const request: BuildRequestCommand = {
        kind: "request-build",
        idempotency: { scope: "build-request", requester: asRequesterId(identity.requester), nonce: asBuildNonce(identity.nonce) },
        inputs: composed.inputs,
        parameters: { kind: "record", fields: { chunk: { kind: "string", value: chunkId }, package: { kind: "string", value: chunkPackageId(chunkId) } } },
        requestedAt: identity.requestedAt,
      };
      const intake = orchestrator.requestBuild(LATTICE_TENANT, request);
      if (!intake.ok) {
        return { ok: false, code: "intake-refused", source: intake.code, message: `chunk build intake refused: ${intake.code} — ${intake.message}` };
      }
      let lastPhase: string | undefined;
      for (let arc = 0; arc < 12; arc += 1) {
        const step = await orchestrator.drive(LATTICE_TENANT, intake.buildId);
        if (!step.ok) {
          if (step.code === "build-terminal") break;
          return { ok: false, code: "drive-refused", source: step.code, message: `chunk build drive refused: ${step.code} — ${step.message}` };
        }
        lastPhase = step.phase;
        if (step.terminal) break;
      }
      const status = orchestrator.status(LATTICE_TENANT, intake.buildId);
      if (!status.ok) {
        return { ok: false, code: "unexpected-state", message: `chunk build status read refused: ${status.code}` };
      }
      if (status.phase !== "succeeded" || status.outputs === undefined || status.manifestDigest === undefined) {
        const phase = status.phase ?? lastPhase ?? "unknown";
        if (phase === "failed") {
          return { ok: false, code: "build-failed", source: status.failure?.code ?? "unknown", message: `chunk build failed: ${status.failure?.code ?? "unknown"}` };
        }
        return { ok: false, code: "unexpected-state", message: `chunk build is in phase ${phase} without terminal outputs` };
      }
      const events = orchestrator.events(LATTICE_TENANT, intake.buildId);
      return {
        ok: true,
        chunkId,
        buildId: intake.buildId,
        classification: intake.classification,
        phase: status.phase,
        buildManifestDigest: status.manifestDigest,
        eventCount: events.ok ? events.events.length : 0,
        artifactCount: status.artifactCount,
      };
    },
    statusAs(tenant, buildId) {
      const status = orchestrator.status(tenant, asBuildId(buildId));
      if (!status.ok) return { ok: false, code: status.code, message: status.message };
      return { ok: true, phase: status.phase };
    },
  };
}
