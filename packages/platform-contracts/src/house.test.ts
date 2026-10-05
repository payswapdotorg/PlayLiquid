/**
 * House-rule tests for @playliquid/platform-contracts.
 *
 * E1 (one owner per mutable state): every exported vocabulary table is
 * deeply frozen and contract fields are readonly (compile-time checks
 * live in the per-module tests).
 *
 * E3 (provider SDKs do not leak into domain contracts): the package's
 * only dependency is the workspace sibling
 * `@playliquid/game-contracts` (module-dependency-matrix:
 * platform-contracts | game-contracts) and sources import nothing else
 * outside Node builtins (tests) and this package itself.
 *
 * Lock 18 surface discipline: no export performs authority actions —
 * this package declares contracts and pure validators only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as contracts from "./index.ts";

const srcDir = dirname(fileURLToPath(import.meta.url));

test("house: the only dependency is the workspace sibling game-contracts (E3 / module matrix)", async () => {
  const manifest = JSON.parse(await readFile(join(srcDir, "..", "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.deepEqual(manifest.dependencies, { "@playliquid/game-contracts": "workspace:*" });
  assert.equal(manifest.peerDependencies, undefined);
  const devNames = Object.keys(manifest.devDependencies ?? {}).sort();
  assert.deepEqual(devNames, ["@types/node", "typescript"]);
});

test("house: sources import only allowed specifiers (relative, sibling, node builtins)", async () => {
  const files = (await readdir(srcDir))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "harness.ts");
  assert.ok(files.length >= 12, `expected at least 12 contract modules, saw ${files.length}`);
  for (const file of files) {
    const text = await readFile(join(srcDir, file), "utf8");
    const imports = [...text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    for (const specifier of imports) {
      const allowed =
        specifier.startsWith(".") ||
        specifier === "@playliquid/game-contracts" ||
        specifier.startsWith("node:");
      assert.equal(
        allowed,
        true,
        `${file} imports "${specifier}" — only relative imports, @playliquid/game-contracts and node: builtins are allowed`,
      );
    }
  }
});

test("house: exported vocabularies are frozen (E1)", () => {
  const frozenNames = [
    "PLATFORM_AUTHORITY",
    "PLATFORM_EVENT_KIND_PREFIX",
    "PLATFORM_AUTHORITY_EVENT_KINDS",
    "CAPABILITY_PERMISSIONS",
    "SOCIAL_GRAPH_KINDS",
    "SOCIAL_ACTIONS",
    "ANALYTICS_PRIVACY_CLASSES",
    "ANALYTICS_FORBIDDEN_PAYLOAD_KEYS",
    "MODERATION_SURFACES",
    "MODERATION_SEVERITY_ORDER",
    "INTEGRITY_SIGNAL_KINDS",
    "AI_PLAY_MODES",
    "FORBIDDEN_INTEGRITY_FIELDS",
  ];
  for (const name of frozenNames) {
    const table = (contracts as unknown as Record<string, unknown>)[name];
    assert.ok(table !== undefined, `${name} is exported`);
    assert.ok(Object.isFrozen(table), `${name} is frozen`);
  }
});

test("house: no runtime authority leaks into the contract surface (E1/E2)", () => {
  const exports = Object.keys(contracts);
  const forbidden = exports.filter((name) => /^(apply|mutate|execute|dispatch|emit|commit|push)/.test(name));
  assert.deepEqual(forbidden, []);
  assert.equal(typeof contracts.validateCapabilityPolicy, "function");
  assert.equal(typeof contracts.settleGrant, "function");
  assert.equal(typeof contracts.checkTenantIsolation, "function");
});

test("house: the platform authority event vocabulary stays in its namespace (lock 18)", () => {
  for (const kind of contracts.PLATFORM_AUTHORITY_EVENT_KINDS) {
    assert.ok(kind.startsWith("platform."));
  }
  assert.ok(contracts.PLATFORM_AUTHORITY_EVENT_KINDS.length >= 9);
});
