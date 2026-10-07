/**
 * Module role: neutrality enforcement for the adapter contract package.
 * Scans every source file (tests included) for engine names — assembled at
 * RUNTIME from fragments so the literals never appear in source — and
 * asserts that non-test sources import only relative modules (no provider
 * SDK imports, no cross-package imports). Test-only file: it uses node:fs
 * for the source scan; the contract modules themselves stay IO-free.
 *
 * Implements: PL-005 §3.B.1 (neutrality guarantees).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as contract from "./index.ts";

const FORBIDDEN_WORDS: readonly string[] = [
  "play" + "canvas",
  "un" + "real",
  "un" + "ity",
  "god" + "ot",
];

function sourceFileNames(): string[] {
  return readdirSync(new URL(".", import.meta.url)).filter((name) => name.endsWith(".ts"));
}

test("no engine name appears anywhere in the package source", () => {
  const files = sourceFileNames();
  assert.ok(files.length >= 13, `expected to scan the whole package, found ${files.length} files`);
  for (const name of files) {
    const text = readFileSync(new URL(name, import.meta.url), "utf8");
    for (const word of FORBIDDEN_WORDS) {
      const pattern = new RegExp(`\\b${word}\\b`, "i");
      assert.equal(pattern.test(text), false, `"${name}" must not contain the engine name "${word}"`);
    }
  }
});

test("non-test sources import only relative modules", () => {
  const files = sourceFileNames().filter((name) => !name.endsWith(".test.ts"));
  assert.ok(files.length >= 7, `expected the contract modules, found ${files.length} files`);
  for (const name of files) {
    const text = readFileSync(new URL(name, import.meta.url), "utf8");
    const importPattern = /(?:^|\n)\s*(?:import|export)[^;\n]*from\s+"([^"]+)"/g;
    const specifiers: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(text)) !== null) {
      specifiers.push(match[1]!);
    }
    for (const specifier of specifiers) {
      assert.ok(
        specifier.startsWith("./"),
        `"${name}" must import only relative modules (found "${specifier}")`,
      );
    }
  }
});

test("no engine name appears in runtime exports", () => {
  for (const name of Object.keys(contract)) {
    const lower = name.toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
      assert.ok(!lower.includes(word), `export "${name}" must not contain the engine name "${word}"`);
    }
  }
});
