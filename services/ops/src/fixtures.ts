/**
 * TEST-SUPPORT FIXTURES (PL-044) — deterministic doubles for the ops
 * service tests (lock rule 44: clearly labeled TEST-SUPPORT, never a
 * production integration — E11).
 *
 * The crash-injection seam lives here: a crashing store save (the process
 * "dies" mid-persist) and a crashing effects invocation (the process
 * "dies" mid-effect). A crash is modeled as THROWING from the port and
 * ABANDONING the runtime instance — accurate because every mutation is
 * persisted through the store port before anything else happens, so the
 * dead instance's in-memory state is irrelevant: the truth is whatever
 * the store durably holds, which is exactly what restore() adopts.
 */

import { parseSemver, sealPackageRecord } from "../../../packages/package-system/src/index.ts";
import type { PackageRecord, PackageMetadata, UnsealedPackageRecord } from "../../../packages/package-system/src/index.ts";
import type { OpsWorkerDocument, WorkerStorePort } from "./worker-ports.ts";
import type { EffectOutcome, WorkerEffectsPort, WorkEffect } from "./worker-ports.ts";

/** A deterministic stepping clock: now(), now()+step, now()+2·step, … */
export function createSteppingClock(startMs: number, stepMs = 1): { now(): number; advance(byMs: number): void } {
  let current = startMs;
  const step = stepMs;
  return {
    now(): number {
      const value = current;
      current += step;
      return value;
    },
    advance(byMs: number): void {
      current += byMs;
    },
  };
}

/** A fixed clock the host sets explicitly (never Date.now). */
export function createFixedClock(startMs: number): { now(): number; set(atMs: number): void } {
  let current = startMs;
  return {
    now(): number {
      return current;
    },
    set(atMs: number): void {
      current = atMs;
    },
  };
}

/** An in-memory worker document store holding the last snapshot (E6 fake). */
export function createMemoryWorkerStore(): WorkerStorePort & { snapshots(): readonly OpsWorkerDocument[] } {
  const saved: OpsWorkerDocument[] = [];
  return {
    save(document: OpsWorkerDocument): void {
      saved.push(document);
    },
    load(): OpsWorkerDocument | undefined {
      return saved[saved.length - 1];
    },
    snapshots(): readonly OpsWorkerDocument[] {
      return Object.freeze([...saved]);
    },
  };
}

/**
 * A crash-injecting store: throws on the Nth save (the process dies
 * mid-persist; the instance is abandoned by the test).
 */
export function crashOnNthSave(inner: WorkerStorePort, nth: number): WorkerStorePort {
  let saves = 0;
  return {
    save(document: OpsWorkerDocument): void {
      saves += 1;
      if (saves === nth) throw new Error(`injected crash: store save #${String(nth)}`);
      inner.save(document);
    },
    load(): OpsWorkerDocument | undefined {
      return inner.load();
    },
  };
}

/**
 * THE EXACTLY-ONCE PROOF EXECUTOR: a deterministic effects port that
 * performs each logical effect (by stable effectKey) exactly once,
 * returns `duplicate: true` for re-invocations (the documented host
 * contract), and COUNTS everything — the counts are the exactly-once
 * evidence the E6 crash tests assert against.
 */
export function createCountingEffects(): WorkerEffectsPort & {
  readonly realInvocations: number;
  readonly duplicateInvocations: number;
  readonly performedKeys: readonly string[];
  readonly performedWorkIds: readonly string[];
  refusedKeys(keys: readonly string[]): void;
  readonly refusals: readonly { readonly effectKey: string; readonly code: string; readonly detail: string }[];
} {
  const performed = new Set<string>();
  const performedWork: string[] = [];
  let duplicates = 0;
  let refused: readonly string[] = [];
  const refusalLog: { effectKey: string; code: string; detail: string }[] = [];
  return {
    get realInvocations(): number {
      return performed.size;
    },
    get duplicateInvocations(): number {
      return duplicates;
    },
    get performedKeys(): readonly string[] {
      return Object.freeze([...performed]);
    },
    get performedWorkIds(): readonly string[] {
      return Object.freeze([...performedWork]);
    },
    get refusals(): readonly { effectKey: string; code: string; detail: string }[] {
      return Object.freeze([...refusalLog]);
    },
    refusedKeys(keys: readonly string[]): void {
      refused = [...keys];
    },
    perform(effect: WorkEffect): EffectOutcome {
      if (refused.includes(effect.effectKey)) {
        refusalLog.push({ effectKey: effect.effectKey, code: "executor-refused", detail: `refusing ${String(effect.effectKind)} by fixture` });
        return { ok: false, code: "executor-refused", detail: `refusing ${String(effect.effectKind)} by fixture` };
      }
      if (performed.has(effect.effectKey)) {
        duplicates += 1;
        return { ok: true, duplicate: true, result: { effectKey: effect.effectKey, replay: true } };
      }
      performed.add(effect.effectKey);
      performedWork.push(effect.workId);
      return { ok: true, duplicate: false, result: { effectKey: effect.effectKey, replay: false } };
    },
  };
}

/**
 * A crash-injecting effects port: the Nth REAL invocation is performed
 * by the inner executor and THEN the process "dies" before the receipt
 * can return (the receipt was never persisted — the resume must
 * re-invoke and receive the executor's keyed duplicate receipt).
 */
export function crashAfterRealInvocations(
  inner: WorkerEffectsPort,
  afterCount: number,
): WorkerEffectsPort {
  let reals = 0;
  return {
    perform(effect: WorkEffect): EffectOutcome {
      const outcome = inner.perform(effect);
      reals += 1;
      if (reals === afterCount + 1) throw new Error(`injected crash: effects invocation #${String(reals)} (receipt lost)`);
      return outcome;
    },
  };
}

/**
 * A crash-injecting effects port that dies BEFORE the Nth invocation is
 * even attempted (the executor is NEVER invoked for it — the durable
 * WAL intent stands but no effect ran). The resume must re-invoke, and
 * because the executor never ran, the re-invocation is a REAL effect
 * (NOT a keyed duplicate) — the honest complement of
 * {@link crashAfterRealInvocations}.
 */
export function crashOnInvocationAttempt(
  inner: WorkerEffectsPort,
  nth: number,
): WorkerEffectsPort {
  let attempts = 0;
  return {
    perform(effect: WorkEffect): EffectOutcome {
      attempts += 1;
      if (attempts === nth) throw new Error(`injected crash: effects invocation attempt #${String(attempts)} (executor never invoked)`);
      return inner.perform(effect);
    },
  };
}

/** Fixture commit (lineage evidence of the fixture corpus). */
export const OPS_FIXTURE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** Default gate-passing metadata (R19 license + provenance evidence). */
export function opsFixtureMetadata(overrides?: Partial<PackageMetadata>): PackageMetadata {
  return {
    dependencies: [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: "verified" },
    provenance: {
      origin: { type: "original" },
      sourceCommit: OPS_FIXTURE_COMMIT,
      transformationHistory: [{ kind: "author", description: "authored for the ops fixture corpus" }],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ["simulation"], engines: ["native"], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [],
    extensionPoints: [],
    overlay: null,
    ...overrides,
  };
}

/** Builds one sealed, gate-passing package record (deterministic, E9). */
export function sealOpsPackageRecord(
  kind: PackageRecord["identity"]["kind"],
  id: string,
  version: string,
  metadata?: Partial<PackageMetadata>,
): PackageRecord {
  const parsed = parseSemver(version);
  if (parsed === null) throw new Error(`fixture semver literal is invalid: ${version}`);
  const unsealed: UnsealedPackageRecord = {
    identity: { kind, id, version: parsed },
    metadata: opsFixtureMetadata(metadata),
  };
  return sealPackageRecord(unsealed);
}
