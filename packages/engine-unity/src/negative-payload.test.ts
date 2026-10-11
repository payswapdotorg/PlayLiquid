/**
 * THE E8 NEGATIVE BATTERY, part 2 (PL-023) — the typed payload rejection
 * codes: each unity-payload/* code exercised at least once through the
 * adapter dispatch (with a valid tenant claim so the payload gate fires)
 * and/or the total validator directly, plus the one-pass accumulation
 * guarantee.
 *
 * Part 1 (negative-capabilities.test.ts) covers capability + dispatch
 * shape; part 3 (negative-lifecycle.test.ts) trust, lifecycle, tenancy
 * and bridge failures; part 4 (binding.test.ts) the binding refusals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";
import { createUnityAdapter } from "./adapter.ts";
import { createFakeUnityBridge, createFakeUnityClock } from "./fake-bridge.ts";
import { validateUnityCommandPayload } from "./payload-validate.ts";

const tenant = asTenantId("tenant-alpha")!;
const guid = (char: string): string => char.repeat(32);
const digest = (char: string): string => char.repeat(64);

function makeAdapter() {
  const bridge = createFakeUnityBridge({ seed: 7 });
  const clock = createFakeUnityClock(10_000);
  const adapter = createUnityAdapter({ tenant, bridge, clock });
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

/** Dispatches and asserts the failure message mentions `fragment`. */
async function expectPayloadFailure(commandId: string, capability: string, payload: unknown, fragment: RegExp): Promise<void> {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch(commandId, capability, payload));
  assert.equal(result.outcome, "failed", commandId);
  if (result.outcome === "failed") {
    assert.equal(result.error.code, "unity/invalid-payload", commandId);
    assert.match(result.error.message, fragment, commandId);
  }
}

test("E8: payload not-an-object → unity-payload/not-an-object", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("p1", "project.inspect", "a string"));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    // A non-object payload cannot carry a tenant claim, so the tenancy gate
    // fires first (R20 ordering); the code is asserted directly below.
    assert.equal(result.error.code, "unity-tenancy/tenant-not-a-string");
  }
  const check = validateUnityCommandPayload("project.inspect", "a string");
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    assert.equal(check.rejections[0]?.code, "unity-payload/not-an-object");
  }
});

test("E8: payload version missing/wrong → version codes", async () => {
  await expectPayloadFailure("p2", "project.inspect", { tenant: "tenant-alpha", projectName: "MyGame" }, /payload\.version/);
  await expectPayloadFailure("p3", "project.inspect", { version: 99, tenant: "tenant-alpha", projectName: "MyGame" }, /payload\.version/);
});

test("E8: project name missing/invalid → project-name codes", async () => {
  await expectPayloadFailure("p3b", "project.inspect", { version: 1, tenant: "tenant-alpha" }, /payload\.projectName/);
  await expectPayloadFailure("p3c", "project.inspect", { version: 1, tenant: "tenant-alpha", projectName: "../etc/passwd" }, /payload\.projectName/);
});

test("E8: scene path missing/invalid → scene-path codes", async () => {
  await expectPayloadFailure("p4", "scene.inspect", { version: 1, tenant: "tenant-alpha" }, /payload\.scenePath/);
  await expectPayloadFailure("p5", "scene.inspect", { version: 1, tenant: "tenant-alpha", scenePath: "/Scenes/Sandbox.unity" }, /payload\.scenePath/);
  await expectPayloadFailure("p5b", "scene.inspect", { version: 1, tenant: "tenant-alpha", scenePath: "Assets/Scenes/Sandbox" }, /payload\.scenePath/);
  await expectPayloadFailure("p5c", "scene.inspect", { version: 1, tenant: "tenant-alpha", scenePath: "Assets/../Secret.unity" }, /payload\.scenePath/);
});

test("E8: subject contradicting the capability → subject-mismatch", async () => {
  await expectPayloadFailure("p6", "scene.inspect", {
    version: 1, tenant: "tenant-alpha", subject: "project", projectName: "MyGame",
  }, /subject/);
});

test("E8: object path missing/invalid → object-path codes", async () => {
  await expectPayloadFailure("p7", "gameobject.inspect", {
    version: 1, tenant: "tenant-alpha", scenePath: "Assets/Scenes/Sandbox.unity",
  }, /payload\.objectPath/);
  await expectPayloadFailure("p8", "gameobject.inspect", {
    version: 1, tenant: "tenant-alpha", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "/Leading/Slash",
  }, /payload\.objectPath/);
  await expectPayloadFailure("p8b", "gameobject.inspect", {
    version: 1, tenant: "tenant-alpha", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Double//Slash",
  }, /payload\.objectPath/);
});

test("E8: component type missing/invalid → component-type codes", async () => {
  await expectPayloadFailure("p9", "component.inspect", {
    version: 1, tenant: "tenant-alpha", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera",
  }, /payload\.componentType/);
  await expectPayloadFailure("p10", "component.inspect", {
    version: 1, tenant: "tenant-alpha", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera", componentType: "bad-type",
  }, /payload\.componentType/);
});

test("E8: asset guid missing/invalid → asset-guid codes", async () => {
  await expectPayloadFailure("p10b", "asset.inspect", { version: 1, tenant: "tenant-alpha" }, /payload\.assetGuid/);
  await expectPayloadFailure("p10c", "asset.inspect", { version: 1, tenant: "tenant-alpha", assetGuid: "not-a-guid" }, /payload\.assetGuid/);
  await expectPayloadFailure("p10d", "prefab.inspect", { version: 1, tenant: "tenant-alpha", assetGuid: "ABC-UPPER" }, /payload\.assetGuid/);
});

test("E8: import destination/format/artifact rejection codes", async () => {
  await expectPayloadFailure("p11", "asset.import", {
    version: 1, tenant: "tenant-alpha", destinationPath: "Imported/Hero.fbx",
    format: "fbx", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  }, /payload\.destinationPath/);
  await expectPayloadFailure("p11b", "asset.import", {
    version: 1, tenant: "tenant-alpha", destinationPath: "Assets/Imported/Hero",
    format: "fbx", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  }, /payload\.destinationPath/);
  await expectPayloadFailure("p12", "asset.import", {
    version: 1, tenant: "tenant-alpha", destinationPath: "Assets/Imported/Hero.fbx",
    format: "exe", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  }, /payload\.format/);
  await expectPayloadFailure("p12b", "asset.import", {
    version: 1, tenant: "tenant-alpha", destinationPath: "Assets/Imported/Hero.fbx",
    format: "fbx", artifact: { kind: "artifact-ref", digest: "nothex", bytes: -1 },
  }, /payload\.artifact/);
  const missingFormat = validateUnityCommandPayload("asset.import", {
    version: 1, tenant: "tenant-alpha", destinationPath: "Assets/Imported/Hero.fbx", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  });
  assert.equal(missingFormat.outcome, "rejected");
  if (missingFormat.outcome === "rejected") {
    assert.ok(missingFormat.rejections.some((item) => item.code === "unity-payload/format-missing"));
  }
});

test("E8: export mode rejection codes", async () => {
  await expectPayloadFailure("p13", "asset.export", {
    version: 1, tenant: "tenant-alpha", assetGuid: guid("b"), format: "gltf", mode: "half-scene",
  }, /payload\.mode/);
  const missingMode = validateUnityCommandPayload("asset.export", {
    version: 1, tenant: "tenant-alpha", assetGuid: guid("b"), format: "gltf",
  });
  assert.equal(missingMode.outcome, "rejected");
  if (missingMode.outcome === "rejected") {
    assert.ok(missingMode.rejections.some((item) => item.code === "unity-payload/export-mode-missing"));
  }
});

test("E8: modify edits rejection codes (missing/entry/property)", async () => {
  await expectPayloadFailure("p14", "gameobject.modify", {
    version: 1, tenant: "tenant-alpha", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera",
  }, /payload\.edits/);
  await expectPayloadFailure("p15", "gameobject.modify", {
    version: 1, tenant: "tenant-alpha", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera",
    edits: [{ property: "position" }],
  }, /edits\[0\]\.value/);
  await expectPayloadFailure("p16", "gameobject.modify", {
    version: 1, tenant: "tenant-alpha", scenePath: "Assets/Scenes/Sandbox.unity", objectPath: "Player/Main Camera",
    edits: [{ property: "NOT-KEBAB", value: 1 }],
  }, /edits\[0\]\.property/);
});

test("E8: editor action missing/invalid → action codes", async () => {
  await expectPayloadFailure("p17", "editor.action", {
    version: 1, tenant: "tenant-alpha",
  }, /payload\.action/);
  await expectPayloadFailure("p18", "editor.action", {
    version: 1, tenant: "tenant-alpha", action: "NOT KEBAB",
  }, /payload\.action/);
});

test("E8: editor script digest invalid → script-invalid", async () => {
  await expectPayloadFailure("p19", "editor.script", {
    version: 1, tenant: "tenant-alpha", scriptDigest: "xyz",
  }, /payload\.scriptDigest/);
});

test("E8: build scene-list rejection codes", async () => {
  await expectPayloadFailure("p20", "build.player", {
    version: 1, tenant: "tenant-alpha", targetPlatform: "windows", configuration: "release",
  }, /payload\.scenePaths/);
  await expectPayloadFailure("p21", "build.player", {
    version: 1, tenant: "tenant-alpha", scenePaths: ["Scenes/Sandbox.unity"], targetPlatform: "windows", configuration: "release",
  }, /payload\.scenePaths\[0\]/);
  const tooMany = validateUnityCommandPayload("build.player", {
    version: 1, tenant: "tenant-alpha",
    scenePaths: Array.from({ length: 17 }, () => "Assets/Scenes/Sandbox.unity"),
    targetPlatform: "windows", configuration: "release",
  });
  assert.equal(tooMany.outcome, "rejected");
  if (tooMany.outcome === "rejected") {
    assert.ok(tooMany.rejections.some((item) => item.code === "unity-payload/scene-list-invalid"));
  }
});

test("E8: build targetPlatform/configuration rejection codes", async () => {
  await expectPayloadFailure("p22", "build.player", {
    version: 1, tenant: "tenant-alpha", scenePaths: ["Assets/Scenes/Sandbox.unity"], configuration: "release",
  }, /payload\.targetPlatform/);
  await expectPayloadFailure("p23", "build.player", {
    version: 1, tenant: "tenant-alpha", scenePaths: ["Assets/Scenes/Sandbox.unity"], targetPlatform: "steamdeck", configuration: "release",
  }, /payload\.targetPlatform/);
  await expectPayloadFailure("p24", "build.player", {
    version: 1, tenant: "tenant-alpha", scenePaths: ["Assets/Scenes/Sandbox.unity"], targetPlatform: "windows",
  }, /payload\.configuration/);
  await expectPayloadFailure("p25", "build.player", {
    version: 1, tenant: "tenant-alpha", scenePaths: ["Assets/Scenes/Sandbox.unity"], targetPlatform: "windows", configuration: "shipping",
  }, /payload\.configuration/);
});

test("E8: fixed-action codes (editor.script/scene.play/build.player)", async () => {
  await expectPayloadFailure("p26", "editor.script", {
    version: 1, tenant: "tenant-alpha", action: "stop-script", scriptDigest: digest("b"),
  }, /run-script/);
  await expectPayloadFailure("p27", "scene.play", {
    version: 1, tenant: "tenant-alpha", action: "stop", scenePath: "Assets/Scenes/Sandbox.unity",
  }, /play/);
  await expectPayloadFailure("p28", "build.player", {
    version: 1, tenant: "tenant-alpha", action: "build-pipeline", scenePaths: ["Assets/Scenes/Sandbox.unity"], targetPlatform: "windows", configuration: "release",
  }, /build-player/);
});

test("E8: validator totality — rejections accumulate across fields in one pass", () => {
  const check = validateUnityCommandPayload("asset.import", {
    version: 1,
    destinationPath: "",
    format: "exe",
    artifact: {},
  });
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    const paths = check.rejections.map((item) => item.path);
    assert.ok(paths.includes("payload.destinationPath"));
    assert.ok(paths.includes("payload.format"));
    assert.ok(paths.includes("payload.artifact.digest"));
    assert.ok(paths.includes("payload.artifact.bytes"));
  }
});

test("E8: gameobject.modify totality — subject, objectPath and edits accumulate", () => {
  const check = validateUnityCommandPayload("gameobject.modify", {
    version: 2,
    subject: "scene",
    scenePath: "Assets/Scenes/Sandbox.unity",
    edits: [],
  });
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    const paths = check.rejections.map((item) => item.path);
    assert.ok(paths.includes("payload.version"));
    assert.ok(paths.includes("payload.subject"));
    assert.ok(paths.includes("payload.objectPath"));
    assert.ok(paths.includes("payload.edits"));
  }
});
