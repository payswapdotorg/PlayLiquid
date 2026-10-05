/**
 * Kernel house-rule tests.
 *
 * Lock 1: game-ir is THE semantic kernel — one barrel exposes the whole
 *         vocabulary (values, semantics, nodes, document, evaluation,
 *         validation) and nothing else.
 * Lock 13: AI emits typed intents; authority lives elsewhere — the kernel
 *         exports no mutation/execution entry points, and Intent carries
 *         no authority fields.
 * E1: contract data is readonly; mutation is a compile-time error.
 * E2: one canonical command/event path — exactly one event/intent/command
 *     vocabulary in the kernel.
 * E3: no provider SDKs leak into domain contracts — the only dependency is
 *     @playliquid/game-contracts (workspace), the only builtin is
 *     node:crypto (hashing), and sources import nothing else.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as kernel from "./index.ts";
import { asAgentId } from "@playliquid/game-contracts";
import { asIntentTypeId } from "./semantics.ts";
import type { Intent } from "./semantics.ts";

const srcDir = dirname(fileURLToPath(import.meta.url));

test("kernel: one barrel exposes the semantic kernel (lock 1)", () => {
  assert.equal(typeof kernel.validate, "function");
  assert.equal(typeof kernel.canonicalValueForm, "function");
  assert.equal(typeof kernel.hashGameIRValue, "function");
  assert.equal(typeof kernel.verifySimulationStepDeterminism, "function");
  assert.equal(kernel.GAME_IR_VERSION, "1");
  assert.ok(Object.isFrozen(kernel.GAME_IR_NODE_KINDS));
  assert.ok(Object.isFrozen(kernel.GAME_IR_VALUE_KINDS));
});

test("kernel: one canonical command/event vocabulary (lock 13 / E2)", () => {
  // Type-level probe: the single event/intent/command vocabulary is usable
  // through the barrel (compile-time proof; types are erased at runtime).
  const probe: [
    kernel.GameEvent["type"],
    kernel.Intent["type"],
    kernel.Command["type"],
  ] | null = null;
  assert.equal(probe, null);
  // Runtime proof: the canonical path helpers exist and are the only ones.
  for (const name of ["canonicalEventForm", "canonicalIntentForm", "canonicalCommandForm", "hashEvent", "hashIntent", "hashCommand"]) {
    assert.equal(typeof (kernel as unknown as Record<string, unknown>)[name], "function", `${name} is exported`);
  }
});

test("kernel: exports no execution or mutation authority (lock 13 / E1)", () => {
  const names = Object.keys(kernel);
  const forbidden = names.filter((name) => /^(apply|mutate|execute|dispatch|emit|adjudicate|authorize)/.test(name));
  assert.deepEqual(forbidden, []);
});

test("kernel: intents stay data-only at runtime (lock 13)", () => {
  const intent: Intent = {
    type: asIntentTypeId("avatar.movement.requested")!,
    payload: { kind: "unit" },
    actor: { agent: asAgentId("agent-atlas")! },
    tick: 1,
  };
  assert.deepEqual(Object.keys(intent).sort(), ["actor", "payload", "tick", "type"]);
  // @ts-expect-error — intents carry no authority fields
  const rigged: Intent = { ...intent, effect: "spawn" };
  assert.equal("effect" in rigged, true);
});

test("kernel: contracts are readonly (E1, compile-time misuse)", () => {
  const document = { irVersion: "1", identity: null, entry: null, nodes: [] } as unknown as kernel.GameIRDocument;
  // @ts-expect-error — document fields are readonly (compile-time contract)
  document.irVersion = "2";
  // readonly is enforced by the compiler; runtime objects stay plain data
  assert.equal(typeof document.irVersion, "string");
});

test("kernel: the only dependency is game-contracts (E3 / module matrix)", async () => {
  const manifest = JSON.parse(await readFile(join(srcDir, "..", "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.deepEqual(manifest.dependencies, { "@playliquid/game-contracts": "workspace:*" });
});

test("kernel: sources import only allowed modules (E3 / R14 engine-independence)", async () => {
  const files = (await readdir(srcDir)).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  assert.ok(files.length >= 9, `expected at least 9 source files, saw ${files.length}`);
  const allowed = (specifier: string): boolean =>
    specifier.startsWith(".") || specifier === "@playliquid/game-contracts" || specifier === "node:crypto";
  for (const file of files) {
    const text = await readFile(join(srcDir, file), "utf8");
    const imports = [...text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    for (const specifier of imports) {
      assert.ok(allowed(specifier), `${file} imports "${specifier}" which is not in the allowed set`);
    }
    for (const engine of ["unreal", "unity", "godot", "playcanvas", "blender"]) {
      assert.equal(text.toLowerCase().includes(engine), false, `${file} mentions engine "${engine}"`);
    }
  }
});
