/**
 * THE E8 NEGATIVE BATTERY, part 2 (PL-022) — the typed payload rejection
 * codes: each unreal-payload/* code exercised at least once through the
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
import { createUnrealAdapter } from "./adapter.ts";
import { createFakeUnrealBridge, createFakeUnrealClock } from "./fake-bridge.ts";
import { validateUnrealCommandPayload } from "./payload-validate.ts";

const tenant = asTenantId("tenant-alpha")!;
const digest = (char: string): string => char.repeat(64);

function makeAdapter() {
  const bridge = createFakeUnrealBridge({ seed: 7 });
  const clock = createFakeUnrealClock(10_000);
  const adapter = createUnrealAdapter({ tenant, bridge, clock });
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
    assert.equal(result.error.code, "unreal/invalid-payload", commandId);
    assert.match(result.error.message, fragment, commandId);
  }
}

test("E8: payload not-an-object → unreal-payload/not-an-object", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("p1", "project.inspect", "a string"));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    // A non-object payload cannot carry a tenant claim, so the tenancy gate
    // fires first (R20 ordering); the code is asserted directly below.
    assert.equal(result.error.code, "unreal-tenancy/tenant-not-a-string");
  }
  const check = validateUnrealCommandPayload("project.inspect", "a string");
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    assert.equal(check.rejections[0]?.code, "unreal-payload/not-an-object");
  }
});

test("E8: payload version missing/wrong → version codes", async () => {
  await expectPayloadFailure("p2", "project.inspect", { tenant: "tenant-alpha", target: "MyGame" }, /payload\.version/);
  await expectPayloadFailure("p3", "project.inspect", { version: 99, tenant: "tenant-alpha", target: "MyGame" }, /payload\.version/);
});

test("E8: payload target missing/invalid → target codes", async () => {
  await expectPayloadFailure("p4", "level.inspect", { version: 1, tenant: "tenant-alpha" }, /payload\.target/);
  await expectPayloadFailure("p5", "level.inspect", { version: 1, tenant: "tenant-alpha", target: "../etc/passwd" }, /payload\.target/);
  await expectPayloadFailure("p5b", "level.inspect", { version: 1, tenant: "tenant-alpha", target: "/Game/Maps/" }, /payload\.target/);
  await expectPayloadFailure("p5c", "level.inspect", { version: 1, tenant: "tenant-alpha", target: "/Game/../Secret" }, /payload\.target/);
});

test("E8: subject contradicting the capability → subject-mismatch", async () => {
  await expectPayloadFailure("p6", "level.inspect", {
    version: 1, tenant: "tenant-alpha", subject: "project", target: "MyGame",
  }, /subject/);
});

test("E8: actor name missing/invalid → actor-name codes", async () => {
  await expectPayloadFailure("p7", "actor.inspect", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox",
  }, /payload\.actorName/);
  await expectPayloadFailure("p8", "actor.inspect", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", actorName: "9bad-name",
  }, /payload\.actorName/);
});

test("E8: component name missing/invalid → component-name codes", async () => {
  await expectPayloadFailure("p9", "component.inspect", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1",
  }, /payload\.componentName/);
  await expectPayloadFailure("p10", "component.inspect", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1", componentName: "bad name",
  }, /payload\.componentName/);
});

test("E8: import format + artifact rejection codes", async () => {
  await expectPayloadFailure("p11", "asset.import", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Imported/Hero",
    format: "exe", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  }, /payload\.format/);
  await expectPayloadFailure("p12", "asset.import", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Imported/Hero",
    format: "fbx", artifact: { kind: "artifact-ref", digest: "nothex", bytes: -1 },
  }, /payload\.artifact/);
  const missingFormat = validateUnrealCommandPayload("asset.import", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Imported/Hero", artifact: { kind: "artifact-ref", digest: digest("a"), bytes: 1 },
  });
  assert.equal(missingFormat.outcome, "rejected");
  if (missingFormat.outcome === "rejected") {
    assert.ok(missingFormat.rejections.some((item) => item.code === "unreal-payload/format-missing"));
  }
});

test("E8: export mode rejection codes", async () => {
  await expectPayloadFailure("p13", "asset.export", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Characters/Hero/Mesh/SK_Hero", format: "usd", mode: "half-scene",
  }, /payload\.mode/);
  const missingMode = validateUnrealCommandPayload("asset.export", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Characters/Hero/Mesh/SK_Hero", format: "usd",
  });
  assert.equal(missingMode.outcome, "rejected");
  if (missingMode.outcome === "rejected") {
    assert.ok(missingMode.rejections.some((item) => item.code === "unreal-payload/export-mode-missing"));
  }
});

test("E8: modify edits rejection codes (missing/entry/property)", async () => {
  await expectPayloadFailure("p14", "actor.modify", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1",
  }, /payload\.edits/);
  await expectPayloadFailure("p15", "actor.modify", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1",
    edits: [{ property: "location" }],
  }, /edits\[0\]\.value/);
  await expectPayloadFailure("p16", "actor.modify", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", actorName: "BP_Player_C_1",
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

test("E8: PIE players invalid → players-invalid", async () => {
  await expectPayloadFailure("p20", "level.pie", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", players: 5,
  }, /payload\.players/);
  await expectPayloadFailure("p21", "level.pie", {
    version: 1, tenant: "tenant-alpha", target: "/Game/Maps/L_Sandbox", players: 1.5,
  }, /payload\.players/);
});

test("E8: build targetPlatform/configuration rejection codes", async () => {
  await expectPayloadFailure("p22", "build.cook", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", configuration: "development",
  }, /payload\.targetPlatform/);
  await expectPayloadFailure("p23", "build.cook", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", targetPlatform: "android", configuration: "development",
  }, /payload\.targetPlatform/);
  await expectPayloadFailure("p24", "build.package", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", targetPlatform: "windows",
  }, /payload\.configuration/);
  await expectPayloadFailure("p25", "build.package", {
    version: 1, tenant: "tenant-alpha", target: "MyGame", targetPlatform: "windows", configuration: "test",
  }, /payload\.configuration/);
});

test("E8: fixed-action codes (editor.script/level.pie/build.cook/build.package)", async () => {
  await expectPayloadFailure("p26", "editor.script", {
    version: 1, tenant: "tenant-alpha", action: "stop-script", scriptDigest: digest("b"),
  }, /run-script/);
  await expectPayloadFailure("p27", "level.pie", {
    version: 1, tenant: "tenant-alpha", action: "standalone", target: "/Game/Maps/L_Sandbox",
  }, /pie/);
  await expectPayloadFailure("p28", "build.cook", {
    version: 1, tenant: "tenant-alpha", action: "package", target: "MyGame", targetPlatform: "windows", configuration: "development",
  }, /cook/);
  await expectPayloadFailure("p29", "build.package", {
    version: 1, tenant: "tenant-alpha", action: "cook", target: "MyGame", targetPlatform: "windows", configuration: "shipping",
  }, /package/);
});

test("E8: validator totality — rejections accumulate across fields in one pass", () => {
  const check = validateUnrealCommandPayload("asset.import", {
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

test("E8: actor.modify totality — subject, actorName and edits accumulate", () => {
  const check = validateUnrealCommandPayload("actor.modify", {
    version: 2,
    subject: "level",
    target: "/Game/Maps/L_Sandbox",
    edits: [],
  });
  assert.equal(check.outcome, "rejected");
  if (check.outcome === "rejected") {
    const paths = check.rejections.map((item) => item.path);
    assert.ok(paths.includes("payload.version"));
    assert.ok(paths.includes("payload.subject"));
    assert.ok(paths.includes("payload.actorName"));
    assert.ok(paths.includes("payload.edits"));
  }
});
