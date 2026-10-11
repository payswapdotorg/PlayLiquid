/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full Unreal adapter journey over the in-memory fake
 * bridge: register (lifecycle registered) -> not-ready refusal ->
 * mark ready -> inspect project/level/actor/component/asset
 * (authoritative oks) -> actor modify -> asset import by content
 * address -> asset export mints an artifact ref -> editor action ->
 * editor script ok -> PIE run -> cook the project for windows ->
 * package the cooked build -> lifecycle degraded refusal -> recover ->
 * duplicate command id replay (E10) -> same id different content
 * conflict (E8) -> undeclared capability refusal (E8/R13) ->
 * cross-tenant dispatch refusal (R20) -> deadline expiry (E8) ->
 * client-claim rejection (E8) -> evidence ledger append-only checks
 * (E10) -> determinism: a second adapter with the same seed reproduces
 * the same command keys (E9) -> integration: the adapter registers
 * into the Tool Fabric runtime registry and executes through the
 * adapter-dispatch executor (PL-019 hosting pattern; R13) -> the typed
 * desktop-class engine binding serves windows/macos/linux target
 * profiles and refuses a web profile -> closed refusal (terminal
 * lifecycle). Prints deterministic machine-readable JSON and exits
 * non-zero on any unexpected outcome. No IO beyond stdout; no wall
 * clock (fake clock), no randomness (seeded), no network.
 */

import { asTenantId } from "@playliquid/platform-contracts";
import { asEngineId } from "@playliquid/target-profiles";
import type { TargetProfileRecord } from "@playliquid/target-profiles";
import { createAdapterDispatchExecutor, createToolFabricRegistry } from "@playliquid/tool-fabric-runtime";
import { createUnrealAdapter } from "./adapter.ts";
import { createFakeUnrealBridge, createFakeUnrealClock } from "./fake-bridge.ts";
import { UNREAL_PAYLOAD_VERSION } from "./payload-model.ts";
import {
  createUnrealEngineBinding,
  isProjectedEngineBindingRef,
  unrealCanServeTargetProfile,
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
 * Minimal desktop-family profile fixture: the typed compatibility predicate
 * reads ONLY profile.target + profile.engineBindings, so a core-only
 * object is a faithful stand-in for the sealed record (single typed
 * cast; the engine-playcanvas harness fixture precedent).
 */
function profileOf(target: string, engines: readonly string[]): TargetProfileRecord {
  return {
    target,
    engineBindings: { engines: engines.map((engine) => asEngineId(engine)), pinnedBindings: null },
  } as unknown as TargetProfileRecord;
}

const bridge = createFakeUnrealBridge({ seed: 1234 });
const clock = createFakeUnrealClock(10_000);
const adapter = createUnrealAdapter({ tenant, bridge, clock });

// 1. Registration state: dispatch before ready is refused (E8).
const notReady = await adapter.dispatch(dispatch("h1", "project.inspect", {
  version: UNREAL_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "MyGame",
}));
record("not-ready-refusal", "refused:adapter/not-ready", notReady.outcome === "refused" ? `refused:${notReady.refusal.code}` : notReady.outcome);

// 2. markReady through the contract validator.
const ready = adapter.markReady();
record("mark-ready", "ok:ready", `${ready.outcome}:${adapter.state}`);

// 3-7. Inspects: authoritative oks across the whole declared surface.
const inspect = await adapter.dispatch(dispatch("h2", "project.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "MyGame",
}));
record("inspect-project", "ok:project.inspect", inspect.outcome === "ok" ? `ok:${(inspect.value as { capability: string }).capability}` : `${inspect.outcome}`);
const level = await adapter.dispatch(dispatch("h3", "level.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Maps/L_Sandbox",
}));
record("inspect-level", "ok:level.inspect", level.outcome === "ok" ? `ok:${(level.value as { capability: string }).capability}` : `${level.outcome}`);
const actor = await adapter.dispatch(dispatch("h4", "actor.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1",
}));
record("inspect-actor", "ok:actor.inspect", actor.outcome === "ok" ? `ok:${(actor.value as { capability: string }).capability}` : `${actor.outcome}`);
const component = await adapter.dispatch(dispatch("h5", "component.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1", componentName: "StaticMeshComponent_0",
}));
record("inspect-component", "ok:component.inspect", component.outcome === "ok" ? `ok:${(component.value as { capability: string }).capability}` : `${component.outcome}`);
const asset = await adapter.dispatch(dispatch("h6", "asset.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Characters/Hero/Mesh/SK_Hero",
}));
record("inspect-asset", "ok:asset.inspect", asset.outcome === "ok" ? `ok:${(asset.value as { capability: string }).capability}` : `${asset.outcome}`);

// 8. Actor modify: applied edit count.
const modify = await adapter.dispatch(dispatch("h7", "actor.modify", {
  version: UNREAL_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "/Game/Maps/L_Sandbox",
  actorName: "BP_Player_C_1",
  edits: [{ property: "location", value: [100, 20, 300] }],
}));
record("modify-actor", "ok:1", modify.outcome === "ok" ? `ok:${(modify.value as { appliedEdits: number }).appliedEdits}` : `${modify.outcome}`);

// 9. Import by content address.
const imported = await adapter.dispatch(dispatch("h8", "asset.import", {
  version: UNREAL_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "/Game/Imported/Hero",
  format: "fbx",
  artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 4096 },
}));
record("import", "ok:4096", imported.outcome === "ok" ? `ok:${(imported.value as { importedBytes: number }).importedBytes}` : `${imported.outcome}`);

// 10. Export mints a fresh artifact ref.
const exported = await adapter.dispatch(dispatch("h9", "asset.export", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Characters/Hero/Mesh/SK_Hero", format: "usd", mode: "asset",
}));
const exportArtifact = exported.outcome === "ok" ? (exported.value as { artifact: { kind: string } }).artifact : undefined;
record("export", "artifact-ref", exportArtifact !== undefined ? "artifact-ref" : `${exported.outcome}`);

// 11. Editor action ok.
const action = await adapter.dispatch(dispatch("h10", "editor.action", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", action: "save-all",
}));
record("editor-action", "ok:save-all", action.outcome === "ok" ? `ok:${(action.value as { action: string }).action}` : `${action.outcome}`);

// 12. Editor script ok.
const script = await adapter.dispatch(dispatch("h11", "editor.script", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", scriptDigest: digest("b"),
}));
record("editor-script", "ok:0", script.outcome === "ok" ? `ok:${(script.value as { exitCode: number }).exitCode}` : `${script.outcome}`);

// 13. PIE run of the level.
const pie = await adapter.dispatch(dispatch("h12", "level.pie", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Maps/L_Sandbox", players: 2,
}));
record("level-pie", "ok:2", pie.outcome === "ok" ? `ok:${(pie.value as { players: number }).players}` : `${pie.outcome}`);

// 14. Cook the project for windows, development.
const cook = await adapter.dispatch(dispatch("h13", "build.cook", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "MyGame", targetPlatform: "windows", configuration: "development",
}));
record("build-cook", "ok:windows", cook.outcome === "ok" ? `ok:${(cook.value as { targetPlatform: string }).targetPlatform}` : `${cook.outcome}`);

// 15. Package the cooked build.
const packaged = await adapter.dispatch(dispatch("h14", "build.package", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "MyGame", targetPlatform: "windows", configuration: "shipping",
}));
const buildId = packaged.outcome === "ok" ? (packaged.value as { buildId: string }).buildId : "";
record("build-package", `ok:${buildId}`, packaged.outcome === "ok" ? `ok:${(packaged.value as { buildId: string }).buildId}` : `${packaged.outcome}`);

// 16. Degraded refusal; recover.
adapter.reportDegraded();
const degraded = await adapter.dispatch(dispatch("h15", "project.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "MyGame",
}));
record("degraded-refusal", "refused:adapter/degraded", degraded.outcome === "refused" ? `refused:${degraded.refusal.code}` : degraded.outcome);
adapter.markReady();

// 17. Duplicate command id: identical content replays the recorded result.
const first = await adapter.dispatch(dispatch("dup-1", "level.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Maps/L_Dup",
}));
const replayed = await adapter.dispatch(dispatch("dup-1", "level.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Maps/L_Dup",
}));
const levelInvocations = bridge.invoked.filter((invocation) => invocation.capability === "level.inspect" && (invocation.payload as { target: string }).target === "/Game/Maps/L_Dup").length;
record(
  "duplicate-replay",
  "same:1-invocation",
  `${JSON.stringify((replayed as { value: unknown }).value) === JSON.stringify((first as { value: unknown }).value) ? "same" : "different"}:${levelInvocations}-invocation`,
);

// 18. Same id different content: typed conflict.
const conflict = await adapter.dispatch(dispatch("dup-1", "level.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Maps/L_OTHER",
}));
record("command-id-conflict", "failed:unreal/command-id-conflict", conflict.outcome === "failed" ? `failed:${conflict.error.code}` : conflict.outcome);

// 19. Undeclared capability (R13: only through Tool Fabric).
const undeclared = await adapter.dispatch(dispatch("h16", "build.launch", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "MyGame",
}));
record("undeclared-capability", "refused:adapter-capability/not-declared", undeclared.outcome === "refused" ? `refused:${undeclared.refusal.code}` : undeclared.outcome);

// 20. Cross-tenant dispatch (R20).
const foreign = await adapter.dispatch(dispatch("h17", "project.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-foreign", target: "MyGame",
}));
record("cross-tenant", "failed:unreal-tenancy/tenant-mismatch", foreign.outcome === "failed" ? `failed:${foreign.error.code}` : foreign.outcome);

// 21. Deadline expiry (E8).
clock.setTo(99_000);
const expired = await adapter.dispatch(dispatch("h18", "project.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "MyGame",
}, { deadline: { atEpochMs: 20_000 } }));
record("deadline-expired", "failed:unreal/deadline-expired", expired.outcome === "failed" ? `failed:${expired.error.code}` : expired.outcome);
clock.setTo(10_000);

// 22. Client-claim rejection (E8).
const claimed = await adapter.dispatch(dispatch("h19", "project.inspect", {
  version: UNREAL_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "MyGame",
  clientClaimed: true,
  claimedOutcome: "ok",
  claimedValue: { modules: 999 },
}));
record("client-claim", "failed:unreal/client-claim", claimed.outcome === "failed" ? `failed:${claimed.error.code}` : claimed.outcome);

// 23. Evidence ledger (E10): append-only, digest-pinned, replay visible.
const records = adapter.evidence.records;
const allDigested = records.every((item) => /^[a-f0-9]{64}$/.test(item.recordDigest));
const replayRecorded = records.some((item) => item.commandId === "dup-1" && item.outcome === "ok");
record("evidence-append-only", "true:true", `${allDigested}:${replayRecorded}`);

// 24. Determinism (E9): same seed, same inputs → same command keys.
const secondBridge = createFakeUnrealBridge({ seed: 1234 });
const secondClock = createFakeUnrealClock(10_000);
const secondAdapter = createUnrealAdapter({ tenant, bridge: secondBridge, clock: secondClock });
secondAdapter.markReady();
const replays: readonly { readonly id: string; readonly capability: string; readonly payload: Record<string, unknown> }[] = [
  { id: "second-h2", capability: "project.inspect", payload: { version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "MyGame" } },
  { id: "second-h3", capability: "level.inspect", payload: { version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Maps/L_Sandbox" } },
  { id: "second-h7", capability: "actor.modify", payload: { version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1", edits: [{ property: "location", value: [100, 20, 300] }] } },
  { id: "second-h8", capability: "asset.import", payload: { version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "/Game/Imported/Hero", format: "fbx", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 4096 } } },
  { id: "second-h13", capability: "build.cook", payload: { version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "MyGame", targetPlatform: "windows", configuration: "development" } },
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
    identity: { namespace: "playliquid", name: "unreal-asset-export" },
    surfaceVersion: { major: 1, minor: 0 },
    title: "Asset export",
    description: "Exports a content asset through the desktop-class engine adapter.",
    inputShape: { shapeId: "playliquid.shape/unreal-export-input", revision: 1 },
    outputShape: { shapeId: "playliquid.shape/unreal-export-output", revision: 1 },
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
      version: UNREAL_PAYLOAD_VERSION,
      tenant: "tenant-harness",
      target: "/Game/Characters/Hero/Mesh/SK_Hero",
      format: "usd",
      mode: "asset",
    },
  });
  record(
    "fabric-execution",
    "executed",
    executed.outcome === "executed" ? "executed" : `${executed.outcome}:${executed.outcome === "refused" ? executed.code : ""}`,
  );
}

// 26. Typed desktop-class engine binding: windows/macos/linux served, web refused.
const binding = createUnrealEngineBinding();
const windowsVerdict = unrealCanServeTargetProfile(binding, profileOf("windows", ["unreal"]));
record("binding-windows", "compatible:windows", windowsVerdict.compatible ? `compatible:${windowsVerdict.target}` : `refused:${windowsVerdict.code}`);
const macosVerdict = unrealCanServeTargetProfile(binding, profileOf("macos", ["unreal"]));
record("binding-macos", "compatible:macos", macosVerdict.compatible ? `compatible:${macosVerdict.target}` : `refused:${macosVerdict.code}`);
const linuxVerdict = unrealCanServeTargetProfile(binding, profileOf("linux", ["unreal"]));
record("binding-linux", "compatible:linux", linuxVerdict.compatible ? `compatible:${linuxVerdict.target}` : `refused:${linuxVerdict.code}`);
const webVerdict = unrealCanServeTargetProfile(binding, profileOf("web", ["unreal"]));
record("binding-web-refusal", "refused:unreal-binding/profile-target-unsupported", webVerdict.compatible ? `compatible:${webVerdict.target}` : `refused:${webVerdict.code}`);
const projection = toBuildContractsEngineBindingRef(binding);
record("binding-projection", "true", String(isProjectedEngineBindingRef(projection)));

// 27. Closed is terminal (E8 lifecycle).
adapter.close();
const closed = await adapter.dispatch(dispatch("h20", "project.inspect", {
  version: UNREAL_PAYLOAD_VERSION, tenant: "tenant-harness", target: "MyGame",
}));
record("closed-refusal", "refused:adapter/closed", closed.outcome === "refused" ? `refused:${closed.refusal.code}` : closed.outcome);

const failures = steps.filter((step) => step.expected !== step.actual);
console.log(JSON.stringify({ harness: "engine-unreal", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) {
  process.exitCode = 1;
}
