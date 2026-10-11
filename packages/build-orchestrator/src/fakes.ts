/**
 * Deterministic in-memory fakes for the build orchestrator's ports (the
 * platform-economy / tool-fabric-runtime test-double pattern). Every fake
 * is clearly a FAKE and never presented as a production integration
 * (AGENTS: "no mock presented as real production integration").
 *
 * - {@link ManualClock}          — ServiceClock double the test advances;
 * - {@link MemoryBuildStore}     — BuildStore double (process memory is
 *   NOT durable across restarts — a truthful E11 limitation of the double,
 *   never of the design: the port accepts a real durable store);
 * - {@link FakeBuildSource}      — BuildSourcePort double over a lock
 *   table + package records, resolving closures with package-system's
 *   REAL `resolve` (the resolution authority is never faked);
 * - {@link FakeToolFabric}       — ToolFabricPort double with observable
 *   operations, failure injection and deterministic artifact/evidence
 *   outputs (every digest derived through computeDigest, never
 *   hand-written).
 */

import { computeDigest, resolve } from "@playliquid/package-system";
import type { ContentDigest, PackageLock, PackageRecord, ResolutionResult } from "@playliquid/package-system";
import type { ToolOperationId, VerificationEvidence } from "@playliquid/build-contracts";
import type { BuildStore, BuildSourcePort, BuildToolCall, BuildToolResult, ServiceClock, ToolFabricPort } from "./ports.ts";
import type { BuildEvent } from "./events.ts";

/** A manually-advanced ServiceClock double (deterministic timestamps). */
export interface ManualClock {
  readonly clock: ServiceClock;
  /** The current reading. */
  now(): number;
  /** Advances the clock by `ms` and returns the new reading. */
  advance(ms: number): number;
}

/** Creates a fixed clock the test can advance by hand (E3: no wall clock). */
export function createManualClock(start = 1_000): ManualClock {
  let current = start;
  return {
    clock: { now: () => current },
    now: () => current,
    advance: (ms: number): number => {
      current += ms;
      return current;
    },
  };
}

/** In-memory BuildStore double (TEST DOUBLE; process memory is not durable — E11). */
export interface MemoryBuildStore extends BuildStore {
  /** Every appended event, in append order. */
  readonly appended: readonly BuildEvent[];
}

/** Creates an in-memory event store (TEST DOUBLE; not durable). */
export function createMemoryBuildStore(): MemoryBuildStore {
  const events: BuildEvent[] = [];
  return {
    appendEvents: (batch: readonly BuildEvent[]): void => {
      events.push(...batch);
    },
    loadEvents: (): readonly BuildEvent[] => events.slice(),
    get appended(): readonly BuildEvent[] {
      return events.slice();
    },
  };
}

/** Options of {@link createFakeBuildSource}. */
export interface FakeBuildSourceOptions {
  /** Lock table: fingerprint → lock (defaults empty). */
  readonly locks?: ReadonlyMap<ContentDigest, PackageLock>;
  /** Package records closures resolve against (package-system `resolve`, never faked). */
  readonly records?: readonly PackageRecord[];
  /** Extra content the fake can resolve (game-ir blobs, profiles, …). */
  readonly resolvableContent?: ReadonlySet<ContentDigest>;
}

/**
 * BuildSourcePort double: a lock table plus a record set, resolving
 * closures through package-system's REAL `resolve` (typed failures are
 * the authority's own codes, never fabricated here).
 */
export function createFakeBuildSource(options: FakeBuildSourceOptions = {}): BuildSourcePort & { readonly records: readonly PackageRecord[] } {
  const locks = options.locks ?? new Map<ContentDigest, PackageLock>();
  const records = [...(options.records ?? [])];
  const extra = options.resolvableContent ?? new Set<ContentDigest>();
  const recordDigests = new Set<ContentDigest>(records.map((record) => record.identity.contentDigest));
  return {
    records,
    canResolve: (digest: ContentDigest): boolean => locks.has(digest) || recordDigests.has(digest) || extra.has(digest),
    loadLock: (fingerprint: ContentDigest): PackageLock | null => locks.get(fingerprint) ?? null,
    resolveClosure: (lock: PackageLock): ResolutionResult => resolve(lock, { records }),
  };
}

/** One scripted tool failure (failure-injection hook). */
export interface ScriptedFailure {
  readonly code: string;
  readonly message: string;
}

/** ToolFabricPort double with observable, mutable operation availability. */
export interface FakeToolFabric extends ToolFabricPort {
  /** Registers operations as available (E11 observation hook). */
  registerOperations(...operations: readonly ToolOperationId[]): void;
  /** Drops operations from the available set (E11 gap tests). */
  dropOperations(...operations: readonly ToolOperationId[]): void;
  /** Fails every invocation of `operation` until cleared (persistent fault). */
  failOperation(operation: ToolOperationId, failure: ScriptedFailure): void;
  /** Clears a persistent fault. */
  clearOperationFailure(operation: ToolOperationId): void;
  /** Scripts the RAW ok-output of the next invocation (malformed-output tests). */
  scriptNextOutput(output: unknown): void;
  /** Every call received, in order. */
  readonly calls: readonly BuildToolCall[];
}

/**
 * ToolFabricPort double. Deterministic outputs: package-stage steps emit
 * content-addressed artifacts (digests derived from the call), verify
 * steps emit a passing evaluation-suite record; every other step returns
 * an empty ok. Failures are scripted, never random.
 */
export function createFakeToolFabric(options: { readonly operations?: readonly ToolOperationId[] } = {}): FakeToolFabric {
  const available = new Set<ToolOperationId>(options.operations ?? []);
  const persistentFailures = new Map<string, ScriptedFailure>();
  const calls: BuildToolCall[] = [];
  let scriptedOutput: unknown;
  let scriptedOutputArmed = false;

  function outputFor(call: BuildToolCall): BuildToolResult {
    const artifacts: Array<{ artifactKind: string; digest: ContentDigest; sizeBytes: number; mediaType: string }> = [];
    const evidence: VerificationEvidence[] = [];
    if (call.stage === "package" || call.stage === "emit") {
      artifacts.push({
        artifactKind: "game.bundle",
        digest: computeDigest({ call: call.callId, artifact: 0 }),
        sizeBytes: 1_048_576,
        mediaType: "application/octet-stream",
      });
    }
    if (call.stage === "verify") {
      evidence.push({
        kind: "evaluation-suite",
        verdict: "pass",
        suite: { suiteId: "suite-smoke", suiteDigest: computeDigest({ suite: call.callId }) },
        evidenceDigest: computeDigest({ evidence: call.callId }),
      });
    }
    return { outcome: "ok", output: { artifacts, evidence } };
  }

  return {
    availableOperations: (): readonly ToolOperationId[] => [...available],
    registerOperations: (...operations: readonly ToolOperationId[]): void => {
      for (const operation of operations) {
        available.add(operation);
      }
    },
    dropOperations: (...operations: readonly ToolOperationId[]): void => {
      for (const operation of operations) {
        available.delete(operation);
      }
    },
    failOperation: (operation: ToolOperationId, failure: ScriptedFailure): void => {
      persistentFailures.set(operation, failure);
    },
    clearOperationFailure: (operation: ToolOperationId): void => {
      persistentFailures.delete(operation);
    },
    scriptNextOutput: (output: unknown): void => {
      scriptedOutput = output;
      scriptedOutputArmed = true;
    },
    get calls(): readonly BuildToolCall[] {
      return calls.slice();
    },
    async invokeBuildTool(call: BuildToolCall): Promise<BuildToolResult> {
      calls.push(call);
      const failure = persistentFailures.get(call.operation);
      if (failure !== undefined) {
        return { outcome: "failed", code: failure.code, message: failure.message };
      }
      if (scriptedOutputArmed) {
        scriptedOutputArmed = false;
        return { outcome: "ok", output: scriptedOutput };
      }
      return outputFor(call);
    },
  };
}
