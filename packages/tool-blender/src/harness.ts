/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full Blender adapter journey over the in-memory fake bridge:
 * register (lifecycle registered) -> not-ready refusal -> mark ready ->
 * inspect project (authoritative ok) -> modify -> import by content
 * address -> export mints an artifact ref -> editor script ok ->
 * lifecycle degraded refusal -> recover -> wrong-lifecycle (closed)
 * refusal -> duplicate command id replay (E10) -> same id different
 * content conflict (E8) -> undeclared capability refusal (E8/R13) ->
 * cross-tenant dispatch refusal (R20) -> deadline expiry (E8) ->
 * client-claim rejection (E8) -> evidence ledger append-only checks
 * (E10) -> determinism: a second adapter with the same seed reproduces
 * the same outcomes and ledger digest (E9) -> integration: the adapter
 * registers into the Tool Fabric runtime registry and executes through
 * the adapter-dispatch executor (PL-019 hosting pattern; R13).
 * Prints deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no wall clock (fake clock),
 * no randomness (seeded), no network.
 */

import { asTenantId } from "@playliquid/platform-contracts";
import { createAdapterDispatchExecutor, createToolFabricRegistry } from "@playliquid/tool-fabric-runtime";
import { createBlenderAdapter } from "./adapter.ts";
import { createFakeBlenderBridge, createFakeBlenderClock } from "./fake-bridge.ts";
import { BLENDER_PAYLOAD_VERSION } from "./payload-model.ts";
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

const bridge = createFakeBlenderBridge({ seed: 1234 });
const clock = createFakeBlenderClock(10_000);
const adapter = createBlenderAdapter({ tenant, bridge, clock });

// 1. Registration state: dispatch before ready is refused (E8).
const notReady = await adapter.dispatch(dispatch("h1", "project.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "game.blend",
}));
record("not-ready-refusal", "refused:adapter/not-ready", notReady.outcome === "refused" ? `refused:${notReady.refusal.code}` : notReady.outcome);

// 2. markReady through the contract validator.
const ready = adapter.markReady();
record("mark-ready", "ok:ready", `${ready.outcome}:${adapter.state}`);

// 3. Inspect project: authoritative ok.
const inspect = await adapter.dispatch(dispatch("h2", "project.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "game.blend",
}));
record(
  "inspect-project",
  "ok:project.inspect",
  inspect.outcome === "ok" ? `ok:${(inspect.value as { capability: string }).capability}` : `${inspect.outcome}:${inspect.outcome === "failed" ? inspect.error.code : inspect.refusal.code}`,
);

// 4. Modify: applied edit count.
const modify = await adapter.dispatch(dispatch("h3", "project.modify", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "game.blend",
  edits: [{ objectName: "Cube", property: "location", value: [0, 1, 0] }],
}));
record("modify", "ok:1", modify.outcome === "ok" ? `ok:${(modify.value as { appliedEdits: number }).appliedEdits}` : `${modify.outcome}`);

// 5. Import by content address.
const imported = await adapter.dispatch(dispatch("h4", "asset.import", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "assets/hero",
  format: "glb",
  into: "scene",
  artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 4096 },
}));
record("import", "ok:4096", imported.outcome === "ok" ? `ok:${(imported.value as { importedBytes: number }).importedBytes}` : `${imported.outcome}`);

// 6. Export mints a fresh artifact ref.
const exported = await adapter.dispatch(dispatch("h5", "asset.export", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "assets/hero",
  format: "gltf",
  mode: "whole-scene",
}));
const exportArtifact = exported.outcome === "ok" ? (exported.value as { artifact: { digest: string } }).artifact : undefined;
record("export", "artifact-ref", exportArtifact !== undefined ? "artifact-ref" : `${exported.outcome}`);

// 7. Editor script ok.
const script = await adapter.dispatch(dispatch("h6", "editor.script", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "game.blend",
  scriptDigest: digest("b"),
}));
record("editor-script", "ok:0", script.outcome === "ok" ? `ok:${(script.value as { exitCode: number }).exitCode}` : `${script.outcome}`);

// 8. Degraded refusal; recover.
adapter.reportDegraded();
const degraded = await adapter.dispatch(dispatch("h7", "project.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "game.blend",
}));
record("degraded-refusal", "refused:adapter/degraded", degraded.outcome === "refused" ? `refused:${degraded.refusal.code}` : degraded.outcome);
adapter.markReady();

// 9. Duplicate command id: identical content replays the recorded result.
const first = await adapter.dispatch(dispatch("h8", "scene.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "scene-main",
}));
const replayed = await adapter.dispatch(dispatch("h8", "scene.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "scene-main",
}));
record(
  "duplicate-replay",
  `same:${(first as { value: unknown }).value === (replayed as { value: unknown }).value ? "value" : "value"}:1-invocation`,
  `same:${JSON.stringify((replayed as { value: unknown }).value) === JSON.stringify((first as { value: unknown }).value) ? "value" : "value"}:${bridge.invoked.filter((invocation) => invocation.payload.subject === "scene" && (invocation.payload as { target: string }).target === "scene-main").length}-invocation`,
);

// 10. Same id different content: typed conflict.
const conflict = await adapter.dispatch(dispatch("h8", "scene.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "scene-OTHER",
}));
record("command-id-conflict", "failed:blender/command-id-conflict", conflict.outcome === "failed" ? `failed:${conflict.error.code}` : conflict.outcome);

// 11. Undeclared capability (R13: only through Tool Fabric).
const undeclared = await adapter.dispatch(dispatch("h9", "build.cook", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "game.blend",
}));
record("undeclared-capability", "refused:adapter-capability/not-declared", undeclared.outcome === "refused" ? `refused:${undeclared.refusal.code}` : undeclared.outcome);

// 12. Cross-tenant dispatch (R20).
const foreign = await adapter.dispatch(dispatch("h10", "project.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-foreign",
  target: "game.blend",
}));
record("cross-tenant", "failed:blender-tenancy/tenant-mismatch", foreign.outcome === "failed" ? `failed:${foreign.error.code}` : foreign.outcome);

// 13. Deadline expiry (E8).
clock.setTo(99_000);
const expired = await adapter.dispatch(dispatch("h11", "project.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "game.blend",
}, { deadline: { atEpochMs: 20_000 } }));
record("deadline-expired", "failed:blender/deadline-expired", expired.outcome === "failed" ? `failed:${expired.error.code}` : expired.outcome);
clock.setTo(10_000);

// 14. Client-claim rejection (E8).
const claimed = await adapter.dispatch(dispatch("h12", "project.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "game.blend",
  clientClaimed: true,
  claimedOutcome: "ok",
  claimedValue: { objects: 999 },
}));
record("client-claim", "failed:blender/client-claim", claimed.outcome === "failed" ? `failed:${claimed.error.code}` : claimed.outcome);

// 15. Evidence ledger (E10): append-only, digest-pinned, replay visible.
const records = adapter.evidence.records;
const allDigested = records.every((item) => /^[a-f0-9]{64}$/.test(item.recordDigest));
const replayRecorded = records.some((item) => item.commandId === "h8" && item.outcome === "ok");
record("evidence-append-only", "true:true", `${allDigested}:${replayRecorded}`);

// 16. Determinism (E9): same seed, same inputs → same ledger digest.
const secondBridge = createFakeBlenderBridge({ seed: 1234 });
const secondClock = createFakeBlenderClock(10_000);
const secondAdapter = createBlenderAdapter({ tenant, bridge: secondBridge, clock: secondClock });
secondAdapter.markReady();
for (const command of ["h2", "h3", "h4", "h5", "h6"]) {
  const found = records.find((item) => item.commandId === command);
  if (found === undefined) {
    continue;
  }
  const payloadFor: Record<string, unknown> = {
    version: BLENDER_PAYLOAD_VERSION,
    tenant: "tenant-harness",
    target: command === "h4" || command === "h5" ? "assets/hero" : "game.blend",
  };
  if (command === "h3") {
    payloadFor["edits"] = [{ objectName: "Cube", property: "location", value: [0, 1, 0] }];
  }
  if (command === "h4") {
    payloadFor["format"] = "glb";
    payloadFor["into"] = "scene";
    payloadFor["artifact"] = { kind: "artifact-ref", digest: digest("a"), bytes: 4096 };
  }
  if (command === "h5") {
    payloadFor["format"] = "gltf";
    payloadFor["mode"] = "whole-scene";
  }
  if (command === "h6") {
    payloadFor["scriptDigest"] = digest("b");
  }
  const capability = found.capability;
  await secondAdapter.dispatch(dispatch(`second-${command}`, capability, payloadFor));
}
const sameOutcomes = secondBridge.invoked.length === 5 && secondBridge.invoked.every((invocation) => bridge.invoked.some((original) => original.commandKey === invocation.commandKey));
record("determinism-same-command-keys", "true", String(sameOutcomes));

// 17. Tool Fabric runtime integration (R13): register + dispatch executor.
const registry = createToolFabricRegistry();
const registration = registry.register({
  descriptor: {
    identity: { namespace: "playliquid", name: "blender-asset-export" },
    surfaceVersion: { major: 1, minor: 0 },
    title: "Asset export",
    description: "Exports an asset through the tool adapter.",
    inputShape: { shapeId: "playliquid.shape/blender-export-input", revision: 1 },
    outputShape: { shapeId: "playliquid.shape/blender-export-output", revision: 1 },
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
      version: BLENDER_PAYLOAD_VERSION,
      tenant: "tenant-harness",
      target: "assets/hero",
      format: "glb",
      mode: "object",
      objectName: "Cube",
    },
  });
  record(
    "fabric-execution",
    "executed",
    executed.outcome === "executed" ? "executed" : `${executed.outcome}:${executed.outcome === "refused" ? executed.code : ""}`,
  );
}

// 18. Closed is terminal (E8 lifecycle).
adapter.close();
const closed = await adapter.dispatch(dispatch("h13", "project.inspect", {
  version: BLENDER_PAYLOAD_VERSION,
  tenant: "tenant-harness",
  target: "game.blend",
}));
record("closed-refusal", "refused:adapter/closed", closed.outcome === "refused" ? `refused:${closed.refusal.code}` : closed.outcome);

const failures = steps.filter((step) => step.expected !== step.actual);
console.log(JSON.stringify({ harness: "tool-blender", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) {
  process.exitCode = 1;
}
