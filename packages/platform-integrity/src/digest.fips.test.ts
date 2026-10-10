/**
 * FIPS 180-4 vector tests for sha256Hex — locking the in-package SHA-256
 * to the true vectors (the PL-017 worker previously found K-constant
 * typos copied across sibling digest implementations; these vectors pin
 * every copy, including this one).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { digestOf, sha256Hex } from "./digest.ts";
import { isValidContentDigest } from "@playliquid/platform-contracts";

// Expected digests assembled from fragments (house rule: no 64-char
// secret-shaped literals in tests). Cross-checked against node:crypto.
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

test("digest: digestOf yields valid platform-contracts content digests", () => {
  const digest = digestOf({ b: 2, a: 1 });
  assert.ok(isValidContentDigest(digest));
  // Canonical key order: same value with different key insertion order.
  assert.equal(digestOf({ a: 1, b: 2 }), digest);
  assert.notEqual(digestOf({ a: 1, b: 3 }), digest);
});
