/**
 * THE HEALTH/READINESS TESTS (PL-044) — typed UP/DOWN/DEGRADED gates over
 * REAL service doors; a failing dependency is a typed DOWN carrying the
 * dependency's own refusal code VERBATIM (E8, never a silent pass);
 * liveness is the durable worker's journal freshness (E10); the report
 * is deterministic (E9).
 *
 * WHAT IS REAL HERE (E11): the rights-authority, platform-economy and
 * platform-integrity gates probe the REAL composed security rig
 * (security-gameos's public `createSecurityRig`: the real authority,
 * economy and integrity services over the real PL-011 registry/CAS); the
 * build-orchestrator gate probes a REAL BuildOrchestratorService (over
 * that package's own public test fakes — its snapshot/verify discipline
 * is the door under probe); the registry/CAS gates probe the rig's real
 * index and CAS. WHAT IS NOT: there is no process supervision, no
 * network, no time — the clock is injected, the probes are in-process
 * function calls. A host wiring real infrastructure binds the same
 * HealthGate seams.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSecurityRig,
  RIG_ADMIN,
  RIG_AVATAR_SUBJECT,
  RIG_CLEAN_SUBJECT,
  RIG_HOST,
  RIG_INTEGRITY_OPERATOR,
  RIG_PLAYER,
  RIG_TENANT,
} from "../../../packages/security-gameos/src/index.ts";
import type { SecurityRig, RightsRequest } from "../../../packages/security-gameos/src/index.ts";
import { BuildOrchestratorService } from "../../../packages/build-orchestrator/src/index.ts";
import { createFakeBuildSource, createFakeToolFabric, createManualClock, createMemoryBuildStore } from "../../../packages/build-orchestrator/src/index.ts";
import { asToolOperationId } from "../../../packages/build-contracts/src/index.ts";
import { OpsHealthService } from "./health.ts";
import type { GateStatus, HealthGate } from "./health.ts";
import {
  bindArtifactCasGate,
  bindBuildOrchestratorGate,
  bindEconomyGate,
  bindIntegrityGate,
  bindRegistryGate,
  bindRightsAuthorityGate,
  bindWebHostGate,
  bindWorkerJournalGate,
} from "./health-bindings.ts";
import { DurableWorkerRuntime } from "./worker.ts";
import { composeWebHost } from "./web-host.ts";
import type { HostMount } from "./web-host.ts";
import { createCountingEffects, createFixedClock, createMemoryWorkerStore } from "./fixtures.ts";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";

const TENANT = asTenantId("tenant-ops-health")!;
const SUBJECT = asSubjectId("subject-ops-health")!;

/** The real composed security rig (one per file: deterministic, E9). */
const rig: SecurityRig = await createSecurityRig();

/** A real build-orchestrator service over its own public test fakes. */
function realBuildService(): BuildOrchestratorService {
  return new BuildOrchestratorService({
    sources: createFakeBuildSource({ records: [rig.packages.good] }),
    fabric: createFakeToolFabric({ operations: [asToolOperationId("build")] }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });
}

/** A driven durable worker (fresh journal evidence for liveness). */
function drivenWorker(): DurableWorkerRuntime {
  const worker = new DurableWorkerRuntime({
    ports: { clock: createFixedClock(1_000), store: createMemoryWorkerStore(), effects: createCountingEffects() },
  });
  const enqueued = worker.enqueue({ tenant: TENANT, subject: SUBJECT }, { kind: "demo-work", effectKind: "demo-effect", payload: { n: 0 } });
  assert.ok(enqueued.ok);
  return worker;
}

/** The honest web host mounts (the PL-033/034 composition, E11: no DOM). */
function honestMounts(): readonly HostMount[] {
  return [
    {
      mountId: "mount-game-studio",
      workbench: "game-studio",
      ports: [{ port: "StudioDataPort", provider: { source: "demo-fixture", fixture: "demoStudioSnapshot" } }],
      rendered: false,
    },
    {
      mountId: "mount-gameos-lab",
      workbench: "gameos-lab",
      ports: [
        { port: "LabDataPort", provider: { source: "demo-fixture", fixture: "demoLabSnapshot" } },
        { port: "LabCommandPort", provider: { source: "host-adapter", adapter: "ops-lab-command-adapter" } },
      ],
      rendered: false,
    },
    {
      mountId: "mount-gameos-community",
      workbench: "gameos-community",
      ports: [
        { port: "CommunityDataPort", provider: { source: "demo-fixture", fixture: "demoCommunitySnapshot" } },
        { port: "CommunityCommandPort", provider: { source: "host-adapter", adapter: "ops-community-command-adapter" } },
      ],
      rendered: false,
    },
  ];
}

/** The full all-real gate set (the happy wiring a host composes). */
function allRealGates(): readonly HealthGate[] {
  const canary = rig.packages.good;
  const host = composeWebHost(honestMounts());
  assert.ok(host.ok, host.ok ? "" : host.detail);
  return [
    bindRegistryGate({ registry: rig.registry, canary: canary.identity }),
    bindArtifactCasGate({ artifacts: rig.artifacts, canaryDigest: canary.identity.contentDigest }),
    bindBuildOrchestratorGate({ builds: realBuildService() }),
    bindRightsAuthorityGate({
      authority: rig.authority,
      // The canary decision: the rig's registered avatar binding grants
      // `vision` on the rig host — a real GRANTED adjudication.
      canaryRequest: { tenant: RIG_TENANT, subject: RIG_AVATAR_SUBJECT, capability: { kind: "avatar", capability: "vision", host: RIG_HOST } } as RightsRequest,
      actor: RIG_ADMIN,
      tenant: RIG_TENANT,
    }),
    bindEconomyGate({ economy: rig.economy }),
    bindIntegrityGate({ integrity: rig.integrity, reader: { subject: RIG_INTEGRITY_OPERATOR, tenant: RIG_TENANT }, canarySubject: RIG_CLEAN_SUBJECT }),
    bindWorkerJournalGate({ worker: drivenWorker(), clock: createFixedClock(1_000), maxAgeMs: 60_000 }),
    bindWebHostGate({ host: host.ok ? host.value : { hostDigest: "", mounts: [], truth: { dom: false, rendering: false, network: false } } }),
  ];
}

test("readiness: every gate over the REAL doors rolls up UP", () => {
  const service = new OpsHealthService({ gates: allRealGates(), clock: createFixedClock(5_000) });
  const report = service.readiness();
  assert.equal(report.status, "up");
  assert.equal(report.at, 5_000);
  assert.equal(report.gates.length, 8);
  for (const gate of report.gates) {
    assert.equal(gate.status, "up", `${gate.door}: ${gate.detail}`);
    assert.equal(gate.refusalCode, undefined);
  }
});

test("E9: the readiness report is deterministic — run twice, identical", () => {
  const run = (): readonly { door: string; status: GateStatus; detail: string }[] => {
    const service = new OpsHealthService({ gates: allRealGates(), clock: createFixedClock(5_000) });
    return service.readiness().gates.map(({ door, status, detail }) => ({ door, status, detail }));
  };
  assert.deepEqual(run(), run());
});

test("E8: an unknown CAS digest is a typed DOWN gate with the store's refusal code verbatim, never a silent pass", () => {
  // A WELL-FORMED blob digest (`sha256:<64 hex>`) that nothing ever
  // stored resolves to: the store's own typed `unknown-digest` refusal.
  const gate = bindArtifactCasGate({ artifacts: rig.artifacts, canaryDigest: "sha256:" + "a".repeat(64) });
  const probe = gate.probe();
  assert.equal(probe.status, "down");
  assert.equal(probe.refusalCode, "unknown-digest", "the artifact store's own code, verbatim (E8)");
  assert.ok(probe.detail.length > 0);
});

test("E8/E10: a corrupted CAS blob is a typed DOWN gate with the integrity code verbatim", () => {
  // The rig's blob store is the documented corruption seam: decay the
  // canary blob's only chunk under the digest and the fail-closed fetch
  // refuses with `integrity`.
  const canary = rig.packages.good;
  const corrupted = rig.blobStore.corruptChunkForTests(canary.identity.contentDigest, 0);
  assert.equal(corrupted, true, "the canary blob must have a chunk to corrupt");
  const gate = bindArtifactCasGate({ artifacts: rig.artifacts, canaryDigest: canary.identity.contentDigest });
  const probe = gate.probe();
  assert.equal(probe.status, "down");
  assert.equal(probe.refusalCode, "integrity");
});

test("E8: a tampered registry canary is a typed DOWN gate (digest-mismatch), never a silent pass", () => {
  const canary = rig.packages.good;
  // A tampered COPY of the sealed record: the identity digest no longer
  // pins the (edited) content — verifyPackageDigest fails (E8).
  const tampered = { ...canary, metadata: { ...canary.metadata, provenance: { ...canary.metadata.provenance, sourceCommit: "f".repeat(40) } } };
  const gate = bindRegistryGate({
    registry: { get: () => tampered },
    canary: canary.identity,
  });
  const probe = gate.probe();
  assert.equal(probe.status, "down");
  assert.equal(probe.refusalCode, "digest-mismatch");
});

test("E8: an unresolvable registry canary is a typed DOWN gate (missing-canary)", () => {
  const gate = bindRegistryGate({ registry: { get: () => null }, canary: rig.packages.good.identity });
  const probe = gate.probe();
  assert.equal(probe.status, "down");
  assert.equal(probe.refusalCode, "missing-canary");
});

test("E8: a tampered build-orchestrator snapshot is a typed DOWN gate with the snapshot code verbatim", () => {
  const real = realBuildService().snapshot();
  // Edit the canonical document string under the content address: the
  // snapshot id no longer matches (snapshot-digest-mismatch, E10).
  const tampered = { ...real, document: real.document.replace("revision", "revlsion") };
  assert.notEqual(tampered.document, real.document);
  const gate = bindBuildOrchestratorGate({ builds: { snapshot: () => tampered } });
  const probe = gate.probe();
  assert.equal(probe.status, "down");
  assert.ok(probe.refusalCode === "snapshot-digest-mismatch" || probe.refusalCode === "snapshot-malformed", `code: ${String(probe.refusalCode)}`);
});

test("readiness rollup: any DOWN gate makes the whole report DOWN; DEGRADED alone makes it DEGRADED", () => {
  const degraded = bindIntegrityGate({
    integrity: rig.integrity,
    reader: { subject: RIG_INTEGRITY_OPERATOR, tenant: RIG_TENANT },
    canarySubject: RIG_PLAYER, // a subject with NO recorded verdict — an honest absence (E11), not a failure
  });
  const down = bindArtifactCasGate({ artifacts: rig.artifacts, canaryDigest: "sha256:" + "b".repeat(64) });
  const clock = createFixedClock(5_000);
  const onlyDegraded = new OpsHealthService({ gates: [degraded], clock }).readiness();
  assert.equal(onlyDegraded.status, "degraded");
  assert.equal(onlyDegraded.gates[0]?.status, "degraded");
  assert.equal(onlyDegraded.gates[0]?.refusalCode, "no-recorded-verdict");
  const withDown = new OpsHealthService({ gates: [degraded, down], clock }).readiness();
  assert.equal(withDown.status, "down");
});

test("E8: an honest absence is DEGRADED, never a fake UP — the integrity door with no recorded verdict", () => {
  const gate = bindIntegrityGate({
    integrity: rig.integrity,
    reader: { subject: RIG_INTEGRITY_OPERATOR, tenant: RIG_TENANT },
    canarySubject: RIG_PLAYER,
  });
  const probe = gate.probe();
  assert.equal(probe.status, "degraded");
  assert.equal(probe.refusalCode, "no-recorded-verdict");
});

test("E8: a gate probe that THROWS is a typed DOWN (probe-threw), never a crash of the readiness read", () => {
  const throwing: HealthGate = {
    door: "ops-worker-journal",
    probe: (): never => {
      throw new Error("dependency exploded");
    },
  };
  const service = new OpsHealthService({ gates: [throwing, ...allRealGates()], clock: createFixedClock(5_000) });
  const report = service.readiness();
  assert.equal(report.status, "down");
  const thrown = report.gates.find((gate) => gate.refusalCode === "probe-threw");
  assert.ok(thrown !== undefined);
  assert.ok(thrown.detail.includes("dependency exploded"));
});

test("E10: liveness is the worker journal's freshness — UP when fresh, DOWN when stale or empty", () => {
  const clock = createFixedClock(10_000);
  const service = new OpsHealthService({ gates: [], clock });
  const worker = drivenWorker(); // last journal entry at 1_000
  const fresh = service.liveness(worker, 60_000);
  assert.equal(fresh.status, "up");
  assert.equal(fresh.entries, 1);
  const stale = service.liveness(worker, 5_000);
  assert.equal(stale.status, "down");
  assert.ok(stale.detail.includes("stale"));
  const emptyWorker = new DurableWorkerRuntime({
    ports: { clock, store: createMemoryWorkerStore(), effects: createCountingEffects() },
  });
  const empty = service.liveness(emptyWorker, 60_000);
  assert.equal(empty.status, "down");
  assert.ok(empty.detail.includes("empty"));
});

test("E8: the worker-journal gate refuses stale and empty journals with typed codes", () => {
  const worker = drivenWorker(); // last entry at 1_000
  const fresh = bindWorkerJournalGate({ worker, clock: createFixedClock(2_000), maxAgeMs: 60_000 }).probe();
  assert.equal(fresh.status, "up");
  const stale = bindWorkerJournalGate({ worker, clock: createFixedClock(1_000 + 61_000), maxAgeMs: 60_000 }).probe();
  assert.equal(stale.status, "down");
  assert.equal(stale.refusalCode, "stale-journal");
  const emptyWorker = new DurableWorkerRuntime({
    ports: { clock: createFixedClock(1_000), store: createMemoryWorkerStore(), effects: createCountingEffects() },
  });
  const empty = bindWorkerJournalGate({ worker: emptyWorker, clock: createFixedClock(1_000), maxAgeMs: 60_000 }).probe();
  assert.equal(empty.status, "down");
  assert.equal(empty.refusalCode, "empty-journal");
});

test("E8: a tampered web host document is a typed DOWN gate with the composition's refusal code verbatim", () => {
  const host = composeWebHost(honestMounts());
  assert.ok(host.ok);
  const tampered = { ...host.value, hostDigest: "e".repeat(64) };
  const gate = bindWebHostGate({ host: tampered });
  const probe = gate.probe();
  assert.equal(probe.status, "down");
  assert.equal(probe.refusalCode, "tampered-document");
});
