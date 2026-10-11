/**
 * THE E8 NEGATIVE BATTERY, part 2 (PL-024) — the typed payload rejection
 * codes: each godot-payload/* code exercised at least once through the
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
import { createGodotAdapter } from "./adapter.ts";
import { createFakeGodotBridge, createFakeGodotClock } from "./fake-bridge.ts";
import { validateGodotCommandPayload } from "./payload-validate.ts";

const tenant = asTenantId("tenant-alpha")!;
const digest = (char: string): string => char.repeat(64);

function makeAdapter() {
  const bridge = createFakeGodotBridge({ seed: 7 });
  const clock = createFakeGodotClock(10_000);
  const adapter = createGodotAdapter({ tenant, bridge, clock });
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
    assert.equal(result.error.code, "godot/invalid-payload", commandId);
    assert.match(result.error.message, fragment, commandId);
  }
}

test("E8: payload not-an-object → godot-payload/not-an-object", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("p1", "project.inspect", "a string"));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    // A non-object payload cannot carry a tenant claim, so the tenancy gate
    // fires first (R20 ordering); the code is asserted directly below.
    assert.equal(result.error.code, "godot-tenancy/tenant-not-a-string");
  }
  const check = validateGodotCommandPayload("project.inspect", "a string");
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    assert.equal(check.rejections[0]?.code, "godot-payload/not-an-object");
  }
});

test("E8: payload version missing/wrong → version codes", async () => {
  await expectPayloadFailure("p2", "project.inspect", { tenant: "tenant-alpha", target: "MyGame" }, /payload\.version/);
  await expectPayloadFailure("p3", "project.inspect", { version: 99, tenant: "tenant-alpha", target: "MyGame" }, /payload\.version/);
});

test("E8: res:// target missing/invalid → target codes", async () => {
  await expectPayloadFailure("p4", "scene.inspect", { version: 1, tenant: "tenant-alpha" }, /payload\.target/);
  await expectPayloadFailure("p5", "scene.inspect", { version: 1, tenant: "tenant-alpha", target: "../etc/passwd" }, /payload\.target/);
  await expectPayloadFailure("p5b", "scene.inspect", { version: 1, tenant: "tenant-alpha", target: "res://scenes/" }, /payload\.target/);
  await expectPayloadFailure("p5c", "scene.inspect", { version: 1, tenant: "tenant-alpha", target: "/scenes/main.tscn" }, /payload\.target/);
  await expectPayloadFailure("p5d", "asset.inspect", { version: 1, tenant: "tenant-alpha", target: "res://../secret.tres" }, /payload\.target/);
});

test("E8: project name missing/invalid → project-name codes", async () => {
  await expectPayloadFailure("p6", "project.inspect", { version: 1, tenant: "tenant-alpha", target: "" }, /payload\.target/);
  await expectPayloadFailure("p7", "project.inspect", { version: 1, tenant: "tenant-alpha", target: "res://MyGame" }, /payload\.target/);
  await expectPayloadFailure("p7b", "project.inspect", { version: 1, tenant: "tenant-alpha", target: "1bad project" }, /payload\.target/);
});

test("E8: subject contradicting the capability → subject-mismatch", async () => {
  await expectPayloadFailure("p8", "scene.inspect", {
    version: 1, tenant: "tenant-alpha", subject: "project", target: "MyGame",
  }, /subject/);
});

test("E8: node path missing/invalid → node-path codes", async () => {
  await expectPayloadFailure("p9", "node.inspect", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn",
  }, /payload\.nodePath/);
  await expectPayloadFailure("p10", "node.inspect", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", nodePath: "../Player",
  }, /payload\.nodePath/);
  await expectPayloadFailure("p10b", "node.inspect", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", nodePath: "9bad/Path",
  }, /payload\.nodePath/);
});

test("E8: import format + artifact rejection codes", async () => {
  await expectPayloadFailure("p11", "asset.import", {
    version: 1, tenant: "tenant-alpha", target: "res://assets/textures/hero.png",
    format: "exe", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  }, /payload\.format/);
  await expectPayloadFailure("p12", "asset.import", {
    version: 1, tenant: "tenant-alpha", target: "res://assets/textures/hero.png",
    format: "png", artifact: { kind: "artifact-ref", digest: "nothex", bytes: -1 },
  }, /payload\.artifact/);
  const missingFormat = validateGodotCommandPayload("asset.import", {
    version: 1, tenant: "tenant-alpha", target: "res://assets/textures/hero.png", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  });
  assert.equal(missingFormat.outcome, "rejected");
  if (missingFormat.outcome === "rejected") {
    assert.ok(missingFormat.rejections.some((item) => item.code === "godot-payload/format-missing"));
  }
});

test("E8: export mode rejection codes", async () => {
  await expectPayloadFailure("p13", "asset.export", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", format: "gltf", mode: "half-scene",
  }, /payload\.mode/);
  const missingMode = validateGodotCommandPayload("asset.export", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", format: "gltf",
  });
  assert.equal(missingMode.outcome, "rejected");
  if (missingMode.outcome === "rejected") {
    assert.ok(missingMode.rejections.some((item) => item.code === "godot-payload/export-mode-missing"));
  }
});

test("E8: modify edits rejection codes (missing/entry/property)", async () => {
  await expectPayloadFailure("p14", "node.modify", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", nodePath: "Player",
  }, /payload\.edits/);
  await expectPayloadFailure("p15", "node.modify", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", nodePath: "Player",
    edits: [{ property: "position" }],
  }, /edits\[0\]\.value/);
  await expectPayloadFailure("p16", "node.modify", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", nodePath: "Player",
    edits: [{ property: "NOT-SNAKE", value: 1 }],
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

test("E8: scene.run headless invalid → headless-invalid", async () => {
  await expectPayloadFailure("p20", "scene.run", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", headless: "yes",
  }, /payload\.headless/);
  await expectPayloadFailure("p21", "scene.run", {
    version: 1, tenant: "tenant-alpha", target: "res://scenes/main.tscn", headless: 1,
  }, /payload\.headless/);
});

test("E8: build.export preset rejection codes", async () => {
  await expectPayloadFailure("p22", "build.export", {
    version: 1, tenant: "tenant-alpha", target: "MyGame",
    targetPlatform: "web", configuration: "release",
  }, /payload\.preset/);
  await expectPayloadFailure("p23", "build.export", {
    version: 1, tenant: "tenant-alpha", target: "MyGame",
    preset: " Web (HTML5)", targetPlatform: "web", configuration: "release",
  }, /payload\.preset/);
});

test("E8: build targetPlatform/configuration rejection codes", async () => {
  await expectPayloadFailure("p24", "build.export", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", preset: "Web (HTML5)", configuration: "release",
  }, /payload\.targetPlatform/);
  await expectPayloadFailure("p25", "build.export", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", preset: "Web (HTML5)", targetPlatform: "android", configuration: "release",
  }, /payload\.targetPlatform/);
  await expectPayloadFailure("p26", "build.export", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", preset: "Windows Desktop", targetPlatform: "windows",
  }, /payload\.configuration/);
  await expectPayloadFailure("p27", "build.export", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", preset: "Windows Desktop", targetPlatform: "windows", configuration: "shipping",
  }, /payload\.configuration/);
});

test("E8: fixed-action codes (editor.script/scene.run/build.export)", async () => {
  await expectPayloadFailure("p28", "editor.script", {
    version: 1, tenant: "tenant-alpha", action: "stop-script", scriptDigest: digest("b"),
  }, /run-script/);
  await expectPayloadFailure("p29", "scene.run", {
    version: 1, tenant: "tenant-alpha", action: "debug", target: "res://scenes/main.tscn",
  }, /run/);
  await expectPayloadFailure("p30", "build.export", {
    version: 1, tenant: "tenant-alpha", action: "cook", target: "MyGame", preset: "Web (HTML5)", targetPlatform: "web", configuration: "release",
  }, /export/);
});

test("E8: validator totality — rejections accumulate across fields in one pass", () => {
  const check = validateGodotCommandPayload("asset.import", {
    version: 1,
    target: "",
    format: "exe",
    artifact: {},
  });
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    const paths = check.rejections.map((item) => item.path);
    assert.ok(paths.includes("payload.target"));
    assert.ok(paths.includes("payload.format"));
    assert.ok(paths.includes("payload.artifact.digest"));
    assert.ok(paths.includes("payload.artifact.bytes"));
  }
});

test("E8: node.modify totality — subject, nodePath and edits accumulate", () => {
  const check = validateGodotCommandPayload("node.modify", {
    version: 2,
    subject: "scene",
    target: "res://scenes/main.tscn",
    edits: [],
  });
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    const paths = check.rejections.map((item) => item.path);
    assert.ok(paths.includes("payload.version"));
    assert.ok(paths.includes("payload.subject"));
    assert.ok(paths.includes("payload.nodePath"));
    assert.ok(paths.includes("payload.edits"));
  }
});

test("E8: build.export totality — preset, platform and configuration accumulate", () => {
  const check = validateGodotCommandPayload("build.export", {
    version: 1,
    tenant: "tenant-alpha",
    target: "MyGame",
  });
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    const paths = check.rejections.map((item) => item.path);
    assert.ok(paths.includes("payload.preset"));
    assert.ok(paths.includes("payload.targetPlatform"));
    assert.ok(paths.includes("payload.configuration"));
  }
});
