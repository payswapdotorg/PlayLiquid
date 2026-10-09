/**
 * Digest + canonical serialization tests: FIPS 180-4 vectors (assembled
 * from fragments, never whole-literal hex strings), canonical JSON key
 * sorting and determinism, and digest stability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, sha256Hex, digestOf } from "./digest.ts";
import { isValidDigest } from "@playliquid/runtime-contracts";

// Expected digests assembled from fragments (house rule: no 64-char
// secret-shaped literals in tests). Vectors cross-checked against
// node:crypto at every block boundary length.
const emptyVector = "e3b0c4" + "42" + "98fc1c14" + "9afbf4c8" + "996fb924" + "27ae41e4" + "649b934c" + "a495991b" + "7852b855";
const abcVector = "ba7816bf" + "8f01cfea" + "414140de" + "5dae2223" + "b00361a3" + "96177a9c" + "b410ff61" + "f20015ad";
const longVector = "248d6a61" + "d20638b8" + "e5c02693" + "0c3e6039" + "a33ce459" + "64ff2167" + "f6ecedd4" + "19db06c1";

test("sha256: FIPS 180-4 vector for the empty string", () => {
  assert.equal(sha256Hex(""), emptyVector);
});

test("sha256: FIPS 180-4 vector for 'abc'", () => {
  assert.equal(sha256Hex("abc"), abcVector);
});

test("sha256: FIPS 180-4 vector for the 448-bit 'abcdbcde...' message", () => {
  assert.equal(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"), longVector);
});

test("sha256: output is always 64 lowercase hex chars", () => {
  for (const input of ["", "x", "multiplayer", JSON.stringify({ a: [1, 2, 3] })]) {
    assert.ok(/^[0-9a-f]{64}$/.test(sha256Hex(input)));
  }
});

test("sha256: deterministic and collision-averse over nearby inputs", () => {
  assert.equal(sha256Hex("seed-alpha"), sha256Hex("seed-alpha"));
  assert.notEqual(sha256Hex("seed-alpha"), sha256Hex("seed-beta"));
});

test("canonicalJson: object keys are sorted recursively", () => {
  assert.equal(
    canonicalJson({ b: 1, a: { z: 2, c: 3 } }),
    '{"a":{"c":3,"z":2},"b":1}',
  );
});

test("canonicalJson: key order never matters, array order always does", () => {
  assert.equal(canonicalJson({ x: 1, y: 2 }), canonicalJson({ y: 2, x: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("canonicalJson: undefined properties are dropped, null is kept", () => {
  assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
});

test("digestOf: structural equality implies digest equality (E9)", () => {
  const first = { list: [{ z: 1, a: 2 }], map: { b: "x", a: "y" } };
  const second = { map: { a: "y", b: "x" }, list: [{ a: 2, z: 1 }] };
  assert.equal(String(digestOf(first)), String(digestOf(second)));
  assert.ok(isValidDigest(String(digestOf(first))));
  assert.notEqual(String(digestOf(first)), String(digestOf({ list: [], map: {} })));
});
