/**
 * Module role: tests for the surface-version contract — parse, format,
 * validate, and the compatibility rules between requested and declared
 * surfaces.
 *
 * Implements: PL-005 §3.A.4 (versioned surface) — behavior coverage for
 * versioning.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkSurfaceCompatibility,
  formatSurfaceVersion,
  parseSurfaceVersion,
  validateSurfaceVersion,
} from "./versioning.ts";

test("validateSurfaceVersion accepts a well-formed version", () => {
  const result = validateSurfaceVersion({ major: 1, minor: 2 });
  if (result.outcome !== "ok") {
    assert.fail(`expected ok, got ${result.rejection.code}`);
  }
  assert.equal(result.version.major, 1);
  assert.equal(result.version.minor, 2);
});

test("validateSurfaceVersion normalizes to a frozen major/minor pair", () => {
  const result = validateSurfaceVersion({ major: 3, minor: 0, extra: true });
  if (result.outcome !== "ok") {
    assert.fail(`expected ok, got ${result.rejection.code}`);
  }
  assert.deepEqual(Reflect.ownKeys(result.version), ["major", "minor"]);
  assert.throws(() => {
    (result.version as { major: number }).major = 9;
  }, TypeError);
});

test("validateSurfaceVersion accepts major 0", () => {
  assert.equal(validateSurfaceVersion({ major: 0, minor: 0 }).outcome, "ok");
});

test("validateSurfaceVersion rejects non-objects", () => {
  for (const input of [null, undefined, 42, "1.2", []]) {
    const result = validateSurfaceVersion(input);
    if (result.outcome === "ok") {
      assert.fail(`expected rejection for ${String(input)}`);
    }
    assert.equal(result.rejection.code, "surface-version/not-an-object");
  }
});

test("validateSurfaceVersion rejects bad majors and minors", () => {
  const cases: readonly [unknown, string][] = [
    [{ minor: 0 }, "surface-version/major-missing"],
    [{ major: "1", minor: 0 }, "surface-version/major-missing"],
    [{ major: 1.5, minor: 0 }, "surface-version/major-not-an-integer"],
    [{ major: -1, minor: 0 }, "surface-version/major-negative"],
    [{ major: 1 }, "surface-version/minor-missing"],
    [{ major: 1, minor: "2" }, "surface-version/minor-missing"],
    [{ major: 1, minor: 2.5 }, "surface-version/minor-not-an-integer"],
    [{ major: 1, minor: -1 }, "surface-version/minor-negative"],
  ];
  for (const [input, expectedCode] of cases) {
    const result = validateSurfaceVersion(input);
    if (result.outcome === "ok") {
      assert.fail(`expected ${expectedCode} for ${JSON.stringify(input)}`);
    }
    assert.equal(result.rejection.code, expectedCode);
  }
});

test("parseSurfaceVersion parses well-formed text", () => {
  const result = parseSurfaceVersion("2.7");
  if (result.outcome !== "ok") {
    assert.fail(`expected ok, got ${result.rejection.code}`);
  }
  assert.equal(result.version.major, 2);
  assert.equal(result.version.minor, 7);
});

test("parseSurfaceVersion rejects malformed text", () => {
  for (const text of ["", "1", "1.x", "1.2.3", "v1.4", ".5", "1.", "1 .4"]) {
    const result = parseSurfaceVersion(text);
    if (result.outcome === "ok") {
      assert.fail(`expected rejection for "${text}"`);
    }
    assert.equal(result.rejection.code, "surface-version/parse-format");
  }
});

test("formatSurfaceVersion renders major.minor", () => {
  assert.equal(formatSurfaceVersion({ major: 2, minor: 7 }), "2.7");
  assert.equal(formatSurfaceVersion({ major: 0, minor: 13 }), "0.13");
});

test("checkSurfaceCompatibility accepts same or older minor within a major", () => {
  assert.equal(checkSurfaceCompatibility({ major: 1, minor: 2 }, { major: 1, minor: 2 }).compatible, true);
  assert.equal(checkSurfaceCompatibility({ major: 1, minor: 1 }, { major: 1, minor: 5 }).compatible, true);
});

test("checkSurfaceCompatibility refuses a newer minor within a major", () => {
  const result = checkSurfaceCompatibility({ major: 1, minor: 6 }, { major: 1, minor: 5 });
  if (result.compatible !== false) {
    assert.fail("expected incompatibility");
  }
  assert.equal(result.mismatch.code, "surface/minor-too-new");
  assert.equal(result.mismatch.requested.minor, 6);
  assert.equal(result.mismatch.declared.minor, 5);
});

test("checkSurfaceCompatibility refuses any major mismatch, in either direction", () => {
  const up = checkSurfaceCompatibility({ major: 2, minor: 0 }, { major: 1, minor: 9 });
  if (up.compatible !== false) {
    assert.fail("expected incompatibility");
  }
  assert.equal(up.mismatch.code, "surface/major-mismatch");
  const down = checkSurfaceCompatibility({ major: 1, minor: 0 }, { major: 2, minor: 0 });
  if (down.compatible !== false) {
    assert.fail("expected incompatibility");
  }
  assert.equal(down.mismatch.code, "surface/major-mismatch");
  assert.ok(down.mismatch.message.includes("never auto-coerced"));
});
