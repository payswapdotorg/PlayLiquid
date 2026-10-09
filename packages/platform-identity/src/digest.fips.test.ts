/**
 * FIPS 180-4 vector tests for sha256Hex — added by the TL after the
 * PL-017 worker found two K-constant typos copied across the sibling
 * digest implementations (0x2de92d6f -> 0x2de92c6f, 0x1e374c08 ->
 * 0x1e376c08). The digests were internally self-consistent (in-package
 * snapshots verified) but were not true SHA-256 and would mismatch any
 * external CAS keyed on real SHA-256. These vectors lock the fix in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "./digest.ts";

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
