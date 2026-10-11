/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full PlayCanvas adapter journey over the in-memory fake
 * bridge: register (lifecycle registered) -> not-ready refusal -> mark
 * ready -> inspect project (authoritative ok) -> modify -> import by
 * content address -> export mints an artifact ref -> scene script ok ->
 * publish a web build -> play the published build -> lifecycle degraded
 * refusal -> recover -> duplicate command id replay (E10) -> same id
 * different content conflict (E8) -> undeclared capability refusal
 * (E8/R13) -> cross-tenant dispatch refusal (R20) -> deadline expiry
 * (E8) -> client-claim rejection (E8) -> evidence ledger append-only
 * checks (E10) -> determinism: a second adapter with the same seed
 * reproduces the same command keys (E9) -> integration: the adapter
 * registers into the Tool Fabric runtime registry and executes through
 * the adapter-dispatch executor (PL-019 hosting pattern; R13) -> the
 * typed web-first engine binding serves web/spark target profiles and
 * refuses a windows profile -> closed refusal (terminal lifecycle).
 * Prints deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no wall clock (fake clock),
 * no randomness (seeded), no network.
 */

import { asTenantId } from "@playliquid/platform-contracts";
import { asEngineId } from "@playliquid/target-profiles";
import type { TargetProfileRecord } from "@playliquid/target-profiles";
import { createAdapterDispatchExecutor, createToolFabricRegistry } from "@playliquid/tool-fabric-runtime";
import { createPlayCanvasAdapter } from "./adapter.ts";
import { createFakePlayCanvasBridge, createFakePlayCanvasClock } from "./fake-bridge.ts";
import { PLAYCANVAS_PAYLOAD_VERSION } from "./payload-model.ts";
import {
  createPlayCanvasEngineBinding,
  isProjectedEngineBindingRef,
  playCanvasCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
} from "./engine-binding.ts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";

const tenant = asTenantId("tenant-harness")!;
const digest = (char: string): string => char.repeat(64);

function dispatch(commandId: string, capability: string, payload: unknown, overrides: Partial<AdapterCommandDispatch> = {}): AdapterCommandDispatch {
  return { kind: "adapter-command-dispatch", commandId, capability, payload, ...overrides };
}

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

/**
 * Minimal web-family profile fixture: the typed compatibility predicate
 * reads ONLY profile.target + profile.engineBindings, so a core-only
 * object is a faithful stand-in for the sealed record (single typed
 * cast; the runtime-contracts spark.test.ts fixture precedent).
 */
function profileOf(target: string, engines: readonly string[]): TargetProfileRecord {
  return {
    target,
    engineBindings: { engines: engines.map((engine) => asEngineId(engine)), pinnedBindings: null },
  } as unknown as TargetProfileRecord;
}

const bridge = createFakePlayCanvasBridge({ seed: 1234 });
const clock = createFakePlayCanvasClock(10_000);
const adapter = createPlayCanvasAdapter({ tenant, bridge, clock });

// 1. Registration state: dispatch before ready is refused (E8).
const notReady = await adapter.dispatch(dispatch("h1", "project.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
}));
record("not-ready-refusal", "refused:adapter/not-ready", notReady.outcome === "refused" ? `refused:${notReady.refusal.code}` : notReady.outcome);

// 2. markReady through the contract validator.
const ready = adapter.markReady();
record("mark-ready", "ok:ready", `${ready.outcome}:${adapter.state}`);

// 3. Inspect project: authoritative ok.
const inspect = await adapter.dispatch(dispatch("h2", "project.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
}));
record(
  "inspect-project",
  "ok:project.inspect",
  inspect.outcome === "ok" ? `ok:${(inspect.value as { capability: string }).capability}` : `${inspect.outcome}:${inspect.outcome === "failed" ? inspect.error.code : inspect.refusal.code}`,
);

// 4. Modify: applied edit count.
const modify = await adapter.dispatch(dispatch("h3", "project.modify", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
  edits: [{ entityName: "Entity-Cube", property: "position", value: [1, 2, 3] }],
}));
record("modify", "ok:1", modify.outcome === "ok" ? `ok:${(modify.value as { appliedEdits: number }).appliedEdits}` : `${modify.outcome}`);

// 5. Import by content address.
const imported = await adapter.dispatch(dispatch("h4", "asset.import", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "assets/hero",
  format: "glb",
  into: "scene",
  artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 4096 },
}));
record("import", "ok:4096", imported.outcome === "ok" ? `ok:${(imported.value as { importedBytes: number }).importedBytes}` : `${imported.outcome}`);

// 6. Export mints a fresh artifact ref.
const exported = await adapter.dispatch(dispatch("h5", "asset.export", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "assets/hero",
  format: "gltf",
  mode: "entity",
  entityName: "Entity-Cube",
}));
const exportArtifact = exported.outcome === "ok" ? (exported.value as { artifact: { kind: string } }).artifact : undefined;
record("export", "artifact-ref", exportArtifact !== undefined ? "artifact-ref" : `${exported.outcome}`);

// 7. Scene script ok.
const script = await adapter.dispatch(dispatch("h6", "scene.script", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "scene-main",
  scriptDigest: digest("b"),
}));
record("scene-script", "ok:0", script.outcome === "ok" ? `ok:${(script.value as { exitCode: number }).exitCode}` : `${script.outcome}`);

// 8. Publish a web build; play the published build id.
const publish = await adapter.dispatch(dispatch("h7", "build.publish", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
  channel: "web",
}));
const buildId = publish.outcome === "ok" ? (publish.value as { buildId: string }).buildId : "";
record("build-publish", "ok:web", publish.outcome === "ok" ? `ok:${(publish.value as { channel: string }).channel}` : `${publish.outcome}`);
const play = await adapter.dispatch(dispatch("h8", "build.play", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
  buildId,
}));
record("build-play", `ok:${buildId}`, play.outcome === "ok" ? `ok:${(play.value as { buildId: string }).buildId}` : `${play.outcome}`);

// 9. Degraded refusal; recover.
adapter.reportDegraded();
const degraded = await adapter.dispatch(dispatch("h9", "project.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
}));
record("degraded-refusal", "refused:adapter/degraded", degraded.outcome === "refused" ? `refused:${degraded.refusal.code}` : degraded.outcome);
adapter.markReady();

// 10. Duplicate command id: identical content replays the recorded result.
const first = await adapter.dispatch(dispatch("dup-1", "scene.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "scene-main",
}));
const replayed = await adapter.dispatch(dispatch("dup-1", "scene.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "scene-main",
}));
const sceneInvocations = bridge.invoked.filter((invocation) => invocation.capability === "scene.inspect" && (invocation.payload as { target: string }).target === "scene-main").length;
record(
  "duplicate-replay",
  "same:1-invocation",
  `${JSON.stringify((replayed as { value: unknown }).value) === JSON.stringify((first as { value: unknown }).value) ? "same" : "different"}:${sceneInvocations}-invocation`,
);

// 11. Same id different content: typed conflict.
const conflict = await adapter.dispatch(dispatch("dup-1", "scene.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "scene-OTHER",
}));
record("command-id-conflict", "failed:playcanvas/command-id-conflict", conflict.outcome === "failed" ? `failed:${conflict.error.code}` : conflict.outcome);

// 12. Undeclared capability (R13: only through Tool Fabric).
const undeclared = await adapter.dispatch(dispatch("h10", "build.cook", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
}));
record("undeclared-capability", "refused:adapter-capability/not-declared", undeclared.outcome === "refused" ? `refused:${undeclared.refusal.code}` : undeclared.outcome);

// 13. Cross-tenant dispatch (R20).
const foreign = await adapter.dispatch(dispatch("h11", "project.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-foreign",
  target: "projects/game",
}));
record("cross-tenant", "failed:playcanvas-tenancy/tenant-mismatch", foreign.outcome === "failed" ? `failed:${foreign.error.code}` : foreign.outcome);

// 14. Deadline expiry (E8).
clock.setTo(99_000);
const expired = await adapter.dispatch(dispatch("h12", "project.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
}, { deadline: { atEpochMs: 20_000 } }));
record("deadline-expired", "failed:playcanvas/deadline-expired", expired.outcome === "failed" ? `failed:${expired.error.code}` : expired.outcome);
clock.setTo(10_000);

// 15. Client-claim rejection (E8).
const claimed = await adapter.dispatch(dispatch("h13", "project.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
  clientClaimed: true,
  claimedOutcome: "ok",
  claimedValue: { entities: 999 },
}));
record("client-claim", "failed:playcanvas/client-claim", claimed.outcome === "failed" ? `failed:${claimed.error.code}` : claimed.outcome);

// 16. Evidence ledger (E10): append-only, digest-pinned, replay visible.
const records = adapter.evidence.records;
const allDigested = records.every((item) => /^[a-f0-9]{64}$/.test(item.recordDigest));
const replayRecorded = records.some((item) => item.commandId === "dup-1" && item.outcome === "ok");
record("evidence-append-only", "true:true", `${allDigested}:${replayRecorded}`);

// 17. Determinism (E9): same seed, same inputs → same command keys.
const secondBridge = createFakePlayCanvasBridge({ seed: 1234 });
const secondClock = createFakePlayCanvasClock(10_000);
const secondAdapter = createPlayCanvasAdapter({ tenant, bridge: secondBridge, clock: secondClock });
secondAdapter.markReady();
const replays: readonly { readonly id: string; readonly capability: string; readonly payload: Record<string, unknown> }[] = [
  { id: "second-h2", capability: "project.inspect", payload: { version: PLAYCANVAS_PAYLOAD_VERSION, tenant: "tenant-harness", target: "projects/game" } },
  { id: "second-h3", capability: "project.modify", payload: { version: PLAYCANVAS_PAYLOAD_VERSION, tenant: "tenant-harness", target: "projects/game", edits: [{ entityName: "Entity-Cube", property: "position", value: [1, 2, 3] }] } },
  { id: "second-h4", capability: "asset.import", payload: { version: PLAYCANVAS_PAYLOAD_VERSION, tenant: "tenant-harness", target: "assets/hero", format: "glb", into: "scene", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 4096 } } },
  { id: "second-h5", capability: "asset.export", payload: { version: PLAYCANVAS_PAYLOAD_VERSION, tenant: "tenant-harness", target: "assets/hero", format: "gltf", mode: "entity", entityName: "Entity-Cube" } },
  { id: "second-h6", capability: "scene.script", payload: { version: PLAYCANVAS_PAYLOAD_VERSION, tenant: "tenant-harness", target: "scene-main", scriptDigest: digest("b") } },
];
for (const replay of replays) {
  await secondAdapter.dispatch(dispatch(replay.id, replay.capability, replay.payload));
}
const sameOutcomes = secondBridge.invoked.length === 5 && secondBridge.invoked.every((invocation) => bridge.invoked.some((original) => original.commandKey === invocation.commandKey));
record("determinism-same-command-keys", "true", String(sameOutcomes));

// 18. Tool Fabric runtime integration (R13): register + dispatch executor.
const registry = createToolFabricRegistry();
const registration = registry.register({
  descriptor: {
    identity: { namespace: "playliquid", name: "playcanvas-asset-export" },
    surfaceVersion: { major: 1, minor: 0 },
    title: "Asset export",
    description: "Exports an asset through the web-first engine adapter.",
    inputShape: { shapeId: "playliquid.shape/playcanvas-export-input", revision: 1 },
    outputShape: { shapeId: "playliquid.shape/playcanvas-export-output", revision: 1 },
    capabilities: [],
  },
  adapter,
  dispatchCapability: "asset.export",
});
record("fabric-registration", "ok", registration.outcome === "ok" ? "ok" : `rejected:${registration.rejections[0]?.code}`);
if (registration.outcome === "ok") {
  const executor = createAdapterDispatchExecutor();
  const executed = await executor.execute({
    kind: "executor-dispatch",
    callId: "fabric-call-1",
    registration: registration.registration,
    input: {
      version: PLAYCANVAS_PAYLOAD_VERSION,
      tenant: "tenant-harness",
      target: "assets/hero",
      format: "gltf",
      mode: "entity",
      entityName: "Entity-Cube",
    },
  });
  record(
    "fabric-execution",
    "executed",
    executed.outcome === "executed" ? "executed" : `${executed.outcome}:${executed.outcome === "refused" ? executed.code : ""}`,
  );
}

// 19. Typed web-first engine binding: web/spark served, windows refused.
const binding = createPlayCanvasEngineBinding();
const webVerdict = playCanvasCanServeTargetProfile(binding, profileOf("web", ["playcanvas"]));
record("binding-web", "compatible:web", webVerdict.compatible ? `compatible:${webVerdict.target}` : `refused:${webVerdict.code}`);
const sparkVerdict = playCanvasCanServeTargetProfile(binding, profileOf("spark", ["playcanvas"]));
record("binding-spark", "compatible:spark", sparkVerdict.compatible ? `compatible:${sparkVerdict.target}` : `refused:${sparkVerdict.code}`);
const windowsVerdict = playCanvasCanServeTargetProfile(binding, profileOf("windows", ["playcanvas"]));
record("binding-windows-refusal", "refused:playcanvas-binding/profile-target-unsupported", windowsVerdict.compatible ? `compatible:${windowsVerdict.target}` : `refused:${windowsVerdict.code}`);
const projection = toBuildContractsEngineBindingRef(binding);
record("binding-projection", "true", String(isProjectedEngineBindingRef(projection)));

// 20. Closed is terminal (E8 lifecycle).
adapter.close();
const closed = await adapter.dispatch(dispatch("h14", "project.inspect", {
  version: PLAYCANVAS_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "projects/game",
}));
record("closed-refusal", "refused:adapter/closed", closed.outcome === "refused" ? `refused:${closed.refusal.code}` : closed.outcome);

const failures = steps.filter((step) => step.expected !== step.actual);
console.log(JSON.stringify({ harness: "engine-playcanvas", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) {
  process.exitCode = 1;
}
