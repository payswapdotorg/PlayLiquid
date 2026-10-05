/**
 * House-rule tests for @playliquid/game-contracts.
 *
 * E1 (one owner per mutable state): every exported table is deeply frozen
 * and every contract field is readonly — mutation is a compile-time error.
 *
 * E3 (provider SDKs do not leak into domain contracts): the package has
 * zero runtime dependencies and its sources import nothing outside
 * Node builtins (tests) and this package itself.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as contracts from "./index.ts";

const srcDir = dirname(fileURLToPath(import.meta.url));

test("house: package is dependency-free (E3)", async () => {
  const manifest = JSON.parse(await readFile(join(srcDir, "..", "package.json"), "utf8")) as {
    dependencies?: Record<string, unknown>;
    peerDependencies?: Record<string, unknown>;
  };
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
});

test("house: sources import only from this package (module matrix: zero cross-package imports)", async () => {
  const files = (await readdir(srcDir)).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  assert.ok(files.length >= 8, `expected at least 8 source files, saw ${files.length}`);
  for (const file of files) {
    const text = await readFile(join(srcDir, file), "utf8");
    const imports = [...text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    for (const specifier of imports) {
      assert.equal(
        specifier.startsWith("."),
        true,
        `${file} imports "${specifier}" — game-contracts may only import relatively within itself`,
      );
    }
  }
});

test("house: exported vocabularies are frozen (E1)", () => {
  const frozenNames = [
    "GAME_KINDS",
    "GAME_LIFECYCLE_STATES",
    "GAME_LIFECYCLE_TRANSITIONS",
    "SPATIAL_LEVELS",
    "SENSOR_CAPABILITY_IDS",
    "ACTUATOR_CAPABILITY_IDS",
    "AVATAR_CAPABILITY_IDS",
    "PLATFORM_CAPABILITY_IDS",
    "REPLAY_CONSUMERS",
  ];
  for (const name of frozenNames) {
    const table = (contracts as unknown as Record<string, unknown>)[name];
    assert.ok(Array.isArray(table) || typeof table === "object", `${name} is exported`);
    assert.ok(Object.isFrozen(table), `${name} is frozen`);
  }
});

test("house: no runtime authority leaks into the vocabulary (E1/E2)", () => {
  const exports = Object.keys(contracts);
  const forbidden = exports.filter((name) => /^(apply|mutate|execute|dispatch|emit|commit|push)/.test(name));
  assert.deepEqual(forbidden, []);
  assert.equal(typeof contracts.assessAvatarCompatibility, "function");
  assert.equal(typeof contracts.canTransitionGameState, "function");
});
