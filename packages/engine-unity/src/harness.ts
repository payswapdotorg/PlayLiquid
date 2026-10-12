/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full Unity adapter journey over the in-memory fake
 * bridge: register (lifecycle registered) -> not-ready refusal ->
 * mark ready -> inspect project/scene/gameobject/component/prefab/asset
 * (authoritative oks) -> gameobject modify -> asset import by content
 * address -> asset export mints an artifact ref -> editor action ->
 * editor script ok -> enter play mode -> build the player for android ->
 * lifecycle degraded refusal -> recover -> duplicate command id replay
 * (E10) -> same id different content conflict (E8) -> undeclared
 * capability refusal (E8/R13) -> cross-tenant dispatch refusal (R20) ->
 * deadline expiry (E8) -> client-claim rejection (E8) -> evidence ledger
 * append-only checks (E10) -> determinism: a second adapter with the same
 * seed reproduces the same command keys (E9) -> integration: the adapter
 * registers into the Tool Fabric runtime registry and executes through
 * the adapter-dispatch executor (PL-019 hosting pattern; R13) -> the
 * typed web/desktop/mobile engine binding serves web/windows/macos/
 * linux/android/ios target profiles and refuses a spark profile ->
 * closed refusal (terminal lifecycle). Prints deterministic
 * machine-readable JSON and exits non-zero on any unexpected outcome. No
 * IO beyond stdout; no wall clock (fake clock), no randomness (seeded),
 * no network.
 */

import { asTenantId } from "@playliquid/platform-contracts";
import { asEngineId } from "@playliquid/target-profiles";
import type { TargetProfileRecord } from "@playliquid/target-profiles";
import { createAdapterDispatchExecutor, createToolFabricRegistry } from "@playliquid/tool-fabric-runtime";
import { createUnityAdapter } from "./adapter.ts";
import { createFakeUnityBridge, createFakeUnityClock } from "./fake-bridge.ts";
import { UNITY_PAYLOAD_VERSION } from "./payload-model.ts";
import {
  createUnityEngineBinding,
  isProjectedEngineBindingRef,
  unityCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
} from "./engine-binding.ts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";

const tenant = asTenantId("tenant-harness")!;
const guid = (char: string): string => char.repeat(32);
const digest = (char: string): string => char.repeat(64);

function dispatch(commandId: string, capability: string, payload: unknown, overrides: Partial<AdapterCommandDispatch> = {}): AdapterCommandDispatch {
  return { kind: "adapter-command-dispatch", commandId, capability, payload, ...overrides };
}

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

/**
 * Minimal web/desktop/mobile-family profile fixture: the typed
 * compatibility predicate reads ONLY profile.target +
 * profile.engineBindings, so a core-only object is a faithful stand-in
 * for the sealed record (single typed cast; the engine-playcanvas /
 * engine-unreal harness fixture precedent).
 */
function profileOf(target: string, engines: readonly string[]): TargetProfileRecord {
  return {
    target,
    engineBindings: { engines: engines.map((engine) => asEngineId(engine)), pinnedBindings: null },
  } as unknown as TargetProfileRecord;
}

const bridge = createFakeUnityBridge({ seed: 1234 });
const clock = createFakeUnityClock(10_000);
const adapter = createUnityAdapter({ tenant, bridge, clock });

// 1. Registration state: dispatch before ready is refused (E8).
const notReady = await adapter.dispatch(dispatch("h1", "project.inspect", {
  version: UNITY_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  projectName: "MyGame",
}));
record("not-ready-refusal", "refused:adapter/not-ready", notReady.outcome === "refused" ? `refused:${notReady.refusal.code}` : notReady.outcome);

// 2. markReady through the contract validator.
const ready = adapter.markReady();
record("mark-ready", "ok:ready", `${ready.outcome}:${adapter.state}`);

// 3-8. Inspects: authoritative oks across the whole declared surface.
const inspect = await adapter.dispatch(dispatch("h2", "project.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", projectName: "MyGame",
}));
record("inspect-project", "ok:project.inspect", inspect.outcome === "ok" ? `ok:${(inspect.value as { capability: string }).capability}` : `${inspect.outcome}`);
const scene = await adapter.dispatch(dispatch("h3", "scene.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePath: "Assets/Scenes/Sandbox.unity",
}));
record("inspect-scene", "ok:scene.inspect", scene.outcome === "ok" ? `ok:${(scene.value as { capability: string }).capability}` : `${scene.outcome}`);
const gameObject = await adapter.dispatch(dispatch("h4", "gameobject.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera",
}));
record("inspect-gameobject", "ok:gameobject.inspect", gameObject.outcome === "ok" ? `ok:${(gameObject.value as { capability: string }).capability}` : `${gameObject.outcome}`);
const component = await adapter.dispatch(dispatch("h5", "component.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera", componentType: "Rigidbody",
}));
record("inspect-component", "ok:component.inspect", component.outcome === "ok" ? `ok:${(component.value as { capability: string }).capability}` : `${component.outcome}`);
const prefab = await adapter.dispatch(dispatch("h6", "prefab.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", assetGuid: guid("a"),
}));
record("inspect-prefab", "ok:prefab.inspect", prefab.outcome === "ok" ? `ok:${(prefab.value as { capability: string }).capability}` : `${prefab.outcome}`);
const asset = await adapter.dispatch(dispatch("h7", "asset.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", assetGuid: guid("b"),
}));
record("inspect-asset", "ok:asset.inspect", asset.outcome === "ok" ? `ok:${(asset.value as { capability: string }).capability}` : `${asset.outcome}`);

// 9. GameObject modify: applied edit count.
const modify = await adapter.dispatch(dispatch("h8", "gameobject.modify", {
  version: UNITY_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  scenePath: "Assets/Scenes/Sandbox.unity",
  objectPath: "Player/Main Camera",
  edits: [{ property: "position", value: [100, 20, 300] }],
}));
record("modify-gameobject", "ok:1", modify.outcome === "ok" ? `ok:${(modify.value as { appliedEdits: number }).appliedEdits}` : `${modify.outcome}`);

// 10. Import by content address.
const imported = await adapter.dispatch(dispatch("h9", "asset.import", {
  version: UNITY_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  destinationPath: "Assets/Imported/Hero.fbx",
  format: "fbx",
  artifact: { kind: "artifact-ref", digest: digest("c"), bytes: 4096 },
}));
record("import", "ok:4096", imported.outcome === "ok" ? `ok:${(imported.value as { importedBytes: number }).importedBytes}` : `${imported.outcome}`);

// 11. Export mints a fresh artifact ref.
const exported = await adapter.dispatch(dispatch("h10", "asset.export", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", assetGuid: guid("b"), format: "gltf", mode: "asset",
}));
const exportArtifact = exported.outcome === "ok" ? (exported.value as { artifact: { kind: string } }).artifact : undefined;
record("export", "artifact-ref", exportArtifact !== undefined ? "artifact-ref" : `${exported.outcome}`);

// 12. Editor action ok.
const action = await adapter.dispatch(dispatch("h11", "editor.action", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", action: "save-all",
}));
record("editor-action", "ok:save-all", action.outcome === "ok" ? `ok:${(action.value as { action: string }).action}` : `${action.outcome}`);

// 13. Editor script ok.
const script = await adapter.dispatch(dispatch("h12", "editor.script", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scriptDigest: digest("d"),
}));
record("editor-script", "ok:0", script.outcome === "ok" ? `ok:${(script.value as { exitCode: number }).exitCode}` : `${script.outcome}`);

// 14. Enter play mode for the scene.
const play = await adapter.dispatch(dispatch("h13", "scene.play", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePath: "Assets/Scenes/Sandbox.unity",
}));
record("scene-play", "ok:play-session", play.outcome === "ok" ? `ok:${(play.value as { playSessionId: string }).playSessionId.slice(0, 4) === "play" ? "play-session" : "other"}` : `${play.outcome}`);

// 15. Build the player for android, development.
const built = await adapter.dispatch(dispatch("h14", "build.player", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePaths: ["Assets/Scenes/Sandbox.unity"], targetPlatform: "android", configuration: "development",
}));
const buildId = built.outcome === "ok" ? (built.value as { buildId: string }).buildId : "";
record("build-player", `ok:${buildId}`, built.outcome === "ok" ? `ok:${(built.value as { buildId: string }).buildId}` : `${built.outcome}`);

// 16. Degraded refusal; recover.
adapter.reportDegraded();
const degraded = await adapter.dispatch(dispatch("h15", "project.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", projectName: "MyGame",
}));
record("degraded-refusal", "refused:adapter/degraded", degraded.outcome === "refused" ? `refused:${degraded.refusal.code}` : degraded.outcome);
adapter.markReady();

// 17. Duplicate command id: identical content replays the recorded result.
const first = await adapter.dispatch(dispatch("dup-1", "scene.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePath: "Assets/Scenes/Dup.unity",
}));
const replayed = await adapter.dispatch(dispatch("dup-1", "scene.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePath: "Assets/Scenes/Dup.unity",
}));
const sceneInvocations = bridge.invoked.filter((invocation) => invocation.capability === "scene.inspect" && (invocation.payload as { scenePath: string }).scenePath === "Assets/Scenes/Dup.unity").length;
record(
  "duplicate-replay",
  "same:1-invocation",
  `${JSON.stringify((replayed as { value: unknown }).value) === JSON.stringify((first as { value: unknown }).value) ? "same" : "different"}:${sceneInvocations}-invocation`,
);

// 18. Same id different content: typed conflict.
const conflict = await adapter.dispatch(dispatch("dup-1", "scene.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePath: "Assets/Scenes/OTHER.unity",
}));
record("command-id-conflict", "failed:unity/command-id-conflict", conflict.outcome === "failed" ? `failed:${conflict.error.code}` : conflict.outcome);

// 19. Undeclared capability (R13: only through Tool Fabric).
const undeclared = await adapter.dispatch(dispatch("h16", "build.launch", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", projectName: "MyGame",
}));
record("undeclared-capability", "refused:adapter-capability/not-declared", undeclared.outcome === "refused" ? `refused:${undeclared.refusal.code}` : undeclared.outcome);

// 20. Cross-tenant dispatch (R20).
const foreign = await adapter.dispatch(dispatch("h17", "project.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-foreign", projectName: "MyGame",
}));
record("cross-tenant", "failed:unity-tenancy/tenant-mismatch", foreign.outcome === "failed" ? `failed:${foreign.error.code}` : foreign.outcome);

// 21. Deadline expiry (E8).
clock.setTo(99_000);
const expired = await adapter.dispatch(dispatch("h18", "project.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", projectName: "MyGame",
}, { deadline: { atEpochMs: 20_000 } }));
record("deadline-expired", "failed:unity/deadline-expired", expired.outcome === "failed" ? `failed:${expired.error.code}` : expired.outcome);
clock.setTo(10_000);

// 22. Client-claim rejection (E8).
const claimed = await adapter.dispatch(dispatch("h19", "project.inspect", {
  version: UNITY_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  projectName: "MyGame",
  clientClaimed: true,
  claimedOutcome: "ok",
  claimedValue: { scenes: 999 },
}));
record("client-claim", "failed:unity/client-claim", claimed.outcome === "failed" ? `failed:${claimed.error.code}` : claimed.outcome);

// 23. Evidence ledger (E10): append-only, digest-pinned, replay visible.
const records = adapter.evidence.records;
const allDigested = records.every((item) => /^[a-f0-9]{64}$/.test(item.recordDigest));
const replayRecorded = records.some((item) => item.commandId === "dup-1" && item.outcome === "ok");
record("evidence-append-only", "true:true", `${allDigested}:${replayRecorded}`);

// 24. Determinism (E9): same seed, same inputs → same command keys.
const secondBridge = createFakeUnityBridge({ seed: 1234 });
const secondClock = createFakeUnityClock(10_000);
const secondAdapter = createUnityAdapter({ tenant, bridge: secondBridge, clock: secondClock });
secondAdapter.markReady();
const replays: readonly { readonly id: string; readonly capability: string; readonly payload: Record<string, unknown> }[] = [
  { id: "second-h2", capability: "project.inspect", payload: { version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", projectName: "MyGame" } },
  { id: "second-h3", capability: "scene.inspect", payload: { version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePath: "Assets/Scenes/Sandbox.unity" } },
  { id: "second-h8", capability: "gameobject.modify", payload: { version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera", edits: [{ property: "position", value: [100, 20, 300] }] } },
  { id: "second-h9", capability: "asset.import", payload: { version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", destinationPath: "Assets/Imported/Hero.fbx", format: "fbx", artifact: { kind: "artifact-ref", digest: digest("c"), bytes: 4096 } } },
  { id: "second-h14", capability: "build.player", payload: { version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", scenePaths: ["Assets/Scenes/Sandbox.unity"], targetPlatform: "android", configuration: "development" } },
];
for (const replay of replays) {
  await secondAdapter.dispatch(dispatch(replay.id, replay.capability, replay.payload));
}
const sameOutcomes = secondBridge.invoked.length === 5 && secondBridge.invoked.every((invocation) => bridge.invoked.some((original) => original.commandKey === invocation.commandKey));
record("determinism-same-command-keys", "true", String(sameOutcomes));

// 25. Tool Fabric runtime integration (R13): register + dispatch executor.
const registry = createToolFabricRegistry();
const registration = registry.register({
  descriptor: {
    identity: { namespace: "playliquid", name: "unity-asset-export" },
    surfaceVersion: { major: 1, minor: 0 },
    title: "Asset export",
    description: "Exports a content asset through the Unity engine adapter.",
    inputShape: { shapeId: "playliquid.shape/unity-export-input", revision: 1 },
    outputShape: { shapeId: "playliquid.shape/unity-export-output", revision: 1 },
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
      version: UNITY_PAYLOAD_VERSION,
      tenant: "tenant-harness",
      assetGuid: guid("b"),
      format: "gltf",
      mode: "asset",
    },
  });
  record(
    "fabric-execution",
    "executed",
    executed.outcome === "executed" ? "executed" : `${executed.outcome}:${executed.outcome === "refused" ? executed.code : ""}`,
  );
}

// 26-33. Typed engine binding: web/windows/macos/linux/android served, spark refused.
const binding = createUnityEngineBinding();
const webVerdict = unityCanServeTargetProfile(binding, profileOf("web", ["unity"]));
record("binding-web", "compatible:web", webVerdict.compatible ? `compatible:${webVerdict.target}` : `refused:${webVerdict.code}`);
const windowsVerdict = unityCanServeTargetProfile(binding, profileOf("windows", ["unity"]));
record("binding-windows", "compatible:windows", windowsVerdict.compatible ? `compatible:${windowsVerdict.target}` : `refused:${windowsVerdict.code}`);
const macosVerdict = unityCanServeTargetProfile(binding, profileOf("macos", ["unity"]));
record("binding-macos", "compatible:macos", macosVerdict.compatible ? `compatible:${macosVerdict.target}` : `refused:${macosVerdict.code}`);
const linuxVerdict = unityCanServeTargetProfile(binding, profileOf("linux", ["unity"]));
record("binding-linux", "compatible:linux", linuxVerdict.compatible ? `compatible:${linuxVerdict.target}` : `refused:${linuxVerdict.code}`);
const androidVerdict = unityCanServeTargetProfile(binding, profileOf("android", ["unity"]));
record("binding-android", "compatible:android", androidVerdict.compatible ? `compatible:${androidVerdict.target}` : `refused:${androidVerdict.code}`);
const iosVerdict = unityCanServeTargetProfile(binding, profileOf("ios", ["unity"]));
record("binding-ios", "compatible:ios", iosVerdict.compatible ? `compatible:${iosVerdict.target}` : `refused:${iosVerdict.code}`);
const sparkVerdict = unityCanServeTargetProfile(binding, profileOf("spark", ["unity"]));
record("binding-spark-refusal", "refused:unity-binding/profile-target-unsupported", sparkVerdict.compatible ? `compatible:${sparkVerdict.target}` : `refused:${sparkVerdict.code}`);
const projection = toBuildContractsEngineBindingRef(binding);
record("binding-projection", "true", String(isProjectedEngineBindingRef(projection)));

// 35. Closed is terminal (E8 lifecycle).
adapter.close();
const closed = await adapter.dispatch(dispatch("h20", "project.inspect", {
  version: UNITY_PAYLOAD_VERSION, tenant: "tenant-harness", projectName: "MyGame",
}));
record("closed-refusal", "refused:adapter/closed", closed.outcome === "refused" ? `refused:${closed.refusal.code}` : closed.outcome);

const failures = steps.filter((step) => step.expected !== step.actual);
console.log(JSON.stringify({ harness: "engine-unity", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) {
  process.exitCode = 1;
}
