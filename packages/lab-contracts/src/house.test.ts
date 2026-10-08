/**
 * House-rule tests for @playliquid/lab-contracts.
 *
 * E1 (one owner per mutable state): every exported vocabulary table is
 * deeply frozen; contract fields are readonly (compile-time checks live in
 * the per-module tests).
 *
 * E3 (provider SDKs do not leak into domain contracts): the package's only
 * dependencies are the workspace siblings `@playliquid/game-contracts`
 * and `@playliquid/game-ir` (module-dependency-matrix: lab-contracts |
 * game-contracts, game-ir), and non-test sources import NOTHING else —
 * not even Node builtins (the strictest purity reading: contracts are
 * data and pure functions only; no crypto, no fs, no timers).
 *
 * Lock rule 5: no model/provider vocabulary exists anywhere in the
 * package sources (model assignments are opaque ZCode seam references).
 *
 * E10: no export can rewrite historical evidence — there is no
 * update/revise/rewrite-shaped function on the public surface.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asAgentId } from "@playliquid/game-contracts";
import * as contracts from "./index.ts";

const srcDir = dirname(fileURLToPath(import.meta.url));

test("house: the only dependencies are the two workspace siblings (E3 / module matrix)", async () => {
  const manifest = JSON.parse(await readFile(join(srcDir, "..", "package.json"), "utf8")) as {
    dependencies?: Record<string, unknown>;
    peerDependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  assert.deepEqual(manifest.dependencies, {
    "@playliquid/game-contracts": "workspace:*",
    "@playliquid/game-ir": "workspace:*",
  });
  assert.equal(manifest.peerDependencies, undefined);
  const devNames = Object.keys(manifest.devDependencies ?? {}).sort();
  assert.deepEqual(devNames, ["@types/node", "typescript"]);
});

test("house: non-test sources import only relative paths and the two siblings (pure contracts)", async () => {
  const files = (await readdir(srcDir)).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );
  assert.ok(files.length >= 10, `expected at least 10 source modules, saw ${files.length}`);
  for (const file of files) {
    const text = await readFile(join(srcDir, file), "utf8");
    const imports = [...text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    for (const specifier of imports) {
      const allowed =
        specifier.startsWith(".") ||
        specifier === "@playliquid/game-contracts" ||
        specifier === "@playliquid/game-ir";
      assert.equal(
        allowed,
        true,
        `${file} imports "${specifier}" — only relative imports and the two workspace siblings are allowed (no node: builtins in contracts)`,
      );
    }
  }
});

test("house: no model or provider vocabulary anywhere in the sources (lock 5)", async () => {
  const files = (await readdir(srcDir)).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  const forbidden = [
    "openai",
    "anthropic",
    "gpt-",
    "claude",
    "gemini",
    "deepseek",
    "mistral",
    "llama",
    "bedrock",
    "azure-openai",
    "vertex",
    "api-key",
    "apikey",
    "secret",
    "password",
    "bearer",
  ];
  for (const file of files) {
    const text = (await readFile(join(srcDir, file), "utf8")).toLowerCase();
    for (const marker of forbidden) {
      assert.equal(
        text.includes(marker),
        false,
        `${file} contains provider/credential vocabulary "${marker}" — model routing is ZCode authority (lock 5)`,
      );
    }
  }
});

test("house: no secret-shaped literal strings in tests or fixtures (fragment discipline)", async () => {
  const files = (await readdir(srcDir)).filter((file) => file.endsWith(".ts"));
  // A secret-shaped literal: a quoted run of >= 32 hex characters.
  const hexLiteral = /["'][0-9a-f]{32,}["']/;
  for (const file of files) {
    const text = await readFile(join(srcDir, file), "utf8");
    assert.equal(hexLiteral.test(text), false, `${file} contains a secret-shaped hex literal`);
  }
});

test("house: exported vocabularies are frozen (E1)", () => {
  const frozenNames = [
    "ESTIMATE_METHODS",
    "PROJECT_EVIDENCE_KINDS",
    "GAP_LADDER_RUNGS",
    "GAP_LADDER_TRANSITIONS",
    "LAB_LOOP_STAGE_KINDS",
    "LAB_LOOP_TRANSITIONS",
    "HUMAN_PARTICIPATION_MODES",
    "COMMUNICATION_CHANNEL_KINDS",
    "SCHEDULING_MODES",
    "BUDGET_RESOURCE_KINDS",
    "MEMORY_STORE_SCOPES",
    "TASK_DIFFICULTY_LEVELS",
    "EMPTY_PROJECT_EVIDENCE_LEDGER",
    "EMPTY_OBSERVATION_LEDGER",
  ];
  for (const name of frozenNames) {
    const table = (contracts as unknown as Record<string, unknown>)[name];
    assert.ok(table !== undefined, `${name} is exported`);
    assert.ok(Object.isFrozen(table), `${name} is frozen`);
  }
});

test("house: no export rewrites history or performs authority actions (E10/E1/E2)", () => {
  const exports = Object.keys(contracts);
  const forbidden = exports.filter((name) =>
    /^(apply|mutate|execute|dispatch|emit|commit|push|revise|rewrite|update|overwrite|delete|remove|edit)/.test(name),
  );
  assert.deepEqual(forbidden, []);
  // The append-only surface exists and is pure.
  assert.equal(typeof contracts.appendProjectEvidence, "function");
  assert.equal(typeof contracts.appendObservation, "function");
  assert.equal(typeof contracts.appendCalibrationConclusion, "function");
});

test("house: the epistemic vocabulary is exported (E11 surface completeness)", () => {
  assert.equal(typeof contracts.isLabeledEstimate, "function");
  assert.equal(typeof contracts.isObservedEvidence, "function");
  assert.equal(typeof contracts.epistemicClassOf, "function");
  assert.equal(typeof contracts.GENERALIST_ROLE, "string");
  assert.equal(typeof contracts.generalistBaselineOrganization, "function");
  assert.equal(typeof contracts.GAP_LADDER_RUNGS.length, "number");
});

test("house: the generalist baseline is always available (lock 26)", () => {
  const baseline = contracts.generalistBaselineOrganization({
    organizationId: contracts.asOrganizationId("org-house-baseline")!,
    agent: asAgentId("agent-house")!,
    model: { authority: "zcode-model-routing", route: contracts.asZCodeModelRouteId("route-house")! },
  });
  const validation = contracts.validateOrganization(baseline);
  assert.equal(validation.ok, true);
  assert.ok(contracts.isGeneralistBaselineOrganization(baseline));
  // Every organization search stage MUST structurally carry a baseline —
  // the field is required on the record type (compile-time) and validated
  // at linkage time (loop.test.ts).
  assert.equal(typeof contracts.appendLoopStage, "function");
});
