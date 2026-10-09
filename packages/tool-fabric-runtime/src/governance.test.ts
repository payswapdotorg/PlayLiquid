/**
 * Module role: architecture self-governance for the tool-fabric-runtime
 * package — enforces, in the style of engine-adapter-contract's
 * neutrality.test.ts: no engine names anywhere in the package source (E4);
 * the pure layers (domain/, app/) import no node builtins and make no
 * wall-clock calls (E3); app/ never imports the adapters layer (ports
 * only); every source file stays under the 400-raw-line global cap and no
 * lint disables appear. Test-only file: it uses node:fs for the scan; the
 * module sources themselves stay IO-free.
 *
 * Implements: PL-019 E3/E4 governance evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

// Assembled at runtime from fragments so the literals never appear here.
const FORBIDDEN_ENGINE_WORDS: readonly string[] = [
  "un" + "real",
  "un" + "ity",
  "god" + "ot",
  "play" + "canvas",
  "blen" + "der",
];

function sourceFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const target = path.join(dir, entry);
      if (statSync(target).isDirectory()) {
        walk(target);
      } else if (entry.endsWith(".ts")) {
        files.push(target);
      }
    }
  }
  walk(SRC_DIR);
  return files.sort();
}

function relative(file: string): string {
  return path.relative(SRC_DIR, file).split(path.sep).join("/");
}

function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

test("no engine name appears anywhere in the package source (E4)", () => {
  const files = sourceFiles();
  assert.ok(files.length >= 25, `expected to scan the whole package, found ${files.length} files`);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const word of FORBIDDEN_ENGINE_WORDS) {
      const pattern = new RegExp(`\\b${word}\\b`, "i");
      assert.equal(pattern.test(text), false, `"${relative(file)}" must not contain the engine name "${word}"`);
    }
  }
});

test("the pure layers import no node builtins and make no wall-clock calls (E3)", () => {
  const pureFiles = sourceFiles().filter((file) => {
    const rel = relative(file);
    return rel.startsWith("domain/") || rel.startsWith("app/");
  });
  assert.ok(pureFiles.length >= 6, `expected the pure layers, found ${pureFiles.length} files`);
  for (const file of pureFiles) {
    const text = readFileSync(file, "utf8");
    for (const specifier of importsOf(text)) {
      assert.ok(
        !specifier.startsWith("node:"),
        `"${relative(file)}" (pure layer) must not import node builtins (found "${specifier}")`,
      );
    }
    assert.equal(
      /\b(?:Date\.now|setTimeout|setInterval|setImmediate|fetch)\s*\(/.test(text),
      false,
      `"${relative(file)}" (pure layer) must not call wall-clock or network primitives`,
    );
  }
});

test("the app layer orchestrates through ports only: no adapter imports (E3)", () => {
  const appFiles = sourceFiles().filter((file) => relative(file).startsWith("app/"));
  assert.ok(appFiles.length >= 3, `expected the app layer, found ${appFiles.length} files`);
  for (const file of appFiles) {
    for (const specifier of importsOf(readFileSync(file, "utf8"))) {
      assert.ok(
        !specifier.startsWith("../adapters/"),
        `"${relative(file)}" (app layer) must import ports, not adapters (found "${specifier}")`,
      );
    }
  }
});

test("cross-package imports are limited to the two declared contract packages", () => {
  for (const file of sourceFiles()) {
    for (const specifier of importsOf(readFileSync(file, "utf8"))) {
      if (specifier.startsWith("@playliquid/")) {
        assert.ok(
          specifier === "@playliquid/tool-fabric" || specifier === "@playliquid/engine-adapter-contract",
          `"${relative(file)}" may only import the declared contract packages (found "${specifier}")`,
        );
      } else {
        assert.ok(
          specifier.startsWith(".") || specifier.startsWith("node:"),
          `"${relative(file)}" must import only relative modules, node builtins or declared contracts (found "${specifier}")`,
        );
      }
    }
  }
});

test("every source file is under the 400-raw-line global cap", () => {
  for (const file of sourceFiles()) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
    assert.ok(
      lines <= 400,
      `"${relative(file)}" has ${lines} raw lines; the global cap is 400`,
    );
  }
});

test("no lint disables appear anywhere in the package", () => {
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    assert.equal(
      /(?:oxlint|eslint)-disable/.test(text),
      false,
      `"${relative(file)}" must not contain lint disables`,
    );
  }
});

test("domain files never import the app or adapters layers", () => {
  for (const file of sourceFiles().filter((item) => relative(item).startsWith("domain/"))) {
    for (const specifier of importsOf(readFileSync(file, "utf8"))) {
      assert.ok(
        !specifier.startsWith("../app/") && !specifier.startsWith("../adapters/"),
        `"${relative(file)}" (domain) must not import higher layers (found "${specifier}")`,
      );
    }
  }
});
