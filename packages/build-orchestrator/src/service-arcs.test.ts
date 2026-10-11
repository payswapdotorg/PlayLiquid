/**
 * Phase-arc engine tests (E10) — advanceOneArc over a minimal ArcHost
 * double (the service's own host wiring mirrored piece for piece): the
 * frozen phase machine, closure refusal at resolve (R19), truthful
 * toolchain unavailability at plan (E11), the console vendor gate before
 * ANY tool step executes (lock rule 24), typed tool-step failures, and
 * the event discipline every arc maintains.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asBuildId,
  asToolOperationId,
  computeBuildInputsDigest,
  computeBuildRequestFingerprint,
} from "@playliquid/build-contracts";
import type { BuildId, BuildInputs, BuildPhase, BuildRequestCommand } from "@playliquid/build-contracts";
import { computeDigest, computeLockFingerprint } from "@playliquid/package-system";
import type { ContentDigest, PackageLock, PackageRecord } from "@playliquid/package-system";
import { advanceOneArc } from "./service-arcs.ts";
import type { ArcHost } from "./service-arcs.ts";
import { computeBuildPlan, planOperations } from "./plan.ts";
import { BUILD_ORCHESTRATOR_AUTHORITY, nextSequence } from "./events.ts";
import type { BuildEvent } from "./events.ts";
import type { BuildRecord, EnvironmentLimitation } from "./document.ts";
import { createFakeBuildSource, createFakeToolFabric, createManualClock } from "./fakes.ts";
import type { FakeToolFabric, ManualClock } from "./fakes.ts";
import { asTenantId } from "./tenancy.ts";
import {
  contentDigestsOf,
  expectedManifestDigest,
  fixtureBuildRequest,
  fixtureConsoleBuildInputs,
  fixtureLock,
  fixturePackageRecord,
  fixtureRecords,
  fixtureVendorSdkEvidence,
  fixtureWebBuildInputs,
  stageDigestsFromEvents,
} from "./fixtures.ts";

const TENANT = asTenantId("tenant-a");
const BUILD = asBuildId("bld-arcs-fixture-0001");
const OPERATIONS = ["build", "test", "package"].map((operation) => asToolOperationId(operation));

/** Options of the arc rig. */
interface ArcRigOptions {
  /** Records closures resolve against (default: the gate-passing fixtures). */
  readonly records?: readonly PackageRecord[];
  /** The lock table (default: one lock over the fixture records). */
  readonly locks?: ReadonlyMap<ContentDigest, PackageLock>;
  /** Content the source can resolve (default: the inputs' blob digests). */
  readonly content?: readonly ContentDigest[];
  /** The fabric double (default: all fixture operations available). */
  readonly fabric?: FakeToolFabric;
  /** The pinned request command (default: a fixture request over `inputs`). */
  readonly command?: BuildRequestCommand;
}

/** The arc rig: a minimal ArcHost double plus the build record under test. */
interface ArcRig {
  readonly host: ArcHost;
  readonly record: BuildRecord;
  readonly events: BuildEvent[];
  readonly limitations: EnvironmentLimitation[];
  readonly fabric: FakeToolFabric;
  readonly clock: ManualClock;
  readonly buildId: BuildId;
}

function arcRig(inputs: BuildInputs, options: ArcRigOptions = {}): ArcRig {
  const records = options.records ?? fixtureRecords();
  const lock = fixtureLock(records);
  const locks = options.locks ?? new Map<ContentDigest, PackageLock>([[computeLockFingerprint(lock), lock]]);
  const fabric = options.fabric ?? createFakeToolFabric({ operations: OPERATIONS });
  const clock = createManualClock();
  const command = options.command ?? fixtureBuildRequest(inputs);
  const record: BuildRecord = {
    buildId: BUILD,
    tenant: TENANT,
    requester: command.idempotency.requester,
    phase: "queued",
    admittedAt: clock.now(),
    fingerprint: computeBuildRequestFingerprint(command),
    inputsDigest: computeBuildInputsDigest(command.inputs),
    request: command,
    steps: [],
    artifacts: [],
    evidence: [],
    closureSummary: null,
    provenance: null,
    outputs: null,
    failure: null,
  };
  const builds = new Map<string, BuildRecord>([[BUILD, record]]);
  const events: BuildEvent[] = [];
  const limitations: EnvironmentLimitation[] = [];
  const host: ArcHost = {
    sources: createFakeBuildSource({
      records,
      locks,
      resolvableContent: new Set(options.content ?? contentDigestsOf(inputs)),
    }),
    fabric,
    emit: (tenant, buildId, type, phase, detail): BuildEvent => {
      const event: BuildEvent = {
        kind: "build-orchestrator-event",
        authority: BUILD_ORCHESTRATOR_AUTHORITY,
        tenant: asTenantId(tenant),
        buildId,
        sequence: nextSequence(events, buildId),
        at: clock.now(),
        type,
        phase,
        ...(detail === undefined ? {} : { detail }),
      };
      events.push(event);
      return event;
    },
    mutate: (buildId, patch) => {
      const current = builds.get(buildId);
      if (current !== undefined) {
        builds.set(buildId, { ...current, ...patch(current) });
      }
    },
    recordOf: (buildId): BuildRecord => {
      const current = builds.get(buildId);
      if (current === undefined) {
        throw new Error(`internal invariant: build ${buildId} disappeared mid-arc`);
      }
      return current;
    },
    planOf: (current) =>
      computeBuildPlan(
        asBuildId(current.buildId),
        current.request.inputs.targetProfile.target,
        current.request.inputs.toolchain.citesToolOperations,
      ),
    stepInputBase: (current) => ({
      buildId: current.buildId,
      tenant: current.tenant,
      target: current.request.inputs.targetProfile.target,
      inputsDigest: current.inputsDigest,
    }),
    missingOperations: (plan) => {
      const available = new Set<string>(fabric.availableOperations());
      return planOperations(plan).filter((operation) => !available.has(operation));
    },
    recordLimitation: (current, code, message, operation) => {
      const at = clock.now();
      limitations.push({
        limitationId: `lim-${computeDigest({ at, code, message }).slice("sha256:".length, "sha256:".length + 16)}`,
        at,
        tenant: current.tenant,
        buildId: current.buildId,
        target: current.request.inputs.targetProfile.target,
        ...(operation === undefined ? {} : { operation }),
        code,
        message,
      });
      host.emit(current.tenant, current.buildId, "limitation-recorded", current.phase, { code, message });
    },
  };
  return { host, record, events, limitations, fabric, clock, buildId: BUILD };
}

test("the frozen phase machine advances exactly one phase per arc and stamps success with the plan-derived manifest digest (E10/E9)", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const rig = arcRig(inputs);
  const phases: BuildPhase[] = [];
  let manifestDigest: string | undefined;
  let current = rig.record;
  for (let index = 0; index < 5; index += 1) {
    const step = await advanceOneArc(rig.host, current);
    assert.equal(step.ok, true);
    assert.equal(step.terminal, index === 4);
    phases.push(step.phase);
    if (step.manifestDigest !== undefined) {
      manifestDigest = step.manifestDigest;
    }
    current = rig.host.recordOf(rig.buildId);
  }
  assert.deepEqual(phases, ["resolve", "plan", "emit", "verify", "succeeded"]);
  const final = rig.host.recordOf(rig.buildId);
  assert.equal(final.phase, "succeeded");
  assert.notEqual(final.outputs, null);
  assert.equal(final.steps.length, 5);
  assert.equal(final.failure, null);
  // The manifest digest is knowable BEFORE packaging (E9): it equals the
  // fixtures' plan-derived expectation over the recorded stage digests.
  assert.equal(manifestDigest, expectedManifestDigest(BUILD, inputs, stageDigestsFromEvents(rig.events)));
  const succeeded = rig.events.find((event) => event.type === "build-succeeded");
  assert.notEqual(succeeded, undefined);
  assert.equal((succeeded?.detail as { manifestDigest: string } | undefined)?.manifestDigest, manifestDigest);
  // Event discipline: per-build sequences are 1..N, strictly increasing, append-only.
  const sequences = rig.events.filter((event) => event.buildId === BUILD).map((event) => event.sequence);
  assert.deepEqual(sequences, sequences.map((_, index) => index + 1));
  // Every stage of the frozen stage vocabulary completed exactly once.
  const stages = Object.keys(stageDigestsFromEvents(rig.events)).sort();
  assert.deepEqual(stages, ["emit", "package", "plan", "resolve", "verify"]);
});

test("a closure the R19 gate refuses fails the resolve arc with the prefixed typed reason", async () => {
  const records = [...fixtureRecords(), fixturePackageRecord("fixture-arcs-unlicensed", { licenseStatus: "declared" })];
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const rig = arcRig(inputs, { records });
  const step = await advanceOneArc(rig.host, rig.record);
  assert.equal(step.terminal, true);
  assert.equal(step.failure?.code, "closure-provenance-gate-failed");
  assert.equal(rig.host.recordOf(rig.buildId).phase, "failed");
  const failed = rig.events.find((event) => event.type === "build-failed");
  assert.notEqual(failed, undefined);
  assert.equal((failed?.detail as { code: string } | undefined)?.code, "closure-provenance-gate-failed");
});

test("a toolchain citing an unavailable operation fails the plan arc truthfully, never simulated (E11)", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const fabric = createFakeToolFabric({ operations: ["build", "test"].map((operation) => asToolOperationId(operation)) });
  const rig = arcRig(inputs, { fabric });
  const resolve = await advanceOneArc(rig.host, rig.record);
  assert.equal(resolve.phase, "resolve");
  assert.equal(resolve.terminal, false);
  const plan = await advanceOneArc(rig.host, rig.host.recordOf(rig.buildId));
  assert.equal(plan.terminal, true);
  assert.equal(plan.failure?.code, "toolchain-unavailable");
  assert.match(plan.failure?.message ?? "", /never simulated/);
  assert.equal(rig.limitations.length, 1);
  assert.equal(rig.limitations[0]?.code, "toolchain-unavailable");
  assert.equal(rig.limitations[0]?.operation, "package");
  // No tool step ever executed — the gap is observed, not worked around.
  assert.equal(rig.fabric.calls.length, 0);
  assert.notEqual(rig.events.find((event) => event.type === "limitation-recorded"), undefined);
});

test("the console vendor gate refuses BEFORE any tool step executes (lock rule 24)", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureConsoleBuildInputs(lock);
  const rig = arcRig(inputs);
  const resolve = await advanceOneArc(rig.host, rig.record);
  assert.equal(resolve.phase, "resolve");
  const plan = await advanceOneArc(rig.host, rig.host.recordOf(rig.buildId));
  assert.equal(plan.phase, "plan");
  const emit = await advanceOneArc(rig.host, rig.host.recordOf(rig.buildId));
  assert.equal(emit.terminal, true);
  assert.equal(emit.failure?.code, "vendor-evidence-required");
  assert.match(emit.failure?.message ?? "", /never fabricated/);
  assert.equal(rig.fabric.calls.length, 0);
  assert.equal(rig.limitations.length, 1);
  assert.equal(rig.limitations[0]?.code, "console-verification-out-of-band");
});

test("console vendor evidence supplied out-of-band unlocks the emit arc", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureConsoleBuildInputs(lock);
  const rig = arcRig(inputs);
  const resolve = await advanceOneArc(rig.host, rig.record);
  assert.equal(resolve.phase, "resolve");
  const plan = await advanceOneArc(rig.host, rig.host.recordOf(rig.buildId));
  assert.equal(plan.phase, "plan");
  const emit = await advanceOneArc(rig.host, rig.host.recordOf(rig.buildId), {
    vendorEvidence: [fixtureVendorSdkEvidence(inputs)],
  });
  assert.equal(emit.terminal, false);
  assert.equal(emit.phase, "emit");
  assert.equal(rig.fabric.calls.length, 1);
  assert.equal(rig.host.recordOf(rig.buildId).evidence.length, 1);
});

test("a failed tool step is a typed terminal failure with no fabricated outputs", async () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const inputs = fixtureWebBuildInputs(lock);
  const fabric = createFakeToolFabric({ operations: OPERATIONS });
  fabric.failOperation(asToolOperationId("build"), { code: "compiler-crash", message: "scripted fault" });
  const rig = arcRig(inputs, { fabric });
  const resolve = await advanceOneArc(rig.host, rig.record);
  assert.equal(resolve.phase, "resolve");
  const plan = await advanceOneArc(rig.host, rig.host.recordOf(rig.buildId));
  assert.equal(plan.phase, "plan");
  const emit = await advanceOneArc(rig.host, rig.host.recordOf(rig.buildId));
  assert.equal(emit.terminal, true);
  assert.equal(emit.failure?.code, "tool-step-failed");
  assert.match(emit.failure?.message ?? "", /compiler-crash/);
  const record = rig.host.recordOf(rig.buildId);
  assert.equal(record.phase, "failed");
  assert.equal(record.artifacts.length, 0);
  assert.equal(record.steps.length, 2); // resolve + plan only — nothing fabricated past the fault
});
