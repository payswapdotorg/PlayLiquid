import { test } from "node:test";
import assert from "node:assert/strict";
import { asContentDigest } from "./primitives.ts";
import {
  KERNEL_VALUE_KINDS,
  isKernelValueKind,
  isEconomyValueRef,
  asOpaqueEconomyValue,
  asTypedKernelValueReading,
  isQuantityReading,
  readingPinnedToShape,
} from "./economy-values.ts";
import type { EconomyValueRef, TypedKernelValueReading } from "./economy-values.ts";

// Digests assembled from fragments.
const payloadDigest = asContentDigest("ab".repeat(32))!;
const shapeDigest = asContentDigest("cd".repeat(32))!;
const otherDigest = asContentDigest("ef".repeat(32))!;

test("economy-values: the kernel kind projection is frozen and game-ir-aligned", () => {
  assert.ok(Object.isFrozen(KERNEL_VALUE_KINDS));
  assert.deepEqual([...KERNEL_VALUE_KINDS], ["unit", "bool", "int", "float", "string", "entity-ref"]);
  assert.ok(isKernelValueKind("int"));
  assert.ok(isKernelValueKind("entity-ref"));
  assert.equal(isKernelValueKind("decimal"), false);
  assert.equal(isKernelValueKind("list"), false);
  assert.equal(isKernelValueKind(""), false);
});

test("economy-values: opaque carriers validate and construct", () => {
  const opaque = asOpaqueEconomyValue(payloadDigest);
  assert.ok(opaque !== undefined);
  assert.deepEqual(opaque, { carrier: "opaque-digest", payloadDigest });
  assert.ok(isEconomyValueRef(opaque!));
  assert.equal(asOpaqueEconomyValue("junk"), undefined);
  assert.equal(isEconomyValueRef({ carrier: "opaque-digest", payloadDigest: "junk" }), false);
});

test("economy-values: typed readings validate and construct", () => {
  const reading = asTypedKernelValueReading("int", shapeDigest, payloadDigest);
  assert.ok(reading !== undefined);
  const full: TypedKernelValueReading = {
    carrier: "kernel-reading",
    kind: "int",
    shapeDigest,
    payloadDigest,
  };
  assert.deepEqual(reading, full);
  assert.ok(isEconomyValueRef(full));
  assert.ok(isEconomyValueRef({ ...full, kind: "entity-ref" }));
  // Malformed readings are refused (negative paths).
  assert.equal(isEconomyValueRef({ ...full, kind: "decimal" as never }), false);
  assert.equal(isEconomyValueRef({ ...full, shapeDigest: "junk" as never }), false);
  assert.equal(isEconomyValueRef({ ...full, payloadDigest: "junk" as never }), false);
  assert.equal(isEconomyValueRef({ ...full, carrier: "psychic" as never }), false);
  assert.equal(asTypedKernelValueReading("decimal", shapeDigest, payloadDigest), undefined);
  assert.equal(asTypedKernelValueReading("int", "junk", payloadDigest), undefined);
  assert.equal(asTypedKernelValueReading("int", shapeDigest, "junk"), undefined);
});

test("economy-values: the two carriers are structurally disjoint", () => {
  const opaque: EconomyValueRef = { carrier: "opaque-digest", payloadDigest };
  const reading: EconomyValueRef = { carrier: "kernel-reading", kind: "int", shapeDigest, payloadDigest };
  // Compile-time disjointness: an opaque value is never assignable where
  // a typed reading is required (and vice versa) — proven by the two
  // type-misuse directives below.
  // @ts-expect-error — carriers are disjoint: opaque is never a kernel reading
  const misuse: TypedKernelValueReading = opaque;
  assert.equal((misuse as EconomyValueRef).carrier, "opaque-digest");
  // @ts-expect-error — carriers are disjoint: a reading is never opaque
  const other: OpaqueEconomyValue = reading;
  assert.equal((other as EconomyValueRef).carrier, "kernel-reading");
  // No carrier carries a bare number anywhere on it.
  for (const value of [opaque, reading]) {
    const numericFields = Object.entries(value).filter(([, field]) => typeof field === "number");
    assert.deepEqual(numericFields, []);
  }
});

test("economy-values: quantity branching and shape pins are pure, never magnitude math", () => {
  const quantity = asTypedKernelValueReading("int", shapeDigest, payloadDigest)!;
  const textual = asTypedKernelValueReading("string", shapeDigest, payloadDigest)!;
  const opaque: EconomyValueRef = { carrier: "opaque-digest", payloadDigest };
  assert.ok(isQuantityReading(quantity));
  assert.equal(isQuantityReading(textual), false);
  assert.equal(isQuantityReading(opaque), false);
  // Shape pins.
  assert.ok(readingPinnedToShape(quantity, shapeDigest));
  assert.equal(readingPinnedToShape(quantity, otherDigest), false);
  // Opaque values carry no shape pin and never claim one.
  assert.equal(readingPinnedToShape(opaque, shapeDigest), false);
});

test("economy-values: carriers are readonly data (E1 compile check)", () => {
  const reading: TypedKernelValueReading = asTypedKernelValueReading("int", shapeDigest, payloadDigest)!;
  // @ts-expect-error — E1: contract fields are readonly
  reading.kind = "float";
  assert.equal(reading.carrier, "kernel-reading");
});
