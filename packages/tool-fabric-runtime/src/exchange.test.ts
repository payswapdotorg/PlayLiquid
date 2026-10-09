/**
 * Module role: tests for the content-addressed exchange guard — artifact
 * reference validation, inline-bytes detection at deterministic paths, and
 * artifact reference collection.
 *
 * Implements: PL-019 exchange behavior coverage (E7 spirit).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  collectArtifactRefs,
  findExchangeViolation,
  validateArtifactRef,
} from "./domain/exchange.ts";

const VALID_DIGEST = "a".repeat(64);

test("validateArtifactRef accepts a well-formed reference", () => {
  const check = validateArtifactRef({ kind: "artifact-ref", digest: VALID_DIGEST, bytes: 12 });
  if (check.outcome !== "ok") {
    assert.fail(check.rejections.map((item) => item.code).join(", "));
  }
  assert.equal(check.ref.digest, VALID_DIGEST);
  assert.equal(check.ref.bytes, 12);
});

test("validateArtifactRef rejects non-objects, bad kinds, bad digests, bad sizes", () => {
  assert.equal(validateArtifactRef(null).outcome, "rejected");
  assert.equal(validateArtifactRef("artifact-ref").outcome, "rejected");
  const badKind = validateArtifactRef({ digest: VALID_DIGEST, bytes: 1 });
  if (badKind.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(badKind.rejections[0]?.code, "artifact-ref/kind-invalid");
  const badDigest = validateArtifactRef({ kind: "artifact-ref", digest: "xyz", bytes: 1 });
  if (badDigest.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(badDigest.rejections[0]?.code, "artifact-ref/digest-invalid");
  const badSize = validateArtifactRef({ kind: "artifact-ref", digest: VALID_DIGEST, bytes: -1 });
  if (badSize.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(badSize.rejections[0]?.code, "artifact-ref/size-invalid");
});

test("findExchangeViolation returns null for plain JSON trees", () => {
  assert.equal(findExchangeViolation({ a: 1, b: ["x", { c: true }] }), null);
  assert.equal(findExchangeViolation("string"), null);
  assert.equal(findExchangeViolation(null), null);
});

test("findExchangeViolation flags inline Uint8Array, Buffer, ArrayBuffer and DataView", () => {
  const root = findExchangeViolation(new Uint8Array([1, 2, 3]));
  if (root === null) {
    assert.fail("expected inline-bytes at root");
  }
  assert.equal(root.code, "exchange/inline-bytes");
  assert.equal(root.path, "value");

  const bufferFinding = findExchangeViolation({ payload: Buffer.from([9]) });
  if (bufferFinding === null) {
    assert.fail("expected Buffer to be flagged");
  }
  assert.equal(bufferFinding.path, "value.payload");

  assert.notEqual(findExchangeViolation({ data: new ArrayBuffer(8) }), null);
  assert.notEqual(findExchangeViolation([0, new DataView(new ArrayBuffer(4))]), null);
});

test("findExchangeViolation reports the first violation at a deterministic nested path", () => {
  const finding = findExchangeViolation({
    zebra: 1,
    alpha: { items: [{ ok: true }, new Uint8Array([1])] },
  });
  if (finding === null) {
    assert.fail("expected a violation");
  }
  assert.equal(finding.path, "value.alpha.items[1]");
});

test("findExchangeViolation flags malformed artifact-ref nodes", () => {
  const finding = findExchangeViolation({ texture: { kind: "artifact-ref", digest: "nope", bytes: 1 } });
  if (finding === null) {
    assert.fail("expected a violation");
  }
  assert.equal(finding.code, "exchange/invalid-artifact-ref");
  assert.equal(finding.path, "value.texture");
});

test("findExchangeViolation is bounded in depth and never throws on hostile objects", () => {
  let deep: unknown = { leaf: true };
  for (let index = 0; index < 64; index += 1) {
    deep = { nested: deep };
  }
  assert.equal(findExchangeViolation(deep), null);
  const hostile: Record<string, unknown> = {};
  Object.defineProperty(hostile, "boom", {
    enumerable: true,
    get(): unknown {
      throw new Error("hostile getter");
    },
  });
  assert.doesNotThrow(() => findExchangeViolation(hostile));
});

test("collectArtifactRefs gathers valid refs deterministically, deduped by digest", () => {
  const otherDigest = "b".repeat(64);
  const input = {
    z: { kind: "artifact-ref", digest: VALID_DIGEST, bytes: 4 },
    a: [{ kind: "artifact-ref", digest: otherDigest, bytes: 2 }, 5],
    dupe: { kind: "artifact-ref", digest: VALID_DIGEST, bytes: 4 },
  };
  const refs = collectArtifactRefs(input);
  assert.equal(refs.length, 2);
  // Object keys sorted: a before dupe before z; VALID_DIGEST first occurs
  // at "dupe", so the z occurrence is the dropped duplicate.
  assert.equal(refs[0]?.ref.digest, otherDigest);
  assert.equal(refs[0]?.path, "value.a[0]");
  assert.equal(refs[1]?.ref.digest, VALID_DIGEST);
  assert.equal(refs[1]?.path, "value.dupe");
  assert.deepEqual(collectArtifactRefs({ plain: 1 }), []);
  assert.deepEqual(collectArtifactRefs(new Uint8Array([1])), []);
});
