/**
 * THE E8 NEGATIVE BATTERY, part 1 (PL-021) — capability, dispatch-shape
 * and payload rejection codes (each code exercised). Part 2 covers trust,
 * lifecycle, tenancy and bridge failures; part 3 the binding refusals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";
import { createPlayCanvasAdapter } from "./adapter.ts";
import { createFakePlayCanvasBridge, createFakePlayCanvasClock } from "./fake-bridge.ts";
import { PLAYCANVAS_PAYLOAD_VERSION, payloadFamilyFor } from "./payload-model.ts";
import { validatePlayCanvasCommandPayload } from "./payload-validate.ts";

const tenant = asTenantId("tenant-alpha")!;
const digest = (char: string): string => char.repeat(64);

function makeAdapter(script?: Parameters<typeof createFakePlayCanvasBridge>[0]["script"]) {
  const bridge = createFakePlayCanvasBridge({ seed: 7, script });
  const clock = createFakePlayCanvasClock(10_000);
  const adapter = createPlayCanvasAdapter({ tenant, bridge, clock });
  adapter.markReady();
  return { adapter, bridge, clock };
}

function dispatch(commandId: string, capability: string, payload: unknown, overrides: Record<string, unknown> = {}): AdapterCommandDispatch {
  return {
    kind: "adapter-command-dispatch",
    commandId,
    capability,
    payload,
    ...overrides,
  } as AdapterCommandDispatch;
}

// --- 1. Undeclared capability ---

test("E8: dispatch to an undeclared capability is a typed refusal", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-x", "build.cook", {
    version: PLAYCANVAS_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "projects/game",
  }));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter-capability/not-declared");
    assert.equal(result.refusal.capability, "build.cook");
  }
});

test("E8: every capability NOT in the fixed surface is refused", async () => {
  const { adapter } = makeAdapter();
  for (const capability of ["build.cook", "package.sign", "profile.capture", "test.run", "debug.attach", "launch.player", "replay.record", "scene.render"]) {
    const result = await adapter.dispatch(dispatch(`cmd-x-${capability}`, capability, {
      version: PLAYCANVAS_PAYLOAD_VERSION,
      tenant: "tenant-alpha",
      target: "projects/game",
    }));
    assert.equal(result.outcome, "refused", capability);
    if (result.outcome === "refused") {
      assert.equal(result.refusal.code, "adapter-capability/not-declared");
    }
  }
});

// --- 2. Malformed neutral dispatch — each exchange rejection code exercised ---

test("E8: non-object dispatch → exchange/dispatch-not-an-object", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch("not-an-object" as unknown as AdapterCommandDispatch);
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter/invalid-dispatch");
    assert.match(result.refusal.message, /must be a non-array object/);
  }
});

test("E8: wrong kind → exchange/dispatch-kind; bad commandId → command-id codes", async () => {
  const { adapter } = makeAdapter();
  const wrongKind = await adapter.dispatch({
    kind: "something-else",
    commandId: "c1",
    capability: "project.inspect",
    payload: {},
  } as unknown as AdapterCommandDispatch);
  assert.equal(wrongKind.outcome, "refused");
  if (wrongKind.outcome === "refused") {
    assert.match(wrongKind.refusal.message, /adapter-command-dispatch/);
  }

  const emptyId = await adapter.dispatch(dispatch("", "project.inspect", {}));
  assert.equal(emptyId.outcome, "refused");
  if (emptyId.outcome === "refused") {
    assert.match(emptyId.refusal.message, /commandId must be a non-empty string/);
  }

  const longId = await adapter.dispatch(dispatch("x".repeat(129), "project.inspect", {}));
  assert.equal(longId.outcome, "refused");
  if (longId.outcome === "refused") {
    assert.match(longId.refusal.message, /at most 128/);
  }
});

test("E8: invalid capability id in dispatch → exchange/capability-invalid", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch({
    kind: "adapter-command-dispatch",
    commandId: "c2",
    capability: "NOT_A_VALID_ID",
    payload: {},
  } as unknown as AdapterCommandDispatch);
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.match(result.refusal.message, /capability invalid/);
  }
});

test("E8: malformed deadline → exchange/deadline-invalid", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("c3", "project.inspect", {
    version: PLAYCANVAS_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "projects/game",
  }, { deadline: { atEpochMs: -5 } as never }));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.match(result.refusal.message, /atEpochMs/);
  }
});

// --- 3. Malformed PlayCanvas payload — each payload rejection code exercised ---

test("E8: payload not-an-object → playcanvas-payload/not-an-object", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("p1", "project.inspect", "a string"));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    // A non-object payload cannot carry a tenant claim, so the tenancy gate
    // fires first (R20 ordering); the code is asserted directly below.
    assert.equal(result.error.code, "playcanvas-tenancy/tenant-not-a-string");
  }
  const check = validatePlayCanvasCommandPayload("project.inspect", "a string");
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    assert.equal(check.rejections[0]?.code, "playcanvas-payload/not-an-object");
  }
});

test("E8: payload version missing/wrong → version codes", async () => {
  const { adapter } = makeAdapter();
  const missing = await adapter.dispatch(dispatch("p2", "project.inspect", { tenant: "tenant-alpha", target: "projects/game" }));
  assert.equal(missing.outcome, "failed");
  if (missing.outcome === "failed") {
    assert.match(missing.error.message, /payload\.version/);
  }
  const wrong = await adapter.dispatch(dispatch("p3", "project.inspect", { version: 99, tenant: "tenant-alpha", target: "projects/game" }));
  assert.equal(wrong.outcome, "failed");
  if (wrong.outcome === "failed") {
    assert.match(wrong.error.message, /payload\.version/);
  }
});

test("E8: payload target missing/invalid → target codes", async () => {
  const { adapter } = makeAdapter();
  const missing = await adapter.dispatch(dispatch("p4", "scene.inspect", { version: 1, tenant: "tenant-alpha" }));
  assert.equal(missing.outcome, "failed");
  if (missing.outcome === "failed") {
    assert.match(missing.error.message, /payload\.target/);
  }
  const invalid = await adapter.dispatch(dispatch("p5", "scene.inspect", { version: 1, tenant: "tenant-alpha", target: "../etc/passwd" }));
  assert.equal(invalid.outcome, "failed");
  if (invalid.outcome === "failed") {
    assert.match(invalid.error.message, /payload\.target/);
  }
});

test("E8: subject contradicting the capability → subject-mismatch", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("p6", "scene.inspect", {
    version: 1,
    tenant: "tenant-alpha",
    subject: "project",
    target: "scene-main",
  }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.match(result.error.message, /subject/);
  }
});

test("E8: import format + artifact + into rejection codes", async () => {
  const { adapter } = makeAdapter();
  const badFormat = await adapter.dispatch(dispatch("p7", "asset.import", {
    version: 1,
    tenant: "tenant-alpha",
    target: "assets/hero",
    format: "exe",
    into: "scene",
    artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  }));
  assert.equal(badFormat.outcome, "failed");
  if (badFormat.outcome === "failed") {
    assert.match(badFormat.error.message, /payload\.format/);
  }
  const badArtifact = await adapter.dispatch(dispatch("p8", "asset.import", {
    version: 1,
    tenant: "tenant-alpha",
    target: "assets/hero",
    format: "glb",
    into: "scene",
    artifact: { kind: "artifact-ref", digest: "nothex", bytes: -1 },
  }));
  assert.equal(badArtifact.outcome, "failed");
  if (badArtifact.outcome === "failed") {
    assert.match(badArtifact.error.message, /payload\.artifact/);
  }
  const badInto = await adapter.dispatch(dispatch("p9", "asset.import", {
    version: 1,
    tenant: "tenant-alpha",
    target: "assets/hero",
    format: "glb",
    into: "garage",
    artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  }));
  assert.equal(badInto.outcome, "failed");
  if (badInto.outcome === "failed") {
    assert.match(badInto.error.message, /payload\.into/);
  }
});

test("E8: modify edits rejection codes (missing/entry/property/entity-name)", async () => {
  const { adapter } = makeAdapter();
  const missing = await adapter.dispatch(dispatch("p10", "project.modify", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
  }));
  assert.equal(missing.outcome, "failed");
  if (missing.outcome === "failed") {
    assert.match(missing.error.message, /payload\.edits/);
  }
  const badEntry = await adapter.dispatch(dispatch("p11", "project.modify", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
    edits: [{ entityName: "Entity-Cube" }],
  }));
  assert.equal(badEntry.outcome, "failed");
  if (badEntry.outcome === "failed") {
    assert.match(badEntry.error.message, /edits\[0\]/);
  }
  const badProperty = await adapter.dispatch(dispatch("p12", "project.modify", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
    edits: [{ entityName: "Entity-Cube", property: "NOT-KEBAB", value: 1 }],
  }));
  assert.equal(badProperty.outcome, "failed");
  if (badProperty.outcome === "failed") {
    assert.match(badProperty.error.message, /edits\[0\]\.property/);
  }
  const badName = await adapter.dispatch(dispatch("p13", "project.modify", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
    edits: [{ entityName: "#bad", property: "scale", value: 1 }],
  }));
  assert.equal(badName.outcome, "failed");
  if (badName.outcome === "failed") {
    assert.match(badName.error.message, /edits\[0\]\.entityName/);
  }
});

test("E8: export mode/entity-name + scene action/script codes", async () => {
  const { adapter } = makeAdapter();
  const badMode = await adapter.dispatch(dispatch("p14", "asset.export", {
    version: 1,
    tenant: "tenant-alpha",
    target: "assets/hero",
    format: "gltf",
    mode: "half-scene",
  }));
  assert.equal(badMode.outcome, "failed");
  if (badMode.outcome === "failed") {
    assert.match(badMode.error.message, /payload\.mode/);
  }
  const badEntityName = await adapter.dispatch(dispatch("p14b", "asset.export", {
    version: 1,
    tenant: "tenant-alpha",
    target: "assets/hero",
    format: "gltf",
    mode: "entity",
    entityName: "#nope",
  }));
  assert.equal(badEntityName.outcome, "failed");
  if (badEntityName.outcome === "failed") {
    assert.match(badEntityName.error.message, /payload\.entityName/);
  }
  const badAction = await adapter.dispatch(dispatch("p15", "scene.action", {
    version: 1,
    tenant: "tenant-alpha",
    action: "NOT KEBAB",
    target: "scene-main",
  }));
  assert.equal(badAction.outcome, "failed");
  if (badAction.outcome === "failed") {
    assert.match(badAction.error.message, /payload\.action/);
  }
  const badScript = await adapter.dispatch(dispatch("p16", "scene.script", {
    version: 1,
    tenant: "tenant-alpha",
    target: "scene-main",
    scriptDigest: "xyz",
  }));
  assert.equal(badScript.outcome, "failed");
  if (badScript.outcome === "failed") {
    assert.match(badScript.error.message, /payload\.scriptDigest/);
  }
});

test("E8: build publish channel + build play id codes", async () => {
  const { adapter } = makeAdapter();
  const badChannel = await adapter.dispatch(dispatch("p17", "build.publish", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
    channel: "native",
  }));
  assert.equal(badChannel.outcome, "failed");
  if (badChannel.outcome === "failed") {
    assert.match(badChannel.error.message, /payload\.channel/);
  }
  const badBuildId = await adapter.dispatch(dispatch("p18", "build.play", {
    version: 1,
    tenant: "tenant-alpha",
    target: "projects/game",
    buildId: "NOT A BUILD",
  }));
  assert.equal(badBuildId.outcome, "failed");
  if (badBuildId.outcome === "failed") {
    assert.match(badBuildId.error.message, /payload\.buildId/);
  }
});

test("E8: fixed-action codes (scene.script/build.publish/build.play)", async () => {
  const { adapter } = makeAdapter();
  const wrongScriptAction = await adapter.dispatch(dispatch("p19", "scene.script", {
    version: 1,
    tenant: "tenant-alpha",
    action: "stop-script",
    target: "scene-main",
    scriptDigest: digest("b"),
  }));
  assert.equal(wrongScriptAction.outcome, "failed");
  if (wrongScriptAction.outcome === "failed") {
    assert.match(wrongScriptAction.error.message, /run-script/);
  }
  const wrongPublishAction = await adapter.dispatch(dispatch("p20", "build.publish", {
    version: 1,
    tenant: "tenant-alpha",
    action: "retract",
    target: "projects/game",
    channel: "web",
  }));
  assert.equal(wrongPublishAction.outcome, "failed");
  if (wrongPublishAction.outcome === "failed") {
    assert.match(wrongPublishAction.error.message, /publish/);
  }
});

test("E8: validator totality — rejections accumulate across fields in one pass", () => {
  const check = validatePlayCanvasCommandPayload("asset.import", {
    version: 1,
    target: "",
    format: "exe",
    into: "garage",
    artifact: {},
  });
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    const paths = check.rejections.map((item) => item.path);
    assert.ok(paths.includes("payload.target"));
    assert.ok(paths.includes("payload.format"));
    assert.ok(paths.includes("payload.into"));
    assert.ok(paths.includes("payload.artifact.digest"));
    assert.ok(paths.includes("payload.artifact.bytes"));
  }
});

test("E8: payloadFamilyFor refuses foreign capabilities at the validator", () => {
  assert.equal(payloadFamilyFor("build.cook"), null);
  assert.equal(payloadFamilyFor("project.inspect"), "inspect-project");
  assert.equal(payloadFamilyFor("build.play"), "build-play");
});
