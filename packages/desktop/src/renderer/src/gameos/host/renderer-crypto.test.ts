/**
 * RENDERER CRYPTO ADAPTER TESTS (RW-001): proves the renderer-side sha256
 * adapter computes REAL FIPS 180-4 digests — byte-for-byte equal to Node's
 * own `node:crypto` implementation (the authority the domain packages use
 * in their test suites), plus the published NIST vectors and the loud
 * refusals for unsupported algorithms/encodings.
 *
 * These tests are TEST-ONLY consumers of the adapter (lock rule 44: the
 * adapter itself is production code; the comparison authority here is
 * Node's crypto, never a fabricated digest).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash as nodeCreateHash } from "node:crypto";
import { createHash } from "./renderer-crypto.ts";

/** Reference hex digest from Node's own sha256. */
function nodeHex(input: string | Uint8Array): string {
  return nodeCreateHash("sha256").update(input).digest("hex");
}

test("computes the published NIST vectors (FIPS 180-4)", () => {
  assert.equal(createHash("sha256").update("").digest("hex"),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(createHash("sha256").update("abc").digest("hex"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    createHash("sha256")
      .update("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
      .digest("hex"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

test("matches node:crypto byte-for-byte across assorted inputs", () => {
  const inputs = [
    "playliquid gameos",
    "ünïcödé — em-dash ✓ snow☃man",
    "x".repeat(1_000),
    JSON.stringify({ tenant: "tenant-playliquid-local", subject: "subject-local-operator" }),
  ];
  for (const input of inputs) {
    assert.equal(createHash("sha256").update(input).digest("hex"), nodeHex(input));
  }
});

test("incremental updates equal the one-shot digest", () => {
  const parts = ["playliquid", "-", "gameos", "-", "host", "-", "adapter"];
  const oneShot = nodeCreateHash("sha256").update(parts.join("")).digest("hex");
  const builder = createHash("sha256");
  for (const part of parts) {
    builder.update(part, "utf8");
  }
  assert.equal(builder.digest("hex"), oneShot);
});

test("binary (Uint8Array) input matches node:crypto", () => {
  const bytes = new Uint8Array(256);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
  assert.equal(createHash("sha256").update(bytes).digest("hex"), nodeHex(bytes));
});

test("digest() without encoding returns the raw 32-byte digest", () => {
  const digest = createHash("sha256").update("abc").digest();
  assert.ok(digest instanceof Uint8Array);
  assert.equal(digest.length, 32);
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assert.equal(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("rejects unsupported algorithms loudly (never a wrong digest)", () => {
  assert.throws(() => createHash("sha512"), /unsupported algorithm sha512/);
  assert.throws(() => createHash("md5"), /unsupported algorithm md5/);
});

test("rejects unsupported encodings loudly", () => {
  assert.throws(() => createHash("sha256").update("x", "base64"), /unsupported update encoding/);
  assert.throws(() => createHash("sha256").update("x").digest("base64" as "hex"),
    /unsupported digest encoding/);
});
